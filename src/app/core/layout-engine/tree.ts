import { PlacedPart } from '../../shared/models/track';
import { openPorts } from './connections';
import { distance, portsConnect, WorldPort, worldPorts } from './geometry';
import { GenContext, freePort, nextId, ownerOf, placeOnHead, seedOrigin, stockOf, tryAttach } from './place';
import { TopologyPlan } from './topology';
import { homeScore, joinHeads, ovalJoin, targetClosed, wanderJoin } from './wander';

function openDiverges(parts: PlacedPart[], catalog: GenContext['catalog']): WorldPort[] {
  return openPorts(parts, catalog).filter((port) => {
    const owner = ownerOf(port, parts);
    return !!owner && catalog[owner.partId].category === 'switch' && port.id === 'diverge';
  });
}

interface Turtle {
  head: WorldPort;
  prefix: string;
  straightRun: number;
  grown: number;
}

function remainingTrack(inventory: Record<string, number>, parts: PlacedPart[]): {
  straights: number;
  curves: number;
  left: number;
  right: number;
} {
  const left = stockOf(inventory, parts);
  return {
    straights: left['straight-16'] ?? 0,
    curves: left['curve-22'] ?? 0,
    left: left['switch-left'] ?? 0,
    right: left['switch-right'] ?? 0,
  };
}

function pickWeighted(straights: number, curves: number, random: () => number): 'straight' | 'curves' {
  const total = Math.max(0, straights) + Math.max(0, curves);
  if (total <= 0) {
    return 'straight';
  }
  return random() * total < straights ? 'straight' : 'curves';
}

function liveHead(head: WorldPort, parts: PlacedPart[], catalog: GenContext['catalog']): WorldPort | null {
  return (
    openPorts(parts, catalog).find((port) => port.instanceId === head.instanceId && port.id === head.id) ??
    null
  );
}

function placeSwitchOnHead(
  partId: string,
  head: WorldPort,
  parts: PlacedPart[],
  ctx: GenContext,
  prefix: string,
  extraIgnore: string[] = [],
): { part: PlacedPart; through: WorldPort; diverge: WorldPort } | null {
  const spec = ctx.catalog[partId];
  for (const local of ['stem', 'through']) {
    const placed = tryAttach(
      spec,
      local,
      head,
      parts,
      ctx.catalog,
      nextId(ctx, prefix),
      extraIgnore,
      ctx.floorPlan,
    );
    if (!placed) {
      continue;
    }
    const ports = worldPorts(spec, placed);
    const through = ports.find((port) => port.id === (local === 'stem' ? 'through' : 'stem'));
    const diverge = ports.find((port) => port.id === 'diverge');
    if (through && diverge) {
      return { part: placed, through, diverge };
    }
  }
  return null;
}

/**
 * Grow a tree of paths weighted by remaining stock. Curves are placed in pairs.
 * A switch sprouts a new random branch from the diverge. When stock runs low,
 * heads steer toward each other: branches rejoin, the trunk closes, or a leftover
 * diverge becomes a reversing loop.
 */
