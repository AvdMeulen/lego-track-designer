import { FloorPlan } from '../../shared/models/floor-plan';
import { PlacedPart, Point } from '../../shared/models/track';
import { distanceToFloorEdge, placementHitsRoom, pointInPolygon, seedInsideFloor, wallWaypoints } from '../floor-plan/space';
import { openPorts, remainingInventory } from './connections';
import { closeOpenHeads } from './explore';
import { CURVE_ANGLE, distance, headingDelta, normalizeHeading, WorldPort, worldPorts } from './geometry';
import { GenContext, nextId, placeOnHead, tryAttach } from './place';
import { headingSteps, joinHeads, ovalJoin } from './wander';

const WALL_INSET = 16;
const CORNER_LEAD = 56;
const LOOK_AHEAD = 80;
const REACH = 22;

export function tracePerimeter(inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  if (!ctx.floorPlan) {
    return [];
  }
  if (isRectilinear(ctx.floorPlan.outer.points)) {
    const ortho = walkOrtho(inventory, ctx);
    if (ortho.length >= 8) {
      return ortho;
    }
  }
  return walkGreedy(inventory, ctx);
}

function walkOrtho(inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  const ring = ctx.floorPlan!.outer.points;
  const inset = rotateToLongestEdge(insetVertices(ring, WALL_INSET));
  if (inset.length < 4) {
    return [];
  }
  const start = seedAlongWall(midEdgePoints(inset), inventory, ctx);
  if (!start) {
    return [];
  }
  const tail = worldPorts(ctx.catalog[start.part.partId], start.part).find((port) => port.id !== start.head.id);
  if (!tail) {
    return [start.part];
  }
  const mappings: Array<{ left: 'a' | 'b'; right: 'a' | 'b' }> = [
    { left: 'a', right: 'b' },
    { left: 'b', right: 'a' },
  ];
  let best: { parts: PlacedPart[]; head: WorldPort } | null = null;
  for (const ports of mappings) {
    if (Date.now() >= ctx.deadline - 200) {
      break;
    }
    const sequence = orthoSequence(inset, ports.left, ports.right);
    const walked = attachRun([start.part], start.head, sequence, inventory, ctx);
    if (!walked) {
      continue;
    }
    if (!best || walked.parts.length > best.parts.length) {
      best = walked;
    }
  }
  if (!best) {
    return [start.part];
  }
  const liveTail = openPorts(best.parts, ctx.catalog).find(
    (port) => port.instanceId === start.part.instanceId && port.id === tail.id,
  );
  const closed = liveTail ? closeGap(best.parts, best.head, liveTail, inventory, ctx) : null;
  if (closed) {
    return closed;
  }
  return best.parts.length >= 8 ? closeOpenHeads(best.parts, inventory, ctx, 0) : best.parts;
}

function orthoSequence(inset: Point[], left: 'a' | 'b', right: 'a' | 'b'): Array<{ partId: string; portId?: string }> {
  const sequence: Array<{ partId: string; portId?: string }> = [];
  for (let index = 0; index < inset.length; index += 1) {
    const a = inset[index];
    const b = inset[(index + 1) % inset.length];
    const c = inset[(index + 2) % inset.length];
    const length = distance(a, b);
    const run =
      index === 0 || index === inset.length - 1 ? length / 2 - CORNER_LEAD : length - CORNER_LEAD * 2;
    const straights = Math.max(0, Math.floor(run / 16));
    for (let step = 0; step < straights; step += 1) {
      sequence.push({ partId: 'straight-16' });
    }
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const portId = cross > 0 ? left : right;
    for (let curve = 0; curve < 4; curve += 1) {
      sequence.push({ partId: 'curve-22', portId });
    }
  }
  return sequence;
}

