import { PlacedPart, TrackPart } from '../../shared/models/track';
import { distanceToFloorEdge, floorBounds, placementHitsRoom, pointInPolygon } from '../floor-plan/space';
import { detectConnections, openPorts, remainingInventory } from './connections';
import {
  CURVE_ANGLE,
  distance,
  headingDelta,
  normalizeHeading,
  portsConnect,
  WorldPort,
  worldPorts,
} from './geometry';
import { GenContext, freePort, nextId, placeOnHead, seedOrigin, stockOf, tryAttach } from './place';

const MAX_CURVE_RUN = 8;

export function headingSteps(from: number, to: number): number {
  let delta = normalizeHeading(to - from);
  if (delta > 180) {
    delta -= 360;
  }
  return Math.round(delta / CURVE_ANGLE);
}

export function homeScore(head: WorldPort, goal: WorldPort): number {
  const dist = distance(head, goal);
  const face = headingDelta(head.heading, goal.heading + 180);
  if (dist > 36) {
    const bear = (Math.atan2(goal.y - head.y, goal.x - head.x) * 180) / Math.PI;
    return dist + headingDelta(head.heading, bear) * 0.7;
  }
  return dist + face * 0.9;
}

export function loopCloses(parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  return parts.length > 0 && openPorts(parts, catalog).length === 0;
}

function curveOptions(curvesLeft: number): Array<{ partId: string; portId: string }> {
  if (curvesLeft <= 0) {
    return [];
  }
  return [
    { partId: 'curve-22', portId: 'a' },
    { partId: 'curve-22', portId: 'b' },
  ];
}

function tryChunk(
  ports: readonly string[],
  partId: string,
  head: WorldPort,
  parts: PlacedPart[],
  ctx: GenContext,
  prefix: string,
  ignore: string[],
): { parts: PlacedPart[]; head: WorldPort } | null {
  let trail = parts;
  let tip = head;
  for (const portId of ports) {
    const move = placeOnHead(partId, portId, tip, trail, ctx, prefix, ignore);
    if (!move) {
      return null;
    }
    trail = [...trail, move.part];
    tip = move.head;
  }
  return { parts: trail, head: tip };
}

export function growToward(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix = 'ret',
): PlacedPart[] {
  const result = [...parts];
  let current = start;
  let curveRun = 0;
  let worse = 0;
  const ignore = [target.instanceId, start.instanceId];
  for (let step = 0; step < 64; step += 1) {
    if (portsConnect(current, target)) {
      return result;
    }
    const left = remainingInventory(inventory, result);
    const dist = distance(current, target);
    if ((left['curve-22'] ?? 0) >= 2 && dist > 24 && ctx.random() < 0.4) {
      const ports = ctx.random() >= 0.5 ? (['a', 'b'] as const) : (['b', 'a'] as const);
      const bent = tryChunk(ports, 'curve-22', current, result, ctx, prefix, ignore);
      if (bent && distance(bent.head, target) <= dist + 36) {
        result.length = 0;
        result.push(...bent.parts);
        current = bent.head;
        curveRun = 0;
        if (portsConnect(current, target)) {
          return result;
        }
        continue;
      }
    }
    const types = ['straight-16', 'curve-22'].filter((id) => (left[id] ?? 0) > 0);
    let best: { part: PlacedPart; free: WorldPort; score: number; curve: boolean } | null = null;
    for (const type of types) {
      if (type === 'curve-22' && curveRun >= MAX_CURVE_RUN) {
        continue;
      }
      const part = ctx.catalog[type];
      for (const local of part.ports) {
        const candidate = tryAttach(
          part,
          local.id,
          current,
          result,
          ctx.catalog,
          nextId(ctx, prefix),
          ignore,
          ctx.floorPlan,
        );
        if (!candidate) {
          continue;
        }
        const frees = worldPorts(part, candidate).filter((port) => port.id !== local.id);
        for (const free of frees) {
          if (portsConnect(free, target)) {
            result.push(candidate);
            return result;
          }
          const wall = ctx.floorPlan ? Math.abs(distanceToFloorEdge(free, ctx.floorPlan) - 8) * 0.45 : 0;
          const score = homeScore(free, target) + wall;
          if (!best || score < best.score) {
            best = { part: candidate, free, score, curve: type === 'curve-22' };
          }
        }
      }
    }
    if (!best) {
      break;
    }
    if (best.score >= dist + 28) {
      worse += 1;
      if (worse >= 4) {
        break;
      }
    } else {
      worse = 0;
    }
    result.push(best.part);
    current = best.free;
    curveRun = best.curve ? curveRun + 1 : 0;
  }
  return portsConnect(current, target) ? result : parts;
}

export function targetClosed(
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
  target: WorldPort,
): boolean {
  return !openPorts(parts, catalog).some(
    (port) => port.instanceId === target.instanceId && port.id === target.id,
  );
}

export function joinHeads(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix = 'jn',
): PlacedPart[] | null {
  if (portsConnect(start, target)) {
    return parts;
  }
  const grown = growToward(parts, start, target, inventory, ctx, prefix);
  return targetClosed(grown, ctx.catalog, target) ? grown : null;
}

export type WanderBias = 'inward' | 'outward' | 'mixed';

function centroidOf(parts: PlacedPart[]): { x: number; y: number } {
  if (parts.length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: parts.reduce((sum, part) => sum + part.x, 0) / parts.length,
    y: parts.reduce((sum, part) => sum + part.y, 0) / parts.length,
  };
}

function radialDelta(from: WorldPort, to: WorldPort, center: { x: number; y: number }): number {
  return distance(to, center) - distance(from, center);
}