export function growStockTree(
  inventory: Record<string, number>,
  plan: TopologyPlan,
  ctx: GenContext,
): PlacedPart[] | null {
  const startCurves = inventory['curve-22'] ?? 0;
  const startStraights = inventory['straight-16'] ?? 0;
  if (startCurves + startStraights < 8) {
    return null;
  }

  const startId = pickWeighted(startStraights, startCurves, ctx.random) === 'straight' && startStraights > 0
    ? 'straight-16'
    : startCurves > 0
      ? 'curve-22'
      : startStraights > 0
        ? 'straight-16'
        : '';
  if (!startId) {
    return null;
  }

  const origin = seedOrigin(ctx);
  const start: PlacedPart = {
    instanceId: nextId(ctx, 't'),
    partId: startId,
    label: 1,
    x: origin.x,
    y: origin.y,
    rotation: 0,
  };
  const goal = worldPorts(ctx.catalog[startId], start).find((port) => port.id === 'a');
  const firstHead = freePort(start, ctx.catalog, 'a');
  if (!goal || !firstHead) {
    return null;
  }

  let parts = [start];
  const turtles: Turtle[] = [
    {
      head: firstHead,
      prefix: 't',
      straightRun: startId === 'straight-16' ? 1 : 0,
      grown: 1,
    },
  ];
  const startTotal = startCurves + startStraights;
  const reserveC = plan.crossovers * 12 + plan.crossings * 6;
  const switchBudget = plan.dualRoutes * 2 + plan.keerlussen;
  let planted = 0;
  const ignoreGoal = [start.instanceId];
  const growUntil = Math.min(ctx.deadline - 180, Date.now() + 1800);

  const refreshTurtleHeads = () => {
    for (const turtle of turtles) {
      const live = liveHead(turtle.head, parts, ctx.catalog);
      if (live) {
        turtle.head = live;
      }
    }
  };

  const pruneTurtles = () => {
    for (let index = turtles.length - 1; index >= 0; index -= 1) {
      const live = liveHead(turtles[index].head, parts, ctx.catalog);
      if (!live) {
        turtles.splice(index, 1);
      } else {
        turtles[index].head = live;
      }
    }
  };

  const otherHeads = (turtle: Turtle, head: WorldPort): WorldPort[] => {
    const found: WorldPort[] = [];
    const liveGoal = liveHead(goal, parts, ctx.catalog);
    if (liveGoal && !(liveGoal.instanceId === head.instanceId && liveGoal.id === head.id)) {
      found.push(liveGoal);
    }
    for (const other of turtles) {
      if (other === turtle) {
        continue;
      }
      const live = liveHead(other.head, parts, ctx.catalog);
      if (live && !(live.instanceId === head.instanceId && live.id === head.id)) {
        found.push(live);
      }
    }
    return found;
  };

  const nearestTarget = (turtle: Turtle, head: WorldPort): WorldPort => {
    const candidates = otherHeads(turtle, head);
    if (candidates.length === 0) {
      return goal;
    }
    return candidates.reduce((best, port) => (homeScore(head, port) < homeScore(head, best) ? port : best));
  };

  const commit = (turtle: Turtle, move: { part: PlacedPart; head: WorldPort }, straight: boolean) => {
    parts = [...parts, move.part];
    turtle.head = move.head;
    turtle.grown += 1;
    turtle.straightRun = straight ? turtle.straightRun + 1 : 0;
  };

  const extendStraight = (turtle: Turtle): boolean => {
    const move = placeOnHead('straight-16', 'a', turtle.head, parts, ctx, turtle.prefix, ignoreGoal);
    if (!move) {
      return false;
    }
    commit(turtle, move, true);
    return true;
  };

  const probeCurvePair = (
    head: WorldPort,
    prefix: string,
    curvesLeft: number,
    turn: 'a' | 'b',
  ): { parts: PlacedPart[]; head: WorldPort } | null => {
    const first = placeOnHead('curve-22', turn, head, parts, ctx, prefix, ignoreGoal);
    if (!first) {
      return null;
    }
    let nextParts = [...parts, first.part];
    let nextHead = first.head;
    if (curvesLeft >= 2) {
      const second = placeOnHead('curve-22', turn, nextHead, nextParts, ctx, prefix, ignoreGoal);
      if (second) {
        nextParts = [...nextParts, second.part];
        nextHead = second.head;
      }
    }
    return { parts: nextParts, head: nextHead };
  };

  const extendCurvePair = (turtle: Turtle, curvesLeft: number, target: WorldPort, homing: number): boolean => {
    const order: Array<'a' | 'b'> = ctx.random() < 0.5 ? ['a', 'b'] : ['b', 'a'];
    const options: Array<{ parts: PlacedPart[]; head: WorldPort; score: number; added: number }> = [];
    for (const turn of order) {
      const probed = probeCurvePair(turtle.head, turtle.prefix, curvesLeft, turn);
      if (!probed) {
        continue;
      }
      options.push({
        ...probed,
        score: homeScore(probed.head, target),
        added: probed.parts.length - parts.length,
      });
    }
    if (options.length === 0) {
      return false;
    }
    const chosen =
      ctx.random() < homing
        ? options.reduce((best, option) => (option.score < best.score ? option : best))
        : options[0];
    const added = chosen.parts.slice(parts.length);
    parts = chosen.parts;
    turtle.head = chosen.head;
    turtle.grown += added.length;
    turtle.straightRun = 0;
    return true;
  };

  const plantSwitch = (turtle: Turtle, partId: string): boolean => {
    const plantedSwitch = placeSwitchOnHead(partId, turtle.head, parts, ctx, 'rte', ignoreGoal);
    if (!plantedSwitch) {
      return false;
    }
    parts = [...parts, plantedSwitch.part];
    turtle.head = plantedSwitch.through;
    turtle.straightRun = 0;
    turtle.grown += 1;
    planted += 1;
    turtles.push({
      head: plantedSwitch.diverge,
      prefix: 'br',
      straightRun: 0,
      grown: 0,
    });
    return true;
  };

  const tryJoinTurtle = (turtle: Turtle, target: WorldPort): boolean => {
    const liveStart = liveHead(turtle.head, parts, ctx.catalog);
    const liveTarget = liveHead(target, parts, ctx.catalog);
    if (!liveStart || !liveTarget) {
      return false;
    }
    if (portsConnect(liveStart, liveTarget)) {
      return false;
    }
    const gap = distance(liveStart, liveTarget);
    if (gap < 80 || gap > 160) {
      return false;
    }
    const next =
      wanderJoin(parts, liveStart, liveTarget, inventory, ctx, 'jn', 'mixed') ??
      joinHeads(parts, liveStart, liveTarget, inventory, ctx, 'jn');
    if (
      next &&
      next.length >= parts.length + 8 &&
      targetClosed(next, ctx.catalog, liveTarget) &&
      targetClosed(next, ctx.catalog, liveStart)
    ) {
      parts = next;
      pruneTurtles();
      return true;
    }
    return false;
  };

  for (let step = 0; step < 280 && Date.now() < growUntil; step += 1) {
    refreshTurtleHeads();
    if (turtles.length === 0) {
      break;
    }
    const stock = remainingTrack(inventory, parts);
    const remaining = stock.straights + stock.curves;
    const spent = startTotal <= 0 ? 1 : 1 - remaining / startTotal;
    const joinReserve = Math.max(reserveC + 10, Math.floor(startTotal * 0.2));
    const homing = Math.max(0, Math.min(1, (spent - 0.38) / 0.4));
    const solving = remaining <= joinReserve || spent >= 0.72;

    const turtle =
      homing > 0.45 && turtles.length > 1
        ? turtles.reduce((best, item) => {
            const live = liveHead(item.head, parts, ctx.catalog);
            const bestLive = liveHead(best.head, parts, ctx.catalog);
            if (!live) {
              return best;
            }
            if (!bestLive) {
              return item;
            }
            return homeScore(live, nearestTarget(item, live)) < homeScore(bestLive, nearestTarget(best, bestLive))
              ? item
              : best;
          })
        : turtles[Math.floor(ctx.random() * turtles.length)];

    const live = liveHead(turtle.head, parts, ctx.catalog);
    if (!live) {
      const index = turtles.indexOf(turtle);
      if (index >= 0) {
        turtles.splice(index, 1);
      }
      continue;
    }
    turtle.head = live;
    const target = nearestTarget(turtle, live);
    const canHomeBranch = turtle.prefix === 't' || turtle.grown >= 12 || solving;

    if (canHomeBranch && homing > 0.35 && tryJoinTurtle(turtle, target)) {
      continue;
    }

    const wantSwitch = planted < switchBudget && spent < 0.55;
    if (
      wantSwitch &&
      parts.length >= 8 &&
      (stock.left > 0 || stock.right > 0) &&
      (ctx.random() < 0.32 || (planted === 0 && remaining < startTotal * 0.6))
    ) {
      const hand = stock.left > 0 && (stock.right === 0 || ctx.random() < 0.5) ? 'switch-left' : 'switch-right';
      const available = hand === 'switch-left' ? stock.left : stock.right;
      if (available > 0 && plantSwitch(turtle, hand)) {
        continue;
      }
    }

    let kind = pickWeighted(stock.straights, stock.curves, ctx.random);
    if (turtle.straightRun >= 2 && stock.curves >= 2) {
      kind = 'curves';
    }
    if (kind === 'straight' && stock.straights <= 0) {
      kind = 'curves';
    }
    if (kind === 'curves' && stock.curves <= 0) {
      kind = 'straight';
    }

    if (canHomeBranch && homing > 0.35 && stock.straights > 0 && stock.curves >= 2) {
      const straightMove = placeOnHead('straight-16', 'a', turtle.head, parts, ctx, turtle.prefix, ignoreGoal);
      const curveA = probeCurvePair(turtle.head, turtle.prefix, stock.curves, 'a');
      const curveB = probeCurvePair(turtle.head, turtle.prefix, stock.curves, 'b');
      const curveBest =
        curveA && curveB
          ? homeScore(curveA.head, target) <= homeScore(curveB.head, target)
            ? curveA
            : curveB
          : curveA ?? curveB;
      if (straightMove && curveBest) {
        const straightScore = homeScore(straightMove.head, target);
        const curveScore = homeScore(curveBest.head, target);
        if (ctx.random() < homing) {
          kind = curveScore <= straightScore ? 'curves' : 'straight';
        }
      }
    }

    const placed =
      kind === 'straight' ? extendStraight(turtle) : extendCurvePair(turtle, stock.curves, target, homing);
    if (placed) {
      continue;
    }
    const fallback =
      kind === 'straight'
        ? extendCurvePair(turtle, stock.curves, target, Math.max(homing, 0.5))
        : extendStraight(turtle);
    if (!fallback && turtles.length > 1) {
      const index = turtles.indexOf(turtle);
      if (index >= 0) {
        turtles.splice(index, 1);
      }
    }
  }

  return closeTree(parts, goal, inventory, ctx, plan);
}