function attachRun(
  parts: PlacedPart[],
  head: WorldPort,
  sequence: Array<{ partId: string; portId?: string }>,
  inventory: Record<string, number>,
  ctx: GenContext,
): { parts: PlacedPart[]; head: WorldPort } | null {
  let trail = parts;
  let tip = head;
  for (const item of sequence) {
    if (Date.now() >= ctx.deadline - 80) {
      break;
    }
    const left = remainingInventory(inventory, trail);
    if ((left[item.partId] ?? 0) <= 0) {
      break;
    }
    const portId = item.portId ?? ctx.catalog[item.partId].ports[0].id;
    const move = placeOnHead(item.partId, portId, tip, trail, ctx, 'pr');
    if (!move) {
      break;
    }
    trail = [...trail, move.part];
    tip = move.head;
  }
  return trail.length > parts.length ? { parts: trail, head: tip } : null;
}

function walkGreedy(inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  const base = orderedWaypoints(ctx.floorPlan!, ctx.random);
  if (base.length < 4) {
    return [];
  }
  let best: PlacedPart[] = [];
  const shifts = [0, Math.floor(base.length / 3)];
  for (const shift of shifts) {
    if (Date.now() >= ctx.deadline - 200) {
      break;
    }
    const waypoints = [...base.slice(shift), ...base.slice(0, shift)];
    const walked = walkWaypoints(waypoints, inventory, ctx);
    if (openPorts(walked, ctx.catalog).length === 0 && walked.length >= 16) {
      return walked;
    }
    if (walked.length > best.length) {
      best = walked;
    }
  }
  return best.length >= 8 ? closeOpenHeads(best, inventory, ctx, 0) : best;
}

function walkWaypoints(
  waypoints: Array<{ x: number; y: number }>,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] {
  const start = seedAlongWall(waypoints, inventory, ctx);
  if (!start) {
    return [];
  }
  let parts = [start.part];
  let head = start.head;
  let wpIndex = 1;
  const budget = Math.min(160, 8 + Object.values(inventory).reduce((sum, qty) => sum + qty, 0));
  for (let step = 0; step < budget && Date.now() < ctx.deadline - 160; step += 1) {
    if (rigidLeft(inventory, parts) < 1) {
      break;
    }
    while (wpIndex < waypoints.length && distance(head, waypoints[wpIndex]) < REACH) {
      wpIndex += 1;
    }
    const tail = openPorts(parts, ctx.catalog).find(
      (port) => port.instanceId === start.part.instanceId && port.id !== start.head.id,
    );
    const traveled = parts.length >= 20 && (!tail || distance(head, tail) > 80);
    if (
      traveled &&
      tail &&
      (wpIndex >= waypoints.length || (wpIndex > waypoints.length * 0.7 && distance(head, tail) < 64))
    ) {
      const closed = closeGap(parts, head, tail, inventory, ctx);
      if (closed) {
        return closed;
      }
    }
    const goal = lookAhead(waypoints, wpIndex, head) ?? tail ?? waypoints[0];
    const inch = stepTowardPoint(parts, head, goal, inventory, ctx, false);
    if (!inch) {
      wpIndex += 1;
      if (wpIndex > waypoints.length + 4) {
        break;
      }
      continue;
    }
    parts = inch.parts;
    head = inch.head;
  }
  return parts.length >= 16 ? closeOpenHeads(parts, inventory, ctx, 0) : parts;
}

function rotateToLongestEdge(points: Point[]): Point[] {
  if (points.length < 2) {
    return points;
  }
  let best = 0;
  let bestLen = -1;
  for (let index = 0; index < points.length; index += 1) {
    const length = distance(points[index], points[(index + 1) % points.length]);
    if (length > bestLen) {
      bestLen = length;
      best = index;
    }
  }
  return [...points.slice(best), ...points.slice(0, best)];
}

function midEdgePoints(points: Point[]): Point[] {
  const a = points[0];
  const b = points[1] ?? points[0];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [mid, b, ...points.slice(2), a];
}

export function isRectilinear(points: Point[]): boolean {
  return (
    points.length >= 4 &&
    points.every((point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.abs(point.x - next.x) < 3 || Math.abs(point.y - next.y) < 3;
    })
  );
}