/** Grow an organic path between two open ports. Prefers the interior when `bias` is inward. */
export function wanderJoin(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix: string,
  bias: WanderBias = 'mixed',
  minAdded = 0,
): PlacedPart[] | null {
  if (portsConnect(start, target)) {
    return parts;
  }
  if (Date.now() > ctx.deadline - 180) {
    return minAdded > 0 ? null : joinHeads(parts, start, target, inventory, ctx, prefix);
  }
  const center = centroidOf(parts);
  const left0 = stockOf(inventory, parts);
  const total = (left0['curve-22'] ?? 0) + (left0['straight-16'] ?? 0);
  if (total < 2) {
    return minAdded > 0 ? null : joinHeads(parts, start, target, inventory, ctx, prefix);
  }
  const hungry = total >= 32 && minAdded >= 10;
  const budget =
    minAdded > 0
      ? Math.min(hungry ? 36 : 22, Math.max(minAdded + 4, Math.floor(total * (hungry ? 0.5 : 0.35))))
      : Math.min(18, Math.max(6, Math.floor(total * 0.22)));
  const exploreUntil =
    minAdded > 0
      ? Math.min(budget - 2, Math.max(minAdded, 6 + Math.floor(ctx.random() * 4)))
      : Math.min(
          budget - 2,
          4 + Math.floor(ctx.random() * Math.max(3, Math.floor(budget * 0.4))),
        );
  const longEnough = (closed: PlacedPart[]) => closed.length - parts.length >= minAdded;

  let trail = [...parts];
  let head = start;
  const history = [head];
  let straightRun = 0;
  let curveRun = 0;
  let backtracks = 0;
  const ignore = [target.instanceId, start.instanceId];

  const restore = (): boolean => {
    if (trail.length <= parts.length) {
      return false;
    }
    let popped = 0;
    while (trail.length > parts.length && popped < 3) {
      const removed = trail.pop();
      history.pop();
      popped += 1;
      if (removed?.partId === 'straight-16') {
        straightRun = Math.max(0, straightRun - 1);
        curveRun = 0;
      } else {
        straightRun = 0;
        curveRun = Math.max(0, curveRun - 1);
      }
    }
    head = history[history.length - 1];
    backtracks += 1;
    return true;
  };

  const commit = (move: { part: PlacedPart; head: WorldPort }) => {
    trail = [...trail, move.part];
    head = move.head;
    history.push(head);
    straightRun = move.part.partId === 'straight-16' ? straightRun + 1 : 0;
    curveRun = move.part.partId === 'curve-22' ? curveRun + 1 : 0;
  };

  const refreshRuns = () => {
    straightRun = 0;
    curveRun = 0;
    for (let i = trail.length - 1; i >= parts.length; i -= 1) {
      if (trail[i].partId === 'straight-16') {
        if (curveRun > 0) {
          break;
        }
        straightRun += 1;
      } else if (trail[i].partId === 'curve-22') {
        if (straightRun > 0) {
          break;
        }
        curveRun += 1;
      } else {
        break;
      }
    }
  };

  const trySequence = (sequence: Array<{ partId: string; portId: string }>): boolean => {
    const mark = trail.length;
    const markHead = head;
    for (const item of sequence) {
      const move = placeOnHead(item.partId, item.portId, head, trail, ctx, prefix, ignore);
      if (!move) {
        while (trail.length > mark) {
          trail.pop();
          history.pop();
        }
        head = markHead;
        refreshRuns();
        return false;
      }
      commit(move);
    }
    return true;
  };

  const pickCurvePort = (): 'a' | 'b' | null => {
    const left = placeOnHead('curve-22', 'a', head, trail, ctx, prefix, ignore);
    const right = placeOnHead('curve-22', 'b', head, trail, ctx, prefix, ignore);
    if (!left && !right) {
      return null;
    }
    if (!left) {
      return 'b';
    }
    if (!right) {
      return 'a';
    }
    if (bias === 'mixed') {
      return ctx.random() < 0.5 ? 'a' : 'b';
    }
    const da = radialDelta(head, left.head, center);
    const db = radialDelta(head, right.head, center);
    return bias === 'inward' ? (da <= db ? 'a' : 'b') : da >= db ? 'a' : 'b';
  };

  for (let step = 0; step < (minAdded > 0 ? 40 : 90) && Date.now() < ctx.deadline; step += 1) {
    if (portsConnect(head, target)) {
      if (longEnough(trail)) {
        return trail;
      }
      if (!restore()) {
        break;
      }
      continue;
    }
    const added = trail.length - parts.length;
    if (backtracks > 24 || added > budget) {
      break;
    }
    const left = stockOf(inventory, trail);
    const curvesLeft = left['curve-22'] ?? 0;
    const straightLeft = left['straight-16'] ?? 0;
    if (curvesLeft + straightLeft === 0) {
      if (!restore()) {
        break;
      }
      continue;
    }
    const mustHome = added >= exploreUntil || curvesLeft + straightLeft <= 6 || added >= budget - 2;
    if (mustHome) {
      const closed =
        joinHeads(trail, head, target, inventory, ctx, prefix) ??
        (minAdded > 0 ? null : ovalJoin(trail, head, target, inventory, ctx, prefix, false));
      if (closed && targetClosed(closed, ctx.catalog, target) && longEnough(closed)) {
        return closed;
      }
      if (!restore()) {
        break;
      }
      continue;
    }

    const mix = curvesLeft / Math.max(1, curvesLeft + straightLeft);
    if (curvesLeft >= 6 && ctx.random() < 0.24) {
      const turn = pickCurvePort() ?? (ctx.random() < 0.5 ? 'a' : 'b');
      if (trySequence(Array.from({ length: 6 }, () => ({ partId: 'curve-22', portId: turn })))) {
        continue;
      }
    }
    if (
      curvesLeft >= 2 &&
      ctx.random() < 0.42 &&
      trySequence(
        ctx.random() >= 0.5
          ? [
              { partId: 'curve-22', portId: 'a' },
              { partId: 'curve-22', portId: 'b' },
            ]
          : [
              { partId: 'curve-22', portId: 'b' },
              { partId: 'curve-22', portId: 'a' },
            ],
      )
    ) {
      continue;
    }

    const options: Array<{ partId: string; portId: string }> = [];
    if (straightLeft > 0 && straightRun < 3) {
      options.push({ partId: 'straight-16', portId: 'a' });
    }
    if (curvesLeft > 0 && curveRun < MAX_CURVE_RUN) {
      const port = pickCurvePort();
      if (port) {
        options.push({ partId: 'curve-22', portId: port });
      } else {
        options.push(...curveOptions(curvesLeft));
      }
    }
    if (options.length === 0) {
      if (straightLeft > 0) {
        options.push({ partId: 'straight-16', portId: 'a' });
      }
      options.push(...curveOptions(curvesLeft));
    }
    if (options.length === 0) {
      if (!restore()) {
        break;
      }
      continue;
    }

    const preferCurve = straightRun >= 2 || ctx.random() < mix;
    const pool = preferCurve
      ? options.filter((option) => option.partId === 'curve-22')
      : options.filter((option) => option.partId === 'straight-16');
    const pickFrom = pool.length ? pool : options;
    const pick = pickFrom[Math.floor(ctx.random() * pickFrom.length)];
    const chosen = placeOnHead(pick.partId, pick.portId, head, trail, ctx, prefix, ignore);
    if (!chosen) {
      if (!restore()) {
        break;
      }
      continue;
    }
    commit(chosen);
  }

  if (portsConnect(head, target) && longEnough(trail)) {
    return trail;
  }
  const closed =
    joinHeads(trail, head, target, inventory, ctx, prefix) ??
    (minAdded > 0 ? null : ovalJoin(trail, head, target, inventory, ctx, prefix, false));
  return closed && targetClosed(closed, ctx.catalog, target) && longEnough(closed) ? closed : null;
}

