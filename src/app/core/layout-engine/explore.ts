import { FloorPlan } from '../../shared/models/floor-plan';
import { GenerationPreferences, PlacedPart } from '../../shared/models/track';
import { floorBounds, pointInPolygon, placementHitsRoom, wallWaypoints } from '../floor-plan/space';
import { openPorts, remainingInventory } from './connections';
import { distance, headingDelta, portsConnect, WorldPort, worldPorts } from './geometry';
import { GenContext, neighborsOf, nextId, placeOnHead, tryAttach } from './place';
import { homeScore, inflateLoop, joinHeads, loopCloses, offsetJoin, ovalJoin, wanderJoin } from './wander';

const MIN_SPECIAL_GAP = 72;

export function exploreSpace(
  inventory: Record<string, number>,
  ctx: GenContext,
  prefs: GenerationPreferences,
): PlacedPart[] {
  const start = seedStart(inventory, ctx);
  if (!start) {
    return [];
  }
  let parts = [start];
  const maxSteps = Math.min(160, 8 + Object.values(inventory).reduce((sum, qty) => sum + qty, 0));
  let lastSpecialAt = { x: start.x, y: start.y };
  let idle = 0;

  for (let step = 0; step < maxSteps && Date.now() < ctx.deadline - 450; step += 1) {
    const stock = remainingInventory(inventory, parts);
    const leftover = (stock['straight-16'] ?? 0) + (stock['curve-22'] ?? 0);
    const heads = openPorts(parts, ctx.catalog);
    const gap = uncoveredSpot(parts, ctx.floorPlan);
    const filling = leftover > 20 && (gap?.clearance ?? 0) > 40;
    if (heads.length === 2 && leftover >= 4 && !filling) {
      const closed =
        joinHeads(parts, heads[0], heads[1], inventory, ctx, 'jn') ??
        joinHeads(parts, heads[1], heads[0], inventory, ctx, 'jn');
      if (closed && loopCloses(closed, ctx.catalog)) {
        parts = closed;
        break;
      }
    }
    if (!heads.length) {
      if (leftover < 2) {
        break;
      }
      const inflated = inflateLoop(parts, inventory, ctx, 14, prefs.targetParkingSpots * 6, true);
      if (inflated.length <= parts.length) {
        break;
      }
      parts = inflated;
      idle = 0;
      continue;
    }

    if (prefs.targetParkingSpots > 0 && parts.length >= (filling ? 28 : 8)) {
      const placedSwitch = maybePlaceSwitch(parts, inventory, ctx, heads, lastSpecialAt, prefs);
      if (placedSwitch) {
        parts = placedSwitch.parts;
        lastSpecialAt = { x: placedSwitch.at.x, y: placedSwitch.at.y };
        idle = 0;
        continue;
      }
    }

    const grown = growBestHead(parts, inventory, ctx, heads, filling);
    if (grown) {
      parts = grown;
      idle = 0;
      continue;
    }

    const joined = joinNearestHeads(parts, inventory, ctx, heads, filling ? 24 : 80);
    if (joined) {
      parts = joined;
      idle = 0;
      continue;
    }

    idle += 1;
    if (idle > 12) {
      break;
    }
  }

  parts = closeOpenHeads(parts, inventory, ctx, prefs.targetParkingSpots);
  const leftover = remainingInventory(inventory, parts);
  if ((leftover['straight-16'] ?? 0) + (leftover['curve-22'] ?? 0) > 0) {
    const empty = uncoveredSpot(parts, ctx.floorPlan);
    const steps = (empty?.clearance ?? 0) > 36 ? 28 : 16;
    parts = inflateLoop(parts, inventory, ctx, steps, prefs.targetParkingSpots * 6, false, empty?.point ?? null);
    parts = closeOpenHeads(parts, inventory, ctx, prefs.targetParkingSpots);
  }
  return parts;
}