export function insetVertices(points: Point[], inset: number): Point[] {
  return points.map((curr, index) => {
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const first = inwardUnit(prev, curr, points);
    const second = inwardUnit(curr, next, points);
    return { x: curr.x + first.x * inset + second.x * inset, y: curr.y + first.y * inset + second.y * inset };
  });
}

function inwardUnit(from: Point, to: Point, ring: Point[]): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  for (const sign of [1, -1]) {
    const normal = { x: -uy * sign, y: ux * sign };
    const probe = {
      x: (from.x + to.x) / 2 + normal.x * 8,
      y: (from.y + to.y) / 2 + normal.y * 8,
    };
    if (pointInPolygon(probe, ring, false)) {
      return normal;
    }
  }
  return { x: -uy, y: ux };
}

function turnToHeading(
  parts: PlacedPart[],
  head: WorldPort,
  target: number,
  inventory: Record<string, number>,
  ctx: GenContext,
): { parts: PlacedPart[]; head: WorldPort } | null {
  const steps = headingSteps(head.heading, target);
  if (Math.abs(steps) < 1) {
    return { parts, head };
  }
  if ((remainingInventory(inventory, parts)['curve-22'] ?? 0) < Math.abs(steps)) {
    return null;
  }
  const count = Math.min(8, Math.abs(steps));
  const order = steps > 0 ? (['a', 'b'] as const) : (['b', 'a'] as const);
  for (const portId of order) {
    let trail = parts;
    let tip = head;
    let ok = true;
    for (let index = 0; index < count; index += 1) {
      const move = placeOnHead('curve-22', portId, tip, trail, ctx, 'pr');
      if (!move) {
        ok = false;
        break;
      }
      trail = [...trail, move.part];
      tip = move.head;
    }
    if (ok && headingDelta(tip.heading, target) <= 8) {
      return { parts: trail, head: tip };
    }
  }
  return null;
}

function lookAhead(
  waypoints: Array<{ x: number; y: number }>,
  fromIndex: number,
  head: { x: number; y: number },
): { x: number; y: number } | null {
  for (let index = fromIndex; index < waypoints.length; index += 1) {
    if (distance(head, waypoints[index]) >= LOOK_AHEAD) {
      return waypoints[index];
    }
  }
  return waypoints[waypoints.length - 1] ?? null;
}

function orderedWaypoints(plan: FloorPlan, random: () => number): Array<{ x: number; y: number }> {
  const raw = thinWaypoints(wallWaypoints(plan, WALL_INSET, 24), 16);
  if (raw.length < 2) {
    return raw;
  }
  const seed = seedInsideFloor(plan, WALL_INSET);
  let startAt = 0;
  let nearest = 1e9;
  for (let index = 0; index < raw.length; index += 1) {
    const dist = Math.hypot(raw[index].x - seed.x, raw[index].y - seed.y);
    if (dist < nearest) {
      nearest = dist;
      startAt = index;
    }
  }
  startAt = (startAt + Math.floor(random() * 2)) % raw.length;
  return [...raw.slice(startAt), ...raw.slice(0, startAt)];
}

function thinWaypoints(
  points: Array<{ x: number; y: number }>,
  minDist: number,
): Array<{ x: number; y: number }> {
  const kept: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (!kept.length || distance(kept[kept.length - 1], point) >= minDist) {
      kept.push(point);
    }
  }
  if (kept.length > 2 && distance(kept[0], kept[kept.length - 1]) < minDist) {
    kept.pop();
  }
  return kept;
}