export function wanderHomeLoop(
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix = 'w',
): PlacedPart[] | null {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  if (curves < 16) {
    return null;
  }
  const startId = straights > 0 ? 'straight-16' : 'curve-22';
  const origin = seedOrigin(ctx);
  const start: PlacedPart = {
    instanceId: nextId(ctx, prefix),
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
  let head = firstHead;
  const history = [head];
  const wandered = [false];
  let backtracks = 0;
  let straightRun = startId === 'straight-16' ? 1 : 0;
  let curveRun = startId === 'curve-22' ? 1 : 0;
  const total = straights + curves;
  const maxParts = Math.min(160, 2 + total);
  const minParts = Math.min(maxParts - 8, Math.max(16, Math.floor(total * (total > 40 ? 0.4 : 0.35))));
  const exploreUntil = Math.max(minParts, Math.floor(total * 0.55));
  const padsWanted = straights >= 12 ? (straights >= 28 ? 2 : 1) : 0;
  let padsPlaced = 0;

  const restore = () => {
    if (parts.length <= 1) {
      return false;
    }
    let popped = 0;
    while (parts.length > 1 && popped < 4) {
      const wasWander = wandered.pop();
      const removed = parts.pop();
      history.pop();
      popped += 1;
      if (removed?.partId === 'straight-16') {
        straightRun = Math.max(0, straightRun - 1);
        curveRun = 0;
      } else {
        straightRun = 0;
        curveRun = Math.max(0, curveRun - 1);
      }
      if (wasWander || popped >= 2) {
        break;
      }
    }
    head = history[history.length - 1];
    backtracks += 1;
    return true;
  };

  const commit = (move: { part: PlacedPart; head: WorldPort }, wander: boolean) => {
    parts = [...parts, move.part];
    head = move.head;
    wandered.push(wander);
    history.push(head);
    straightRun = move.part.partId === 'straight-16' ? straightRun + 1 : 0;
    curveRun = move.part.partId === 'curve-22' ? curveRun + 1 : 0;
  };

  const refreshRuns = () => {
    straightRun = 0;
    curveRun = 0;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (parts[i].partId === 'straight-16') {
        if (curveRun > 0) {
          break;
        }
        straightRun += 1;
      } else if (parts[i].partId === 'curve-22') {
        if (straightRun > 0) {
          break;
        }
        curveRun += 1;
      } else {
        break;
      }
    }
  };

  const trySequence = (sequence: Array<{ partId: string; portId: string }>, wander: boolean): boolean => {
    const mark = parts.length;
    for (const item of sequence) {
      const move = placeOnHead(item.partId, item.portId, head, parts, ctx, prefix, ignore);
      if (!move) {
        while (parts.length > mark) {
          wandered.pop();
          parts.pop();
          history.pop();
        }
        head = history[history.length - 1];
        refreshRuns();
        return false;
      }
      commit(move, wander);
    }
    return true;
  };

  const ignore = [start.instanceId];

  for (let step = 0; step < 520 && Date.now() < ctx.deadline; step += 1) {
    if (portsConnect(head, goal) && parts.length >= minParts) {
      return parts;
    }
    if (backtracks > 140 || parts.length > maxParts) {
      break;
    }
    const left = stockOf(inventory, parts);
    const curvesLeft = left['curve-22'] ?? 0;
    const straightLeft = left['straight-16'] ?? 0;
    if (curvesLeft + straightLeft === 0) {
      if (!restore()) {
        break;
      }
      continue;
    }
    const need = Math.abs(headingSteps(head.heading, goal.heading + 180)) % 16;
    const minTurns = need === 0 ? 0 : Math.min(need, 16 - need);
    const dist = distance(head, goal);
    const leftover = curvesLeft + straightLeft;
    const mustHome =
      parts.length >= exploreUntil ||
      curvesLeft <= minTurns + 2 ||
      (dist < 28 && leftover <= 16 && parts.length >= minParts) ||
      parts.length > maxParts - 8;

    if (mustHome && step % 7 === 0) {
      const closed =
        joinHeads(parts, head, goal, inventory, ctx, prefix) ??
        ovalJoin(parts, head, goal, inventory, ctx, prefix, false);
      if (closed && loopCloses(closed, ctx.catalog) && closed.length >= minParts) {
        return closed;
      }
      restore();
    }

    const options: Array<{ partId: string; portId: string }> = [];
    if (straightLeft > 0 && (mustHome || straightRun < 3)) {
      options.push({ partId: 'straight-16', portId: 'a' });
    }
    if (curvesLeft > 0 && curveRun < MAX_CURVE_RUN) {
      options.push(...curveOptions(curvesLeft));
    } else if (curvesLeft > 0 && mustHome) {
      options.push(...curveOptions(curvesLeft));
    }
    if (options.length === 0) {
      if (straightLeft > 0) {
        options.push({ partId: 'straight-16', portId: 'a' });
      }
      options.push(...curveOptions(curvesLeft));
    }
    if (options.length === 0) {
      if (!restore()) {
        break;
      }
      continue;
    }

    const wander = !mustHome;
    if (
      wander &&
      padsPlaced < padsWanted &&
      straightLeft >= 6 &&
      straightRun === 0 &&
      (padsPlaced === 0 && parts.length >= 6 ? ctx.random() < 0.7 : ctx.random() < 0.22) &&
      trySequence(
        Array.from({ length: 6 }, () => ({ partId: 'straight-16', portId: 'a' })),
        true,
      )
    ) {
      padsPlaced += 1;
      continue;
    }
    if (wander && curvesLeft >= 6 && ctx.random() < 0.28) {
      const turn = ctx.random() < 0.5 ? 'a' : 'b';
      const count = curvesLeft >= 8 && ctx.random() < 0.55 ? 8 : 6;
      if (trySequence(Array.from({ length: count }, () => ({ partId: 'curve-22', portId: turn })), true)) {
        continue;
      }
    }
    if (
      wander &&
      curvesLeft >= 2 &&
      ctx.random() < 0.45 &&
      trySequence(
        ctx.random() >= 0.5
          ? [
              { partId: 'curve-22', portId: 'a' },
              { partId: 'curve-22', portId: 'b' },
            ]
          : [
              { partId: 'curve-22', portId: 'b' },
              { partId: 'curve-22', portId: 'a' },
            ],
        true,
      )
    ) {
      continue;
    }

    let chosen: { part: PlacedPart; head: WorldPort } | null = null;
    if (wander) {
      const mix = curvesLeft / Math.max(1, curvesLeft + straightLeft);
      const preferCurve = straightRun >= 3 || ctx.random() < mix;
      const pool = preferCurve
        ? options.filter((option) => option.partId === 'curve-22')
        : options.filter((option) => option.partId === 'straight-16');
      const pickFrom = pool.length ? pool : options;
      const pick = pickFrom[Math.floor(ctx.random() * pickFrom.length)];
      chosen = placeOnHead(pick.partId, pick.portId, head, parts, ctx, prefix, ignore);
    } else {
      let best: { move: { part: PlacedPart; head: WorldPort }; score: number } | null = null;
      for (const option of options) {
        const move = placeOnHead(option.partId, option.portId, head, parts, ctx, prefix, ignore);
        if (!move) {
          continue;
        }
        const score = homeScore(move.head, goal);
        if (!best || score < best.score) {
          best = { move, score };
        }
      }
      chosen = best?.move ?? null;
    }
    if (!chosen) {
      if (!restore()) {
        break;
      }
      continue;
    }
    commit(chosen, wander);
  }
  if (portsConnect(head, goal) && parts.length >= minParts) {
    return parts;
  }
  const closed =
    joinHeads(parts, head, goal, inventory, ctx, prefix) ??
    ovalJoin(parts, head, goal, inventory, ctx, prefix, false);
  return closed && loopCloses(closed, ctx.catalog) && closed.length >= minParts ? closed : null;
}

export function attachSequence(
  sequence: Array<{ partId: string; portId?: string }>,
  ctx: GenContext,
  prefix = 'p',
): PlacedPart[] | null {
  if (sequence.length === 0) {
    return null;
  }
  const first = ctx.catalog[sequence[0].partId];
  const startPort = sequence[0].portId ?? first.ports[0].id;
  const origin = seedOrigin(ctx);
  const start: PlacedPart = {
    instanceId: nextId(ctx, prefix),
    partId: first.id,
    label: 1,
    x: origin.x,
    y: origin.y,
    rotation: 0,
  };
  const parts = [start];
  let head = freePort(start, ctx.catalog, startPort);
  for (let i = 1; i < sequence.length; i += 1) {
    if (!head) {
      return null;
    }
    const item = sequence[i];
    const portId = item.portId ?? ctx.catalog[item.partId].ports[0].id;
    const ignore = i === sequence.length - 1 ? [start.instanceId] : [];
    const move = placeOnHead(item.partId, portId, head, parts, ctx, prefix, ignore);
    if (!move) {
      return null;
    }
    parts.push(move.part);
    head = move.head;
  }
  const goal = worldPorts(first, start).find((port) => port.id === startPort);
  if (!goal || !portsConnect(head!, goal)) {
    return null;
  }
  return parts;
}

function oppositeCornerTurns(random: () => number): [number, number, number, number] {
  const pairs: Array<[number, number]> = [
    [5, 3],
    [6, 2],
    [3, 5],
    [2, 6],
    [7, 1],
  ];
  const [a, b] = pairs[Math.floor(random() * pairs.length)];
  return [a, b, a, b];
}