function closeTree(
  parts: PlacedPart[],
  goal: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  plan: TopologyPlan,
): PlacedPart[] | null {
  let result = parts;
  const keepDiverges = plan.parking;

  const joinPair = (start: WorldPort, target: WorldPort): boolean => {
    const liveStart = openPorts(result, ctx.catalog).find(
      (port) => port.instanceId === start.instanceId && port.id === start.id,
    );
    const liveTarget = openPorts(result, ctx.catalog).find(
      (port) => port.instanceId === target.instanceId && port.id === target.id,
    );
    if (!liveStart || !liveTarget) {
      return false;
    }
    if (portsConnect(liveStart, liveTarget)) {
      return false;
    }
    if (Date.now() >= ctx.deadline) {
      return false;
    }
    const next =
      wanderJoin(result, liveStart, liveTarget, inventory, ctx, 'jn', 'mixed') ??
      (distance(liveStart, liveTarget) > 48
        ? joinHeads(result, liveStart, liveTarget, inventory, ctx, 'jn')
        : null) ??
      (Date.now() < ctx.deadline - 40
        ? ovalJoin(result, liveStart, liveTarget, inventory, ctx, 'jn', false)
        : null);
    const divergePair = liveStart.id === 'diverge' && liveTarget.id === 'diverge';
    if (
      next &&
      (!divergePair || next.length >= result.length + 8) &&
      targetClosed(next, ctx.catalog, liveTarget) &&
      targetClosed(next, ctx.catalog, liveStart)
    ) {
      result = next;
      return true;
    }
    return false;
  };

  const liveGoal = openPorts(result, ctx.catalog).find(
    (port) => port.instanceId === goal.instanceId && port.id === goal.id,
  );
  if (liveGoal) {
    const others = openPorts(result, ctx.catalog).filter(
      (port) =>
        !(port.instanceId === liveGoal.instanceId && port.id === liveGoal.id) &&
        !port.instanceId.startsWith('sid'),
    );
    others.sort((a, b) => homeScore(liveGoal, a) - homeScore(liveGoal, b));
    for (const target of others) {
      if (joinPair(liveGoal, target)) {
        break;
      }
    }
  }

  for (let round = 0; round < 8 && Date.now() < ctx.deadline; round += 1) {
    const opens = openPorts(result, ctx.catalog).filter((port) => !port.instanceId.startsWith('sid'));
    const diverges = openDiverges(result, ctx.catalog);
    const extraDiverges = Math.max(0, diverges.length - keepDiverges);
    const closable = opens.filter((port) => {
      if (port.instanceId === goal.instanceId && port.id === goal.id) {
        return true;
      }
      if (port.id === 'diverge' && extraDiverges <= 0 && diverges.some((item) => item.instanceId === port.instanceId)) {
        return false;
      }
      return true;
    });
    if (closable.length < 2) {
      break;
    }
    closable.sort((a, b) => distance(a, goal) - distance(b, goal));
    let joined = false;
    const start = closable[closable.length - 1];
    const rest = closable.filter((port) => port !== start);
    rest.sort((a, b) => homeScore(start, a) - homeScore(start, b));
    for (const target of rest) {
      if (joinPair(start, target)) {
        joined = true;
        break;
      }
    }
    if (!joined) {
      break;
    }
  }

  if (plan.keerlussen > 0 && plan.parking === 0) {
    const leftover = openDiverges(result, ctx.catalog);
    if (leftover.length === 1) {
      const start = leftover[0];
      const targets = openPorts(result, ctx.catalog).filter((port) =>
        port.instanceId === start.instanceId ? port.id !== 'diverge' : true,
      );
      targets.sort((a, b) => homeScore(start, a) - homeScore(start, b));
      for (const target of targets) {
        if (joinPair(start, target)) {
          break;
        }
      }
    }
  }

  return result.length >= 8 ? result : null;
}