function seedAlongWall(
  waypoints: Array<{ x: number; y: number }>,
  inventory: Record<string, number>,
  ctx: GenContext,
): { part: PlacedPart; head: WorldPort } | null {
  const partId = (inventory['straight-16'] ?? 0) > 0 ? 'straight-16' : (inventory['curve-22'] ?? 0) > 0 ? 'curve-22' : '';
  if (!partId) {
    return null;
  }
  const a = waypoints[0];
  const b = waypoints[1] ?? waypoints[0];
  const along = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const headings = [0, 1, -1, 2, -2, 8].map((step) => snapHeading(along + step * CURVE_ANGLE));
  for (const rotation of headings) {
    const part: PlacedPart = {
      instanceId: nextId(ctx, 'pr'),
      partId,
      label: 1,
      x: a.x,
      y: a.y,
      rotation,
    };
    if (ctx.floorPlan && placementHitsRoom(part, ctx.catalog, ctx.floorPlan)) {
      continue;
    }
    const ports = worldPorts(ctx.catalog[partId], part);
    const head = ports.reduce((best, port) =>
      headingDelta(port.heading, along) < headingDelta(best.heading, along) ? port : best,
    );
    return { part, head };
  }
  return null;
}

function stepTowardPoint(
  parts: PlacedPart[],
  start: WorldPort,
  goal: { x: number; y: number },
  inventory: Record<string, number>,
  ctx: GenContext,
  preferStraight: boolean,
): { parts: PlacedPart[]; head: WorldPort } | null {
  const left = remainingInventory(inventory, parts);
  const types = ['straight-16', 'curve-22'].filter((id) => (left[id] ?? 0) > 0);
  let best: { part: PlacedPart; free: WorldPort; score: number } | null = null;
  const prev = distance(start, goal);
  const bear = (Math.atan2(goal.y - start.y, goal.x - start.x) * 180) / Math.PI;
  for (const type of types) {
    const part = ctx.catalog[type];
    for (const local of part.ports) {
      const candidate = tryAttach(
        part,
        local.id,
        start,
        parts,
        ctx.catalog,
        nextId(ctx, 'pr'),
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
      const wall = ctx.floorPlan ? Math.abs(distanceToFloorEdge(free, ctx.floorPlan) - WALL_INSET) : 0;
      const turnNeeded = headingDelta(start.heading, bear);
      const wallWeight = turnNeeded > 35 ? 0.25 : 1.35;
      const score =
        (distance(free, goal) - prev) * 2.8 +
        wall * wallWeight +
        headingDelta(free.heading, bear) * 0.4 +
        (type === 'straight-16' && preferStraight && turnNeeded < 20 ? -4 : 0) +
        (type === 'curve-22' && turnNeeded > 20 ? -6 : 0) +
        (type === 'straight-16' && turnNeeded > 40 ? 10 : 0);
      if (!best || score < best.score) {
        best = { part: candidate, free, score };
      }
    }
  }
  return best ? { parts: [...parts, best.part], head: best.free } : null;
}

function closeGap(
  parts: PlacedPart[],
  from: WorldPort,
  to: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const face = normalizeHeading(to.heading + 180);
  const turned = turnToHeading(parts, from, face, inventory, ctx);
  const pretuned = turned ?? { parts, head: from };
  const joined =
    joinHeads(pretuned.parts, pretuned.head, to, inventory, ctx, 'pr') ??
    joinHeads(parts, from, to, inventory, ctx, 'pr') ??
    joinHeads(parts, to, from, inventory, ctx, 'pr') ??
    ovalJoin(parts, from, to, inventory, ctx, 'pr', false) ??
    ovalJoin(parts, to, from, inventory, ctx, 'pr', false) ??
    ovalJoin(pretuned.parts, pretuned.head, to, inventory, ctx, 'pr', true);
  if (joined && openPorts(joined, ctx.catalog).length === 0) {
    return joined;
  }
  return null;
}

function rigidLeft(inventory: Record<string, number>, parts: PlacedPart[]): number {
  const left = remainingInventory(inventory, parts);
  return (left['straight-16'] ?? 0) + (left['curve-22'] ?? 0);
}

function snapHeading(deg: number): number {
  return normalizeHeading(Math.round(deg / CURVE_ANGLE) * CURVE_ANGLE);
}