export function organicRing(
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix = 'p',
): PlacedPart[] | null {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  if (curves < 16) {
    return null;
  }
  const extra = Math.floor((curves - 16) / 2);
  const evenS = straights - (straights % 2);
  const capped = Math.min(extra, 12);
  const irregular = oppositeCornerTurns(ctx.random);
  const square = {
    s: straights,
    extraCurves: capped,
    corners: 4 as const,
    skip: extra === 0,
    turns: [4, 4, 4, 4] as number[],
  };
  const four = {
    s: straights,
    extraCurves: capped,
    corners: 4 as const,
    skip: extra === 0,
    turns: irregular,
  };
  const eightWavy = {
    s: straights,
    extraCurves: Math.min(extra, 12),
    corners: 8 as const,
    skip: false,
    turns: undefined as number[] | undefined,
  };
  const eightMid = {
    s: straights,
    extraCurves: Math.min(extra, 4),
    corners: 8 as const,
    skip: false,
    turns: undefined as number[] | undefined,
  };
  const eightSkip = {
    s: straights,
    extraCurves: 0,
    corners: 8 as const,
    skip: true,
    turns: undefined as number[] | undefined,
  };
  const rest: Array<{
    s: number;
    extraCurves: number;
    corners: 4 | 8;
    skip: boolean;
    turns?: number[];
  }> = [
    { s: straights, extraCurves: Math.floor(extra / 2), corners: 4, skip: false, turns: [4, 4, 4, 4] },
    { s: straights, extraCurves: 0, corners: 4, skip: true, turns: [4, 4, 4, 4] },
    { s: Math.max(4, evenS / 2), extraCurves: 0, corners: 4, skip: true, turns: [4, 4, 4, 4] },
    { s: 4, extraCurves: 0, corners: 4, skip: true, turns: [4, 4, 4, 4] },
  ];
  const large = straights + curves > 40;
  const tries = large
    ? [eightWavy, eightMid, eightSkip, square, four, ...rest]
    : [four, square, eightWavy, ...rest];
  for (const attempt of tries) {
    const built = ringWithCorners(
      attempt.s,
      16 + attempt.extraCurves * 2,
      attempt.corners,
      ctx,
      attempt.skip,
      attempt.turns,
      prefix,
    );
    if (built) {
      return built;
    }
  }
  return null;
}

function ringWithCorners(
  straights: number,
  curves: number,
  corners: 4 | 8,
  ctx: GenContext,
  skipSbends: boolean,
  cornerTurns?: number[],
  prefix = 'p',
): PlacedPart[] | null {
  const turns =
    cornerTurns && cornerTurns.length === corners
      ? cornerTurns
      : Array.from({ length: corners }, () => 16 / corners);
  const sides = Array.from({ length: corners }, () => 0);
  let straightLeft = straights - (straights % 2);
  const half = corners / 2;
  const pairOffset = Math.floor(ctx.random() * half);
  const other = (pairOffset + 1) % half;
  const pad =
    corners === 8
      ? Math.min(8, Math.max(0, Math.floor(straightLeft / 4)))
      : straights >= 12
        ? 4
        : Math.min(6, Math.floor((straights - (straights % 2)) / 4) * 2 || 4);
  const padPairs = corners === 8 ? [pairOffset, other] : [pairOffset];
  for (const side of padPairs) {
    while (straightLeft >= 2 && sides[side] < pad) {
      sides[side] += 1;
      sides[side + half] += 1;
      straightLeft -= 2;
    }
  }
  if (corners === 4 && straights >= 24 && ctx.random() < 0.45) {
    const secondPad = Math.min(pad, Math.floor(straightLeft / 2));
    while (straightLeft >= 2 && sides[other] < secondPad) {
      sides[other] += 1;
      sides[other + half] += 1;
      straightLeft -= 2;
    }
  }
  if (corners === 8) {
    for (let side = 0; side < half && straightLeft >= 2; side += 1) {
      while (sides[side] < 2 && straightLeft >= 2) {
        sides[side] += 1;
        sides[side + half] += 1;
        straightLeft -= 2;
      }
    }
  }
  while (straightLeft >= 2) {
    const side = Math.floor(ctx.random() * half);
    sides[side] += 1;
    sides[side + half] += 1;
    straightLeft -= 2;
  }
  const extraPairs = skipSbends ? 0 : Math.floor((curves - 16) / 2);
  const sbends = Array.from({ length: corners }, () => 0);
  const wiggles = Array.from({ length: corners }, () => 0);
  let pairsLeft = extraPairs;
  const offsetPairs = Math.min(4, Math.floor(pairsLeft / 2) * 2);
  let offsetLeft = offsetPairs - (offsetPairs % 2);
  pairsLeft -= offsetLeft;
  const bendOrder = [pairOffset, other, (pairOffset + 2) % half];
  for (const bend of bendOrder) {
    while (offsetLeft >= 2 && sbends[bend] < 2) {
      sbends[bend] += 1;
      sbends[bend + half] += 1;
      offsetLeft -= 2;
    }
  }
  pairsLeft += offsetLeft;
  while (pairsLeft >= 4) {
    const side = Math.floor(ctx.random() * half);
    wiggles[side] += 1;
    wiggles[side + half] += 1;
    pairsLeft -= 4;
  }
  while (pairsLeft >= 2) {
    sbends[pairOffset] += 1;
    sbends[pairOffset + half] += 1;
    pairsLeft -= 2;
  }
  const hand = ctx.random() < 0.5 ? ('a' as const) : ('b' as const);
  const pairHand = Array.from({ length: half }, () =>
    ctx.random() < 0.35 ? (hand === 'a' ? 'b' : 'a') : hand,
  );
  const sequence: Array<{ partId: string; portId?: string }> = [];
  for (let side = 0; side < corners; side += 1) {
    for (let i = 0; i < sides[side]; i += 1) {
      sequence.push({ partId: 'straight-16' });
    }
    const first = pairHand[side % half];
    const second = first === 'a' ? 'b' : 'a';
    for (let i = 0; i < sbends[side]; i += 1) {
      sequence.push({ partId: 'curve-22', portId: first });
      sequence.push({ partId: 'curve-22', portId: second });
    }
    for (let i = 0; i < wiggles[side]; i += 1) {
      sequence.push({ partId: 'curve-22', portId: first });
      sequence.push({ partId: 'curve-22', portId: second });
      sequence.push({ partId: 'curve-22', portId: second });
      sequence.push({ partId: 'curve-22', portId: first });
    }
    for (let i = 0; i < turns[side]; i += 1) {
      sequence.push({ partId: 'curve-22', portId: 'a' });
    }
  }
  if (straights % 2 === 1) {
    const insertAt = sequence.findIndex((item) => item.partId === 'straight-16');
    if (insertAt >= 0) {
      sequence.splice(insertAt, 0, { partId: 'straight-16' });
    } else {
      sequence.unshift({ partId: 'straight-16' });
    }
  }
  return attachSequence(sequence, ctx, prefix);
}

export function curveCircle(ctx: GenContext, count = 16, prefix = 'c'): PlacedPart[] | null {
  const origin = seedOrigin(ctx);
  const first: PlacedPart = {
    instanceId: nextId(ctx, prefix),
    partId: 'curve-22',
    label: 1,
    x: origin.x,
    y: origin.y,
    rotation: 0,
  };
  const parts = [first];
  let head = freePort(first, ctx.catalog, 'a');
  if (!head) {
    return null;
  }
  for (let i = 1; i < count; i += 1) {
    const move = placeOnHead('curve-22', 'a', head, parts, ctx, prefix);
    if (!move) {
      return null;
    }
    parts.push(move.part);
    head = move.head;
  }
  const goal = worldPorts(ctx.catalog['curve-22'], first).find((port) => port.id === 'a');
  if (!goal || !portsConnect(head, goal)) {
    return null;
  }
  return parts;
}