function seedStart(inventory: Record<string, number>, ctx: GenContext): PlacedPart | null {
  const partId =
    (inventory['straight-16'] ?? 0) > 0 ? 'straight-16' : (inventory['curve-22'] ?? 0) > 0 ? 'curve-22' : '';
  if (!partId) {
    return null;
  }
  const rotations = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180];
  const candidates: Array<{ x: number; y: number; rotation: number }> = [];
  if (ctx.origin) {
    candidates.push({ x: ctx.origin.x, y: ctx.origin.y, rotation: 0 });
  }
  candidates.push({ x: 0, y: 0, rotation: 0 });
  if (ctx.floorPlan) {
    const outer = ctx.floorPlan.outer.points;
    for (let i = 0; i < outer.length; i += 1) {
      const a = outer[i];
      const b = outer[(i + 1) % outer.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const inset = 18;
      const nx = (a.y - b.y) / length;
      const ny = (b.x - a.x) / length;
      for (const sign of [1, -1]) {
        const x = mid.x + nx * inset * sign;
        const y = mid.y + ny * inset * sign;
        if (pointInPolygon({ x, y }, outer, false)) {
          candidates.push({ x, y, rotation: 0 });
        }
      }
    }
  }
  for (const pose of candidates) {
    for (const rotation of rotations) {
      const part: PlacedPart = {
        instanceId: nextId(ctx, 'ex'),
        partId,
        label: 1,
        x: pose.x,
        y: pose.y,
        rotation,
      };
      if (ctx.floorPlan && placementHitsRoom(part, ctx.catalog, ctx.floorPlan)) {
        continue;
      }
      return part;
    }
  }
  return null;
}

function growBestHead(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  heads: WorldPort[],
  filling = false,
): PlacedPart[] | null {
  const stock = remainingInventory(inventory, parts);
  const types = ['straight-16', 'curve-22'].filter((id) => (stock[id] ?? 0) > 0);
  if (!types.length) {
    return null;
  }
  const others = heads;
  let best: { parts: PlacedPart[]; score: number } | null = null;
  const far =
    uncoveredWallSpot(parts, ctx.floorPlan)?.point ??
    uncoveredSpot(parts, ctx.floorPlan)?.point ??
    farFloorPoint(parts, ctx.floorPlan);
  const sample = filling && far && heads.length > 2
    ? [...heads]
        .sort((a, b) => Math.hypot(a.x - far.x, a.y - far.y) - Math.hypot(b.x - far.x, b.y - far.y))
        .slice(0, 2)
    : ctx.floorPlan || heads.length <= 6
      ? heads
      : heads.filter((_, index) => index % Math.ceil(heads.length / 4) === 0);
  const cx = parts.reduce((sum, part) => sum + part.x, 0) / parts.length;
  const cy = parts.reduce((sum, part) => sum + part.y, 0) / parts.length;
  for (const head of sample) {
    for (const type of types) {
      const part = ctx.catalog[type];
      for (const local of part.ports) {
        const candidate = tryAttach(
          part,
          local.id,
          head,
          parts,
          ctx.catalog,
          nextId(ctx, 'ex'),
          [],
          ctx.floorPlan,
        );
        if (!candidate) {
          continue;
        }
        const free = worldPorts(part, candidate).find((port) => port.id !== local.id);
        if (!free) {
          continue;
        }
        const mate = others.find((port) => port.instanceId !== head.instanceId);
        const goal = !filling && mate ? mate : far;
        const toward = others
          .filter((port) => port.instanceId !== head.instanceId)
          .reduce((min, port) => Math.min(min, distance(free, port)), 240);
        const leftover = remainingInventory(inventory, [...parts, candidate]);
        const remaining = (leftover['straight-16'] ?? 0) + (leftover['curve-22'] ?? 0);
        const wall = wallScore(free, ctx.floorPlan);
        const mix = type === 'curve-22' && ctx.random() < 0.55 ? 6 : 0;
        const headBias = goal ? Math.hypot(head.x - goal.x, head.y - goal.y) * 0.2 : 0;
        const score = ctx.floorPlan
          ? roomGrowScore(free, remaining, toward, wall, mix, cx, cy, goal, ctx.random(), head) + headBias
          : toward * 0.35 + wall + mix + (remaining > 18 ? Math.max(0, 90 - toward) : 0) + ctx.random() * 4;
        if (!best || score < best.score) {
          best = { parts: [...parts, candidate], score };
        }
      }
    }
  }
  return best?.parts ?? null;
}

function roomGrowScore(
  free: { x: number; y: number },
  remaining: number,
  toward: number,
  wall: number,
  mix: number,
  cx: number,
  cy: number,
  far: { x: number; y: number } | null,
  noise: number,
  head: { x: number; y: number },
): number {
  const progress = far
    ? Math.hypot(free.x - far.x, free.y - far.y) - Math.hypot(head.x - far.x, head.y - far.y)
    : 0;
  const expand = -Math.hypot(free.x - cx, free.y - cy) * 0.15;
  const close = remaining <= 16 ? toward * 0.55 : 0;
  return wall * 0.9 + progress * 2.6 + expand + close + mix * 0.4 + noise * 2;
}