export function pointToPoint(
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix = 'ptp',
): PlacedPart[] {
  const startId =
    (inventory['straight-16'] ?? 0) > 0
      ? 'straight-16'
      : (inventory['curve-22'] ?? 0) > 0
        ? 'curve-22'
        : '';
  if (!startId) {
    return [];
  }
  const origin = seedOrigin(ctx);
  const start: PlacedPart = {
    instanceId: nextId(ctx, prefix),
    partId: startId,
    label: 1,
    x: origin.x,
    y: origin.y,
    rotation: 0,
  };
  const parts = [start];
  let head = freePort(start, ctx.catalog, 'a');
  if (!head) {
    return parts;
  }
  let tip: WorldPort = head;
  for (let step = 0; step < 120; step += 1) {
    const left = stockOf(inventory, parts);
    const options: Array<{ partId: string; portId: string }> = [];
    if ((left['straight-16'] ?? 0) > 0) {
      options.push({ partId: 'straight-16', portId: 'a' });
    }
    options.push(...curveOptions(left['curve-22'] ?? 0));
    if (options.length === 0) {
      break;
    }
    const pick = options[Math.floor(ctx.random() * options.length)];
    const move = placeOnHead(pick.partId, pick.portId, tip, parts, ctx, prefix);
    if (!move) {
      const fallback = options.find((option) => option !== pick);
      const retry = fallback
        ? placeOnHead(fallback.partId, fallback.portId, tip, parts, ctx, prefix)
        : null;
      if (!retry) {
        break;
      }
      parts.push(retry.part);
      tip = retry.head;
      continue;
    }
    parts.push(move.part);
    tip = move.head;
  }
  return parts;
}

/** Spend leftover straights/curves by replacing a 2-port piece with a longer detour that rejoins. */
export function inflateLoop(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  maxSteps = 20,
  keepStraights = 0,
  preferNested = false,
  preferNear: { x: number; y: number } | null = null,
): PlacedPart[] {
  let result = parts;
  const coreClosed = () =>
    openPorts(result, ctx.catalog).every((port) => port.instanceId.startsWith('sid'));
  const closedAtStart = coreClosed();
  for (let step = 0; step < maxSteps && Date.now() < ctx.deadline; step += 1) {
    const left = stockOf(inventory, result);
    if ((left['straight-16'] ?? 0) <= keepStraights && (left['curve-22'] ?? 0) <= 0) {
      break;
    }
    if ((left['straight-16'] ?? 0) + (left['curve-22'] ?? 0) <= keepStraights) {
      break;
    }
    const candidates = result.filter(
      (part) =>
        (part.partId === 'straight-16' || part.partId === 'curve-22') &&
        !part.instanceId.startsWith('sid'),
    );
    if (candidates.length < 4) {
      break;
    }
    const nested = candidates.filter((part) =>
      ['rte', 'xo', 'par', 'cr', 'kel'].some((prefix) => part.instanceId.startsWith(prefix)),
    );
    const leftoverRigid = (left['straight-16'] ?? 0) + (left['curve-22'] ?? 0);
    const fillRoom = leftoverRigid >= 20 || !!preferNear;
    const main = candidates.filter((part) => !nested.includes(part));
    const pool =
      preferNested && !fillRoom && nested.length > 0
        ? nested
        : nested.length > 0 && !fillRoom && ctx.random() < 0.6
          ? nested
          : candidates;
    let inflated = false;
    const tries = Math.min(fillRoom ? 8 : 4, pool.length);
    const ranked = [...pool].sort((a, b) => {
      if (fillRoom && main.length >= 4) {
        const aMain = main.includes(a) ? 0 : 1;
        const bMain = main.includes(b) ? 0 : 1;
        if (aMain !== bMain) {
          return aMain - bMain;
        }
      }
      if (!preferNear) {
        return 0;
      }
      return (
        Math.hypot(a.x - preferNear.x, a.y - preferNear.y) -
        Math.hypot(b.x - preferNear.x, b.y - preferNear.y)
      );
    });
    for (let attempt = 0; attempt < tries && !inflated; attempt += 1) {
      const pick =
        fillRoom || preferNear
          ? ranked[Math.min(attempt, ranked.length - 1)]
          : pool[Math.floor(ctx.random() * pool.length)];
      const removedPorts = worldPorts(ctx.catalog[pick.partId], pick);
      const without = result.filter((part) => part.instanceId !== pick.instanceId);
      const heads = openPorts(without, ctx.catalog).filter(
        (port) =>
          !port.instanceId.startsWith('sid') &&
          removedPorts.some((removed) => portsConnect(port, removed)),
      );
      if (heads.length < 2) {
        continue;
      }
      const leftovers = stockOf(inventory, without);
      const roomy = (leftovers['curve-22'] ?? 0) >= 20 && (leftovers['straight-16'] ?? 0) >= 8;
      const lotsLeft = (leftovers['curve-22'] ?? 0) >= 12;
      const nestedPick = ['rte', 'xo', 'par', 'cr', 'kel'].some((prefix) =>
        pick.instanceId.startsWith(prefix),
      );
      const joined =
        preferNested && nestedPick && !fillRoom
          ? tryOffsetDetour(without, heads[0], heads[1], inventory, ctx)
          : (tryWideDetour(without, heads[0], heads[1], inventory, ctx) ??
            tryOffsetDetour(without, heads[0], heads[1], inventory, ctx) ??
            (lotsLeft || roomy
              ? ovalJoin(without, heads[0], heads[1], inventory, ctx, 'inf', roomy)
              : null) ??
            joinHeads(without, heads[0], heads[1], inventory, ctx, 'inf'));
      if (!joined || joined.length <= result.length) {
        continue;
      }
      if (closedAtStart && !joinedCoreCloses(joined, ctx.catalog)) {
        continue;
      }
      if (!closedAtStart) {
        const opensAfter = openPorts(joined, ctx.catalog).filter(
          (port) => !port.instanceId.startsWith('sid'),
        ).length;
        const opensBefore = openPorts(result, ctx.catalog).filter(
          (port) => !port.instanceId.startsWith('sid'),
        ).length;
        if (opensAfter > opensBefore) {
          continue;
        }
      }
      result = joined;
      inflated = true;
    }
    if (!inflated) {
      break;
    }
  }
  return result;
}

/** Replace a run of track with a longer inward path so leftover pieces fill empty floor. */
export function fillEmptySpace(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  maxSteps = 6,
  keepStraights = 0,
  preferNear: { x: number; y: number } | null = null,
): PlacedPart[] {
  let result = parts;
  const closedAtStart = joinedCoreCloses(result, ctx.catalog);
  if (!closedAtStart) {
    return result;
  }
  for (let step = 0; step < maxSteps && Date.now() < ctx.deadline - 280; step += 1) {
    const left = stockOf(inventory, result);
    const leftover = (left['straight-16'] ?? 0) + (left['curve-22'] ?? 0);
    const spendableS = Math.max(0, (left['straight-16'] ?? 0) - keepStraights);
    if (spendableS < 2 || leftover <= keepStraights + 8) {
      break;
    }
    const runs = rankStraightRuns(colinearStraightRuns(result, ctx.catalog), preferNear, ctx.random);
    if (runs.length === 0) {
      break;
    }
    let filled = false;
    for (const run of runs.slice(0, 6)) {
      if (filled || Date.now() >= ctx.deadline - 220) {
        break;
      }
      const sizes = [
        ...new Set(
          [run.length, run.length - 1, 12, 10, 8, 7, 6, 5].filter((size) => size >= 5 && size <= run.length),
        ),
      ];
      for (const size of sizes) {
        const from = Math.max(0, Math.floor((run.length - size) / 2));
        const span = run.slice(from, from + size);
        const spanIds = new Set(span.map((part) => part.instanceId));
        const without = result.filter((part) => !spanIds.has(part.instanceId));
        const heads = spanHeads(without, span, ctx);
        if (heads.length < 2) {
          continue;
        }
        const joined =
          tryPocketDetour(without, heads[0], heads[1], inventory, ctx, preferNear, keepStraights) ??
          tryPocketDetour(without, heads[1], heads[0], inventory, ctx, preferNear, keepStraights);
        if (!joined || joined.length <= result.length) {
          continue;
        }
        if (closedAtStart && !joinedCoreCloses(joined, ctx.catalog)) {
          continue;
        }
        result = joined;
        filled = true;
        break;
      }
      if (!filled && run.length >= 3) {
        const pick = run[Math.floor(run.length / 2)];
        const without = result.filter((part) => part.instanceId !== pick.instanceId);
        const heads = spanHeads(without, [pick], ctx);
        if (heads.length >= 2) {
          const bumped =
            tryWideDetour(without, heads[0], heads[1], inventory, ctx) ??
            tryWideDetour(without, heads[1], heads[0], inventory, ctx);
          if (
            bumped &&
            bumped.length > result.length &&
            (!closedAtStart || joinedCoreCloses(bumped, ctx.catalog))
          ) {
            result = bumped;
            filled = true;
          }
        }
      }
    }
    if (!filled) {
      break;
    }
  }
  return result;
}

/** Splice leftover pieces into a connected parallel run along the main circuit. */
export function spliceParallelRun(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  keepStraights = 0,
): PlacedPart[] {
  if (!joinedCoreCloses(parts, ctx.catalog)) {
    return parts;
  }
  let result = parts;
  for (let step = 0; step < 3 && Date.now() < ctx.deadline - 240; step += 1) {
    const left = stockOf(inventory, result);
    const spendableS = Math.max(0, (left['straight-16'] ?? 0) - keepStraights);
    if ((left['curve-22'] ?? 0) < 16 || spendableS < 4) {
      break;
    }
    const preferNear = uncoveredCenter(result, ctx);
    const runs = rankStraightRuns(colinearStraightRuns(result, ctx.catalog), preferNear, ctx.random);
    let grew = false;
    for (const run of runs.slice(0, 8)) {
      if (grew || Date.now() >= ctx.deadline - 200) {
        break;
      }
      if (run.length < 6) {
        continue;
      }
      const sizes = [...new Set([run.length, run.length - 1, 12, 10, 8, 6].filter((size) => size >= 6 && size <= run.length))];
      for (const size of sizes) {
        const from = Math.max(0, Math.floor((run.length - size) * ctx.random()));
        const span = run.slice(from, from + size);
        const spanIds = new Set(span.map((part) => part.instanceId));
        const without = result.filter((part) => !spanIds.has(part.instanceId));
        const heads = spanHeads(without, span, ctx);
        if (heads.length < 2) {
          continue;
        }
        const joined =
          tryLongParallel(without, heads[0], heads[1], inventory, ctx, preferNear, keepStraights) ??
          tryLongParallel(without, heads[1], heads[0], inventory, ctx, preferNear, keepStraights) ??
          tryPocketDetour(without, heads[0], heads[1], inventory, ctx, preferNear, keepStraights) ??
          tryPocketDetour(without, heads[1], heads[0], inventory, ctx, preferNear, keepStraights);
        if (
          joined &&
          joined.length > result.length &&
          joinedCoreCloses(joined, ctx.catalog)
        ) {
          result = joined;
          grew = true;
          break;
        }
      }
    }
    if (!grew) {
      break;
    }
  }
  return result;
}

function uncoveredCenter(parts: PlacedPart[], ctx: GenContext): { x: number; y: number } | null {
  if (!ctx.floorPlan) {
    const cx = parts.reduce((sum, part) => sum + part.x, 0) / Math.max(1, parts.length);
    const cy = parts.reduce((sum, part) => sum + part.y, 0) / Math.max(1, parts.length);
    return { x: cx, y: cy };
  }
  const bounds = floorBounds(ctx.floorPlan);
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = bounds.minY + 24; y < bounds.maxY - 24; y += 24) {
    for (let x = bounds.minX + 24; x < bounds.maxX - 24; x += 24) {
      const point = { x, y };
      if (!pointInPolygon(point, ctx.floorPlan.outer.points, false)) {
        continue;
      }
      if (ctx.floorPlan.obstacles.some((shape) => pointInPolygon(point, shape.points, true))) {
        continue;
      }
      const track = parts.reduce((min, part) => Math.min(min, Math.hypot(part.x - x, part.y - y)), 1e9);
      if (!best || track > best.score) {
        best = { ...point, score: track };
      }
    }
  }
  return best;
}

function colinearStraightRuns(parts: PlacedPart[], catalog: Record<string, TrackPart>): PlacedPart[][] {
  const byId = Object.fromEntries(parts.map((part) => [part.instanceId, part]));
  const straights = new Set(
    parts
      .filter((part) => part.partId === 'straight-16' && !part.instanceId.startsWith('sid'))
      .map((part) => part.instanceId),
  );
  const adj = new Map<string, string[]>();
  for (const id of straights) {
    adj.set(id, []);
  }
  for (const connection of detectConnections(parts, catalog)) {
    if (!straights.has(connection.fromInstanceId) || !straights.has(connection.toInstanceId)) {
      continue;
    }
    const a = byId[connection.fromInstanceId];
    const b = byId[connection.toInstanceId];
    if (!a || !b || !sameCorridor(a, b)) {
      continue;
    }
    adj.get(connection.fromInstanceId)?.push(connection.toInstanceId);
    adj.get(connection.toInstanceId)?.push(connection.fromInstanceId);
  }
  const seen = new Set<string>();
  const runs: PlacedPart[][] = [];
  const starts = [...straights].sort(
    (a, b) => (adj.get(a)?.length ?? 0) - (adj.get(b)?.length ?? 0),
  );
  for (const start of starts) {
    if (seen.has(start) || (adj.get(start)?.length ?? 0) > 1) {
      continue;
    }
    const run: PlacedPart[] = [];
    let previous: string | null = null;
    let current: string | null = start;
    while (current && !seen.has(current)) {
      seen.add(current);
      const part = byId[current];
      if (part) {
        run.push(part);
      }
      const neighbors: string[] = adj.get(current) ?? [];
      const nextNode: string | null =
        neighbors.find((id: string) => id !== previous && !seen.has(id)) ?? null;
      previous = current;
      current = nextNode;
    }
    if (run.length >= 3) {
      runs.push(run);
    }
  }
  return runs;
}

function sameCorridor(a: PlacedPart, b: PlacedPart): boolean {
  return headingDelta(a.rotation, b.rotation) <= 8 || headingDelta(a.rotation, b.rotation + 180) <= 8;
}

function rankStraightRuns(
  runs: PlacedPart[][],
  preferNear: { x: number; y: number } | null,
  random: () => number,
): PlacedPart[][] {
  const scored = runs
    .map((run) => ({
      run,
      near: preferNear ? runDistance(run, preferNear) : 0,
      main: run.filter((part) => part.instanceId.startsWith('pr')).length,
      length: run.length,
    }))
    .sort((a, b) => b.main * 4 + b.length - (a.main * 4 + a.length) || a.near - b.near);
  if (scored.length <= 1) {
    return scored.map((item) => item.run);
  }
  const top = scored.slice(0, Math.min(3, scored.length));
  const pick = Math.floor(random() * top.length);
  return [...top.slice(pick), ...top.slice(0, pick), ...scored.slice(top.length)].map((item) => item.run);
}

function runDistance(run: PlacedPart[], near: { x: number; y: number }): number {
  const cx = run.reduce((sum, part) => sum + part.x, 0) / run.length;
  const cy = run.reduce((sum, part) => sum + part.y, 0) / run.length;
  return Math.hypot(cx - near.x, cy - near.y);
}

function spanHeads(without: PlacedPart[], span: PlacedPart[], ctx: GenContext): WorldPort[] {
  const removedPorts = span.flatMap((part) => worldPorts(ctx.catalog[part.partId], part));
  return openPorts(without, ctx.catalog).filter(
    (port) =>
      !port.instanceId.startsWith('sid') &&
      removedPorts.some((removed) => portsConnect(port, removed)),
  );
}

function joinedCoreCloses(parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  return openPorts(parts, catalog).every((port) => port.instanceId.startsWith('sid'));
}

function tryOffsetDetour(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  return tryBumpDetour(parts, start, target, inventory, ctx, [1, 2, 0], 2);
}