export function uncoveredSpot(
  parts: PlacedPart[],
  plan?: FloorPlan | null,
): { point: { x: number; y: number }; clearance: number } | null {
  if (!plan) {
    return null;
  }
  const bounds = floorBounds(plan);
  let best: { point: { x: number; y: number }; clearance: number } | null = null;
  for (let y = bounds.minY + 16; y < bounds.maxY - 16; y += 24) {
    for (let x = bounds.minX + 16; x < bounds.maxX - 16; x += 24) {
      const point = { x, y };
      if (!pointInPolygon(point, plan.outer.points, false)) {
        continue;
      }
      if (plan.obstacles.some((shape) => pointInPolygon(point, shape.points, true))) {
        continue;
      }
      const clearance = parts.reduce((min, part) => Math.min(min, Math.hypot(part.x - x, part.y - y)), 1e9);
      if (!best || clearance > best.clearance) {
        best = { point, clearance };
      }
    }
  }
  return best;
}

function uncoveredWallSpot(
  parts: PlacedPart[],
  plan?: FloorPlan | null,
): { point: { x: number; y: number }; clearance: number } | null {
  if (!plan) {
    return null;
  }
  let best: { point: { x: number; y: number }; clearance: number } | null = null;
  for (const point of wallWaypoints(plan)) {
    const clearance = parts.reduce(
      (min, part) => Math.min(min, Math.hypot(part.x - point.x, part.y - point.y)),
      1e9,
    );
    if (!best || clearance > best.clearance) {
      best = { point, clearance };
    }
  }
  return best;
}