function tryLongParallel(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  toward: { x: number; y: number } | null,
  keepStraights = 0,
): PlacedPart[] | null {
  const gap = distance(start, target);
  if (gap < 96 || gap > 420) {
    return null;
  }
  if (headingDelta(start.heading, target.heading + 180) > 18) {
    return null;
  }
  const left = stockOf(inventory, parts);
  const curves = left['curve-22'] ?? 0;
  const straights = Math.max(0, (left['straight-16'] ?? 0) - keepStraights);
  if (curves < 16 || straights < 8) {
    return null;
  }
  const alongGuess = Math.max(0, Math.round((gap - 80) / 16));
  const alongs = [alongGuess, alongGuess + 1, alongGuess - 1].filter(
    (value, index, all) => value >= 0 && all.indexOf(value) === index,
  );
  const turns: Array<'a' | 'b'> = toward ? preferTurnToward(start, toward) : ['a', 'b'];
  for (const inward of turns) {
    const other: 'a' | 'b' = inward === 'a' ? 'b' : 'a';
    for (const along of alongs) {
      const depths = [8, 7, 6, 5, 4].filter((depth) => depth * 2 + along <= straights);
      for (const depth of depths) {
        if (Date.now() >= ctx.deadline - 200) {
          return null;
        }
        const sequence: Array<{ partId: string; portId?: string }> = [];
        pushCorners(sequence, inward, 4);
        pushStraights(sequence, depth);
        pushCorners(sequence, other, 4);
        pushStraights(sequence, along);
        pushCorners(sequence, other, 4);
        pushStraights(sequence, depth);
        pushCorners(sequence, inward, 4);
        const built = attachSequenceFrom(parts, start, sequence, target, ctx, 'par');
        if (built && built.length >= parts.length + 16 + depth) {
          return built;
        }
      }
    }
  }
  return wanderJoin(parts, start, target, inventory, ctx, 'par', 'inward', 10);
}

function tryPocketDetour(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  toward: { x: number; y: number } | null,
  keepStraights = 0,
): PlacedPart[] | null {
  const gap = distance(start, target);
  if (gap < 64 || gap > 400) {
    return null;
  }
  if (headingDelta(start.heading, target.heading + 180) > 18) {
    return null;
  }
  const left = stockOf(inventory, parts);
  const curves = left['curve-22'] ?? 0;
  const straights = Math.max(0, (left['straight-16'] ?? 0) - keepStraights);
  if (curves < 16) {
    return null;
  }
  const alongGuess = Math.max(0, Math.round((gap - 80) / 16));
  const alongs = [alongGuess, alongGuess + 1, alongGuess - 1, alongGuess + 2].filter(
    (value, index, all) => value >= 0 && all.indexOf(value) === index,
  );
  const turns: Array<'a' | 'b'> = toward ? preferTurnToward(start, toward) : ['a', 'b'];
  for (const inward of turns) {
    const other: 'a' | 'b' = inward === 'a' ? 'b' : 'a';
    for (const along of alongs) {
      const depths = [2, 3, 4, 5, 6, 7, 8].filter((depth) => depth * 2 + along <= straights);
      for (const depth of depths) {
        if (Date.now() >= ctx.deadline - 200) {
          return null;
        }
        const sequence: Array<{ partId: string; portId?: string }> = [];
        pushCorners(sequence, inward, 4);
        pushStraights(sequence, depth);
        pushCorners(sequence, other, 4);
        pushStraights(sequence, along);
        pushCorners(sequence, other, 4);
        pushStraights(sequence, depth);
        pushCorners(sequence, inward, 4);
        const built = attachSequenceFrom(parts, start, sequence, target, ctx, 'fil');
        if (built && built.length >= parts.length + 16 + depth) {
          return built;
        }
      }
    }
  }
  return null;
}

function preferTurnToward(start: WorldPort, toward: { x: number; y: number }): Array<'a' | 'b'> {
  const rad = ((start.heading + 90) * Math.PI) / 180;
  const left = {
    x: start.x + Math.cos(rad) * 24,
    y: start.y + Math.sin(rad) * 24,
  };
  const right = {
    x: start.x - Math.cos(rad) * 24,
    y: start.y - Math.sin(rad) * 24,
  };
  const leftCloser =
    Math.hypot(left.x - toward.x, left.y - toward.y) <= Math.hypot(right.x - toward.x, right.y - toward.y);
  return leftCloser ? ['a', 'b'] : ['b', 'a'];
}

function pushCorners(
  sequence: Array<{ partId: string; portId?: string }>,
  turn: 'a' | 'b',
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    sequence.push({ partId: 'curve-22', portId: turn });
  }
}

function tryWideDetour(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const left = stockOf(inventory, parts);
  if ((left['curve-22'] ?? 0) < 4 && (left['straight-16'] ?? 0) < 3) {
    return null;
  }
  return (
    tryBumpDetour(parts, start, target, inventory, ctx, [4, 3, 2, 6, 5], 2) ??
    tryBumpDetour(parts, start, target, inventory, ctx, [3, 2, 4, 1, 0], 4)
  );
}

function tryBumpDetour(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  extras: number[],
  corners: 2 | 4,
): PlacedPart[] | null {
  const left = stockOf(inventory, parts);
  const curves = left['curve-22'] ?? 0;
  const straights = left['straight-16'] ?? 0;
  if (curves < corners) {
    return null;
  }
  const usable = extras.filter((count) => count <= straights);
  const turns: Array<['a' | 'b', 'a' | 'b']> = [
    ['a', 'b'],
    ['b', 'a'],
  ];
  for (const [first, second] of turns) {
    for (const extra of usable) {
      const sequence: Array<{ partId: string; portId?: string }> = [];
      const half = corners / 2;
      for (let i = 0; i < half; i += 1) {
        sequence.push({ partId: 'curve-22', portId: first });
      }
      for (let i = 0; i < extra; i += 1) {
        sequence.push({ partId: 'straight-16' });
      }
      for (let i = 0; i < half; i += 1) {
        sequence.push({ partId: 'curve-22', portId: second });
      }
      const built = attachSequenceFrom(parts, start, sequence, target, ctx, 'det');
      if (built && built.length > parts.length + 1) {
        return built;
      }
    }
  }
  return null;
}

export function attachSequenceFrom(
  parts: PlacedPart[],
  start: WorldPort,
  sequence: Array<{ partId: string; portId?: string }>,
  target: WorldPort,
  ctx: GenContext,
  prefix: string,
): PlacedPart[] | null {
  let trail = parts;
  let tip = start;
  const ignore = [target.instanceId, start.instanceId];
  for (const item of sequence) {
    const portId = item.portId ?? ctx.catalog[item.partId].ports[0].id;
    const move = placeOnHead(item.partId, portId, tip, trail, ctx, prefix, ignore);
    if (!move) {
      return null;
    }
    trail = [...trail, move.part];
    tip = move.head;
    if (portsConnect(tip, target)) {
      return trail;
    }
  }
  return portsConnect(tip, target) ? trail : null;
}