function farFloorPoint(
  parts: PlacedPart[],
  plan?: FloorPlan | null,
): { x: number; y: number } | null {
  if (!plan?.outer.points.length) {
    return null;
  }
  const cx = parts.reduce((sum, part) => sum + part.x, 0) / Math.max(1, parts.length);
  const cy = parts.reduce((sum, part) => sum + part.y, 0) / Math.max(1, parts.length);
  let best = plan.outer.points[0];
  let bestDist = -1;
  for (const point of plan.outer.points) {
    const dist = Math.hypot(point.x - cx, point.y - cy);
    if (dist > bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best;
}

function wallScore(point: { x: number; y: number }, plan?: FloorPlan | null): number {
  if (!plan) {
    return 0;
  }
  let nearest = 80;
  const shapes = [plan.outer, ...plan.obstacles];
  for (const shape of shapes) {
    for (let i = 0; i < shape.points.length; i += 1) {
      const a = shape.points[i];
      const b = shape.points[(i + 1) % shape.points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      nearest = Math.min(nearest, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
    }
  }
  return Math.abs(nearest - 8);
}

function maybePlaceSwitch(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  heads: WorldPort[],
  lastSpecial: { x: number; y: number },
  prefs: GenerationPreferences,
): { parts: PlacedPart[]; at: { x: number; y: number } } | null {
  const stock = remainingInventory(inventory, parts);
  const left = (stock['switch-left'] ?? 0) > 0;
  const right = (stock['switch-right'] ?? 0) > 0;
  if (!left && !right) {
    return null;
  }
  const placed = parts.filter((part) => part.partId.startsWith('switch-')).length;
  const parkingReserve = prefs.targetParkingSpots > 0 && placed >= 1 ? 1 : 0;
  if ((stock['switch-left'] ?? 0) + (stock['switch-right'] ?? 0) <= parkingReserve && placed > 0) {
    return null;
  }
  if (parts.length < 8) {
    return null;
  }
  const kind = left && right ? (ctx.random() < 0.5 ? 'switch-left' : 'switch-right') : left ? 'switch-left' : 'switch-right';
  const placedSwitches = parts.filter((part) => part.partId.startsWith('switch-'));
  for (const head of heads) {
    if (distance(head, lastSpecial) < MIN_SPECIAL_GAP) {
      continue;
    }
    if (placedSwitches.some((part) => distance(head, part) < MIN_SPECIAL_GAP)) {
      continue;
    }
    const move = placeOnHead(kind, 'stem', head, parts, ctx, 'sw');
    if (!move) {
      continue;
    }
    const next = [...parts, move.part];
    const opens = worldPorts(ctx.catalog[kind], move.part).filter((port) => port.id !== 'stem');
    if (opens.length < 2) {
      continue;
    }
    return { parts: next, at: { x: move.part.x, y: move.part.y } };
  }
  return null;
}

function joinNearestHeads(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  heads: WorldPort[],
  maxDist = 80,
): PlacedPart[] | null {
  if (heads.length < 2) {
    return null;
  }
  let pair: [WorldPort, WorldPort] | null = null;
  let best = maxDist;
  for (let i = 0; i < heads.length; i += 1) {
    for (let j = i + 1; j < heads.length; j += 1) {
      const dist = distance(heads[i], heads[j]);
      if (dist < best) {
        best = dist;
        pair = [heads[i], heads[j]];
      }
    }
  }
  if (!pair) {
    return null;
  }
  return tryJoinHeads(parts, pair[0], pair[1], inventory, ctx);
}

export function closeOpenHeads(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  keepOpen = 0,
): PlacedPart[] {
  let result = parts;
  for (let attempt = 0; attempt < 24 && Date.now() < ctx.deadline; attempt += 1) {
    const heads = openPorts(result, ctx.catalog).filter((port) =>
      keepOpen > 0 ? !port.instanceId.startsWith('sid') : true,
    );
    if (heads.length < 2) {
      break;
    }
    const pairs: Array<[WorldPort, WorldPort, number]> = [];
    for (let i = 0; i < heads.length; i += 1) {
      for (let j = i + 1; j < heads.length; j += 1) {
        pairs.push([heads[i], heads[j], pairCloseScore(heads[i], heads[j])]);
      }
    }
    pairs.sort((a, b) => a[2] - b[2]);
    let progressed = false;
    for (const [from, to] of pairs) {
      const joined =
        tryPeelJoin(result, from, to, inventory, ctx) ??
        tryJoinHeads(result, from, to, inventory, ctx);
      if (joined) {
        result = joined;
        progressed = true;
        break;
      }
    }
    if (!progressed || (keepOpen <= 0 && loopCloses(result, ctx.catalog))) {
      break;
    }
  }
  return result;
}

function pairCloseScore(a: WorldPort, b: WorldPort): number {
  const dist = distance(a, b);
  const bear = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return dist + headingDelta(a.heading, bear) + headingDelta(b.heading, bear + 180);
}

function tryJoinHeads(
  parts: PlacedPart[],
  from: WorldPort,
  to: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const leftover = remainingInventory(inventory, parts);
  const stock = (leftover['straight-16'] ?? 0) + (leftover['curve-22'] ?? 0);
  const joined =
    joinHeads(parts, from, to, inventory, ctx, 'jn') ??
    joinHeads(parts, to, from, inventory, ctx, 'jn');
  if (joined && joined.length >= parts.length) {
    return joined;
  }
  const turned = turnThenJoin(parts, from, to, inventory, ctx) ?? turnThenJoin(parts, to, from, inventory, ctx);
  if (turned) {
    return turned;
  }
  const roomy = stock > 24;
  const oval =
    ovalJoin(parts, from, to, inventory, ctx, 'jn', roomy) ??
    ovalJoin(parts, to, from, inventory, ctx, 'jn', roomy) ??
    ovalJoin(parts, from, to, inventory, ctx, 'jn', !roomy) ??
    ovalJoin(parts, to, from, inventory, ctx, 'jn', !roomy);
  if (oval) {
    return oval;
  }
  const offset =
    offsetJoin(parts, from, to, inventory, ctx, 'jn') ??
    offsetJoin(parts, to, from, inventory, ctx, 'jn');
  if (offset) {
    return offset;
  }
  const hugged = hugWallJoin(parts, from, to, inventory, ctx);
  if (hugged) {
    return hugged;
  }
  const met = meetInMiddle(parts, from, to, inventory, ctx);
  if (met) {
    return met;
  }
  if (stock >= 8 && ctx.deadline - Date.now() > 250 && !ctx.floorPlan) {
    return (
      wanderJoin(parts, from, to, inventory, ctx, 'jn', 'mixed') ??
      wanderJoin(parts, to, from, inventory, ctx, 'jn', 'mixed')
    );
  }
  return null;
}

function peelOpenHead(
  parts: PlacedPart[],
  head: WorldPort,
  steps: number,
  catalog: GenContext['catalog'],
): { parts: PlacedPart[]; head: WorldPort } | null {
  if (steps <= 0) {
    return { parts, head };
  }
  let trail = parts;
  let tip = head;
  for (let step = 0; step < steps; step += 1) {
    if (tip.instanceId.startsWith('sid') || tip.instanceId.startsWith('sw')) {
      return null;
    }
    const neighbors = neighborsOf(tip.instanceId, trail, catalog);
    if (neighbors.length !== 1) {
      return null;
    }
    const without = trail.filter((part) => part.instanceId !== tip.instanceId);
    const nextOpens = openPorts(without, catalog).filter((port) => port.instanceId === neighbors[0]);
    if (nextOpens.length !== 1) {
      return null;
    }
    trail = without;
    tip = nextOpens[0];
  }
  return { parts: trail, head: tip };
}

function tryPeelJoin(
  parts: PlacedPart[],
  from: WorldPort,
  to: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  if (distance(from, to) > 220 || Date.now() >= ctx.deadline - 160) {
    return null;
  }
  const peels: Array<[number, number]> = [
    [0, 4],
    [4, 0],
    [4, 4],
    [0, 8],
    [8, 0],
    [0, 6],
    [6, 0],
    [2, 2],
    [1, 1],
    [2, 0],
    [0, 2],
  ];
  for (const [peelFrom, peelTo] of peels) {
    if (Date.now() >= ctx.deadline - 120) {
      return null;
    }
    const a = peelOpenHead(parts, from, peelFrom, ctx.catalog);
    if (!a) {
      continue;
    }
    const b = peelOpenHead(a.parts, to, peelTo, ctx.catalog);
    if (!b) {
      continue;
    }
    const liveFrom =
      openPorts(b.parts, ctx.catalog).find(
        (port) => port.instanceId === a.head.instanceId && port.id === a.head.id,
      ) ?? openPorts(b.parts, ctx.catalog).find((port) => port.instanceId === a.head.instanceId);
    if (!liveFrom) {
      continue;
    }
    const joined =
      offsetJoin(b.parts, liveFrom, b.head, inventory, ctx, 'jn') ??
      offsetJoin(b.parts, b.head, liveFrom, inventory, ctx, 'jn');
    if (joined && openPorts(joined, ctx.catalog).length < openPorts(parts, ctx.catalog).length) {
      return joined;
    }
  }
  return null;
}

function turnThenJoin(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const left = remainingInventory(inventory, parts);
  if ((left['curve-22'] ?? 0) < 8) {
    return null;
  }
  for (const portId of ['a', 'b'] as const) {
    let trail = parts;
    let tip = start;
    let placed = 0;
    for (let step = 0; step < 8; step += 1) {
      const move = placeOnHead('curve-22', portId, tip, trail, ctx, 'jn', [target.instanceId]);
      if (!move) {
        break;
      }
      trail = [...trail, move.part];
      tip = move.head;
      placed += 1;
      if (portsConnect(tip, target)) {
        return trail;
      }
    }
    if (placed < 4) {
      continue;
    }
    const closed = joinHeads(trail, tip, target, inventory, ctx, 'jn');
    if (closed) {
      return closed;
    }
  }
  return null;
}

function hugWallJoin(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  if (!ctx.floorPlan) {
    return null;
  }
  for (const side of [1, -1] as const) {
    const walked = hugWallWalk(parts, start, target, inventory, ctx, side);
    if (walked) {
      return walked;
    }
    const reverse = hugWallWalk(parts, target, start, inventory, ctx, side);
    if (reverse) {
      return reverse;
    }
  }
  return null;
}

function hugWallWalk(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  side: 1 | -1,
): PlacedPart[] | null {
  let result = parts;
  let current = start;
  let stuck = 0;
  for (let step = 0; step < 72 && Date.now() < ctx.deadline; step += 1) {
    if (portsConnect(current, target)) {
      return result;
    }
    if (distance(current, target) < 40) {
      const snapped = joinHeads(result, current, target, inventory, ctx, 'jn');
      if (snapped) {
        return snapped;
      }
    }
    const inch = hugStep(result, current, target, inventory, ctx, side);
    if (!inch) {
      stuck += 1;
      if (stuck > 2) {
        break;
      }
      const trimmed = trimHead(result, current, ctx);
      if (!trimmed) {
        break;
      }
      result = trimmed.parts;
      current = trimmed.head;
      continue;
    }
    stuck = 0;
    result = inch.parts;
    current = inch.head;
  }
  return portsConnect(current, target) ? result : null;
}

function hugStep(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  side: 1 | -1,
): { parts: PlacedPart[]; head: WorldPort } | null {
  const left = remainingInventory(inventory, parts);
  const types = ['straight-16', 'curve-22'].filter((id) => (left[id] ?? 0) > 0);
  let best: { part: PlacedPart; free: WorldPort; score: number } | null = null;
  const ignore = [target.instanceId, start.instanceId];
  const prevDist = distance(start, target);
  for (const type of types) {
    const part = ctx.catalog[type];
    for (const local of part.ports) {
      const candidate = tryAttach(
        part,
        local.id,
        start,
        parts,
        ctx.catalog,
        nextId(ctx, 'jn'),
        ignore,
        ctx.floorPlan,
      );
      if (!candidate) {
        continue;
      }
      const free = worldPorts(part, candidate).find((port) => port.id !== local.id);
      if (!free) {
        continue;
      }
      if (portsConnect(free, target)) {
        return { parts: [...parts, candidate], head: free };
      }
      const turn = local.id === 'a' ? 1 : local.id === 'b' ? -1 : 0;
      const score =
        wallScore(free, ctx.floorPlan) * 1.6 +
        (distance(free, target) - prevDist) * 1.2 +
        distance(free, target) * 0.18 +
        (type === 'curve-22' && turn === side ? -5 : 0);
      if (!best || score < best.score) {
        best = { part: candidate, free, score };
      }
    }
  }
  return best ? { parts: [...parts, best.part], head: best.free } : null;
}

function meetInMiddle(
  parts: PlacedPart[],
  from: WorldPort,
  to: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  let result = parts;
  let left = from;
  let right = to;
  for (let step = 0; step < 48 && Date.now() < ctx.deadline; step += 1) {
    if (portsConnect(left, right)) {
      return result;
    }
    if (
      !openPorts(result, ctx.catalog).some((port) => port.instanceId === right.instanceId && port.id === right.id)
    ) {
      return result;
    }
    const inch = stepToward(result, left, right, inventory, ctx);
    if (!inch) {
      const trimmed = trimHead(result, left, ctx);
      if (!trimmed) {
        break;
      }
      result = trimmed.parts;
      left = trimmed.head;
      continue;
    }
    result = inch.parts;
    left = inch.head;
    const swap = left;
    left = right;
    right = swap;
  }
  return null;
}

function stepToward(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): { parts: PlacedPart[]; head: WorldPort } | null {
  const left = remainingInventory(inventory, parts);
  const types = ['straight-16', 'curve-22'].filter((id) => (left[id] ?? 0) > 0);
  let best: { part: PlacedPart; free: WorldPort; score: number } | null = null;
  const ignore = [target.instanceId, start.instanceId];
  for (const type of types) {
    const part = ctx.catalog[type];
    for (const local of part.ports) {
      const candidate = tryAttach(
        part,
        local.id,
        start,
        parts,
        ctx.catalog,
        nextId(ctx, 'jn'),
        ignore,
        ctx.floorPlan,
      );
      if (!candidate) {
        continue;
      }
      const free = worldPorts(part, candidate).find((port) => port.id !== local.id);
      if (!free) {
        continue;
      }
      if (portsConnect(free, target)) {
        return { parts: [...parts, candidate], head: free };
      }
      const score = homeScore(free, target) + wallScore(free, ctx.floorPlan) * 0.5;
      if (!best || score < best.score) {
        best = { part: candidate, free, score };
      }
    }
  }
  return best ? { parts: [...parts, best.part], head: best.free } : null;
}

function trimHead(
  parts: PlacedPart[],
  head: WorldPort,
  ctx: GenContext,
): { parts: PlacedPart[]; head: WorldPort } | null {
  const owner = parts.find((part) => part.instanceId === head.instanceId);
  if (!owner || (owner.partId !== 'straight-16' && owner.partId !== 'curve-22')) {
    return null;
  }
  const neighbors = neighborsOf(head.instanceId, parts, ctx.catalog);
  if (neighbors.length !== 1) {
    return null;
  }
  const without = parts.filter((part) => part.instanceId !== head.instanceId);
  const next = openPorts(without, ctx.catalog).filter((port) => port.instanceId === neighbors[0]);
  if (next.length !== 1) {
    return null;
  }
  return { parts: without, head: next[0] };
}