/** Join two facing heads with a dogleg when they sit on a lateral offset. */
export function offsetJoin(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix = 'jn',
): PlacedPart[] | null {
  if (portsConnect(start, target)) {
    return parts;
  }
  const face = headingDelta(start.heading, target.heading + 180);
  if (face > 100) {
    return null;
  }
  const rad = (start.heading * Math.PI) / 180;
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const along = dx * Math.cos(rad) + dy * Math.sin(rad);
  const left = stockOf(inventory, parts);
  const curves = left['curve-22'] ?? 0;
  const straights = left['straight-16'] ?? 0;
  if (curves < 2 || (straights < 1 && along > 20)) {
    return null;
  }
  const alongN = Math.max(0, Math.round(along / 16));
  const side = Math.abs(-dx * Math.sin(rad) + dy * Math.cos(rad));
  const sideN = Math.max(0, Math.round(side / 16));
  const turns = preferTurnToward(start, target);
  const corners = [4, 2, 6, 3, 5, 8].filter((count) => count <= curves);
  const alongs = uniqueCounts(alongN, straights, 4).sort(
    (a, b) => Math.abs(a - (alongN - 3)) - Math.abs(b - (alongN - 3)),
  );
  const sides = uniqueCounts(sideN, straights, 3).sort(
    (a, b) => Math.abs(a - (sideN - 3)) - Math.abs(b - (sideN - 3)),
  );
  let attempts = 0;
  const trySeq = (sequence: Array<{ partId: string; portId?: string }>): PlacedPart[] | null => {
    attempts += 1;
    if (attempts > 120 || Date.now() >= ctx.deadline) {
      return null;
    }
    return attachSequenceFrom(parts, start, sequence, target, ctx, prefix);
  };
  for (const turn of turns) {
    for (const corner of corners) {
      for (const run of alongs) {
        for (const offset of sides) {
          if (run + offset > straights) {
            continue;
          }
          const ell: Array<{ partId: string; portId?: string }> = [];
          pushStraights(ell, run);
          pushCurves(ell, corner, turn);
          pushStraights(ell, offset);
          const found = trySeq(ell);
          if (found) {
            return found;
          }
        }
      }
    }
  }
  const otherOf = (turn: 'a' | 'b'): 'a' | 'b' => (turn === 'a' ? 'b' : 'a');
  for (const turn of turns) {
    for (const corner of [4, 2, 3].filter((count) => count * 2 <= curves)) {
      for (const run of alongs.slice(0, 4)) {
        for (const offset of sides.slice(0, 4)) {
          if (run + offset > straights) {
            continue;
          }
          const ess: Array<{ partId: string; portId?: string }> = [];
          pushStraights(ess, run);
          pushCurves(ess, corner, turn);
          pushStraights(ess, offset);
          pushCurves(ess, corner, otherOf(turn));
          const found = trySeq(ess);
          if (found) {
            return found;
          }
        }
      }
    }
  }
  return null;
}

function uniqueCounts(center: number, max: number, span: number): number[] {
  const values = new Set<number>();
  for (let delta = 0; delta <= span; delta += 1) {
    values.add(Math.max(0, center - delta));
    values.add(Math.min(max, center + delta));
  }
  return [...values].filter((count) => count >= 0 && count <= max);
}

function pushCurves(
  sequence: Array<{ partId: string; portId?: string }>,
  count: number,
  turn: 'a' | 'b',
): void {
  for (let i = 0; i < count; i += 1) {
    sequence.push({ partId: 'curve-22', portId: turn });
  }
}

function pushStraights(sequence: Array<{ partId: string; portId?: string }>, count: number): void {
  for (let i = 0; i < count; i += 1) {
    sequence.push({ partId: 'straight-16' });
  }
}

function ovalSequence(
  side: number,
  end: number,
  turn: 'a' | 'b',
  sbends = 0,
): Array<{ partId: string; portId?: string }> {
  const sequence: Array<{ partId: string; portId?: string }> = [];
  const other = turn === 'a' ? 'b' : 'a';
  const addSbends = () => {
    for (let i = 0; i < sbends; i += 1) {
      sequence.push({ partId: 'curve-22', portId: turn });
      sequence.push({ partId: 'curve-22', portId: other });
    }
  };
  pushCurves(sequence, 4, turn);
  pushStraights(sequence, side);
  addSbends();
  pushCurves(sequence, 4, turn);
  pushStraights(sequence, end);
  pushCurves(sequence, 4, turn);
  pushStraights(sequence, side);
  addSbends();
  pushCurves(sequence, 4, turn);
  return sequence;
}

export function ovalJoin(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix: string,
  preferRoomy = false,
  turnOrder: Array<'a' | 'b'> = ['a', 'b'],
): PlacedPart[] | null {
  if (portsConnect(start, target)) {
    return parts;
  }
  const left = stockOf(inventory, parts);
  const curves = left['curve-22'] ?? 0;
  const straights = left['straight-16'] ?? 0;
  const reserveC = preferRoomy ? 16 : 0;
  const reserveS = preferRoomy ? 4 : 0;
  const preferredEnd = Math.max(0, Math.round(distance(start, target) / 16));
  const maxSide = Math.min(
    preferRoomy ? 28 : 10,
    Math.max(0, Math.floor((straights - preferredEnd - reserveS) / 2)),
  );
  const maxEnd = Math.min(14, straights);
  const compactEnds = [preferredEnd, 2, 1, 0, 3, 4].filter(
    (end, index, all) => end >= 0 && end <= maxEnd && all.indexOf(end) === index,
  );
  const endOrder = preferRoomy ? [preferredEnd, 2].filter((end) => end >= 0 && end <= maxEnd) : compactEnds;
  const sideOrder = preferRoomy
    ? [...new Set([maxSide, Math.max(1, Math.floor(maxSide * 0.6)), 4, 2, 1, 0])]
    : [1, 0, 2, 3, 4];
  const maxSbends = preferRoomy ? Math.floor(Math.max(0, curves - 16 - reserveC) / 4) : 0;
  const sbendOrder =
    maxSbends > 0 ? [...new Set([maxSbends, Math.floor(maxSbends / 2), Math.floor(maxSbends / 4), 0])] : [0];

  if (curves >= 16) {
    let attempts = 0;
    const attemptCap = preferRoomy ? 20 : 24;
    for (const sbends of sbendOrder) {
      if (16 + sbends * 4 > curves) {
        continue;
      }
      for (const side of sideOrder) {
        if (side > maxSide) {
          continue;
        }
        for (const end of endOrder) {
          if (side * 2 + end > straights) {
            continue;
          }
          for (const turn of turnOrder) {
            attempts += 1;
            if (attempts > attemptCap) {
              break;
            }
            const built = attachSequenceFrom(
              parts,
              start,
              ovalSequence(side, end, turn, sbends),
              target,
              ctx,
              prefix,
            );
            if (built) {
              return built;
            }
          }
        }
      }
    }
  }

  if (curves >= 8) {
    for (const turn of turnOrder) {
      for (let end = 0; end <= Math.min(12, straights); end += 1) {
        const sequence: Array<{ partId: string; portId?: string }> = [];
        pushCurves(sequence, 4, turn);
        pushStraights(sequence, end);
        pushCurves(sequence, 4, turn);
        const built = attachSequenceFrom(parts, start, sequence, target, ctx, prefix);
        if (built) {
          return built;
        }
      }
    }
  }

  const fromStart = joinHeads(parts, start, target, inventory, ctx, prefix);
  if (fromStart) {
    return fromStart;
  }
  return joinHeads(parts, target, start, inventory, ctx, `${prefix}r`);
}

export function growDeadEnd(
  parts: PlacedPart[],
  start: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  length: number,
  prefix: string,
): PlacedPart[] {
  const result = [...parts];
  let current = start;
  for (let i = 0; i < length; i += 1) {
    const left = remainingInventory(inventory, result);
    const partIds = [
      ...(left['straight-16'] ? ['straight-16'] : []),
      ...(left['curve-22'] ? ['curve-22'] : []),
    ];
    if (partIds.length === 0) {
      break;
    }
    let placed = false;
    for (const partId of partIds) {
      const portIds = ctx.catalog[partId].ports.map((port) => port.id);
      for (const portId of portIds) {
        const move = placeOnHead(partId, portId, current, result, ctx, prefix);
        if (!move) {
          continue;
        }
        const wouldJoin = openPorts(result, ctx.catalog).some(
          (port) => port.instanceId !== current.instanceId && portsConnect(move.head, port),
        );
        if (wouldJoin) {
          continue;
        }
        result.push(move.part);
        current = move.head;
        placed = true;
        break;
      }
      if (placed) {
        break;
      }
    }
    if (!placed) {
      break;
    }
  }
  return result;
}
