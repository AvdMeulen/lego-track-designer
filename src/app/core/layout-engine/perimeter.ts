import { FloorPlan } from '../../shared/models/floor-plan';
import { PlacedPart, Point } from '../../shared/models/track';
import { distanceToFloorEdge, placementHitsRoom, pointInPolygon, seedInsideFloor, wallWaypoints } from '../floor-plan/space';
import { openPorts, remainingInventory } from './connections';
import { closeOpenHeads } from './explore';
import { CURVE_ANGLE, distance, headingDelta, normalizeHeading, WorldPort, worldPorts } from './geometry';
import { GenContext, nextId, placeOnHead, tryAttach } from './place';
import { fillEmptySpace, headingSteps, joinHeads, offsetJoin, ovalJoin, spliceParallelRun } from './wander';

const WALL_INSET = 16;
const CORNER_LEAD = 56;
const LOOK_AHEAD = 80;
const REACH = 22;
/** Outer bay side after which a 16-stud inset still fits a closed ring. */
const MIN_BAY_SIDE = 128;

export function tracePerimeter(inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  if (!ctx.floorPlan) {
    return [];
  }
  let ortho: PlacedPart[] = [];
  if (isRectilinear(ctx.floorPlan.outer.points)) {
    ortho = walkOrtho(inventory, ctx);
    if (ortho.length >= 8 && openPorts(ortho, ctx.catalog).length === 0) {
      return ortho;
    }
  }
  const greedy = walkGreedy(inventory, ctx);
  if (greedy.length >= 8 && openPorts(greedy, ctx.catalog).length === 0) {
    return greedy;
  }
  if (ortho.length === 0) {
    return greedy;
  }
  if (greedy.length === 0) {
    return ortho;
  }
  const score = (parts: PlacedPart[]) =>
    -openPorts(parts, ctx.catalog).length * 1000 + parts.length + ringCoverage(parts, ctx) * 0.01;
  return score(greedy) > score(ortho) ? greedy : ortho;
}

/** Spend leftover pieces as connected inward / parallel runs on the main circuit. */
export function addInnerLoops(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  keepStraights = 0,
  parallel = false,
): PlacedPart[] {
  if (!ctx.floorPlan) {
    return parts;
  }
  const opened = openPorts(parts, ctx.catalog).length;
  let result = parallel ? spliceParallelRun(parts, inventory, ctx, keepStraights) : parts;
  result = fillEmptySpace(result, inventory, ctx, 6, keepStraights, null);
  if (openPorts(result, ctx.catalog).length > opened) {
    return parts;
  }
  return result;
}

function walkOrtho(inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  const outer = ctx.floorPlan!.outer.points;
  const bays = lBayRectangles(outer).filter((bay) => !ringHitsObstacle(bay, ctx.floorPlan!));
  const rings = [outer, ...bays];
  const varyFirst = ctx.variant != null ? ((ctx.variant >> 1) & 1) === 1 : ctx.random() < 0.5;
  const closed: PlacedPart[][] = [];
  let best: PlacedPart[] = [];
  for (const ring of rings) {
    for (const varyStart of varyFirst ? [true, false] : [false, true]) {
      if (Date.now() >= ctx.deadline - 400) {
        break;
      }
      const ringCtx: GenContext = {
        ...ctx,
        deadline: Math.min(ctx.deadline, Date.now() + (closed.length > 0 ? 500 : 900)),
      };
      const walked = walkOrthoRing(ring, WALL_INSET, inventory, ringCtx, varyStart);
      if (walked.length >= 8 && openPorts(walked, ctx.catalog).length === 0) {
        closed.push(walked);
        continue;
      }
      if (walked.length > best.length) {
        best = walked;
      }
    }
  }
  if (closed.length > 0) {
    return pickClosedRing(closed, ctx);
  }
  if (best.length < 8) {
    return best;
  }
  return closeOpenHeads(best, inventory, { ...ctx, deadline: Math.max(ctx.deadline, Date.now() + 900) }, 0);
}

function pickClosedRing(closed: PlacedPart[][], ctx: GenContext): PlacedPart[] {
  const scored = closed
    .map((parts) => ({ parts, score: ringCoverage(parts, ctx) }))
    .sort((a, b) => b.score - a.score);
  const index =
    ctx.variant != null ? ((ctx.variant % scored.length) + scored.length) % scored.length : 0;
  return scored[index]?.parts ?? closed[0];
}

function ringCoverage(parts: PlacedPart[], ctx: GenContext): number {
  if (parts.length === 0) {
    return 0;
  }
  const xs = parts.map((part) => part.x);
  const ys = parts.map((part) => part.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  let reach = 0;
  if (ctx.floorPlan) {
    const outline = ctx.floorPlan.outer.points;
    const roomMaxX = Math.max(...outline.map((point) => point.x));
    const roomMinY = Math.min(...outline.map((point) => point.y));
    if (Math.max(...xs) > roomMaxX - 48) {
      reach += 220;
    }
    if (Math.min(...ys) < roomMinY + 48) {
      reach += 140;
    }
  }
  return parts.length * 10 + width + height + reach;
}

function walkOrthoRing(
  ring: Point[],
  insetDist: number,
  inventory: Record<string, number>,
  ctx: GenContext,
  varyStart: boolean,
): PlacedPart[] {
  let inset = insetVertices(ring, insetDist);
  if (inset.length < 4) {
    return [];
  }
  if (varyStart) {
    inset = rotateToEdge(inset, pickStartEdge(inset, ctx.random));
    if (ctx.random() < 0.5) {
      inset = reverseWalk(inset);
    }
  } else {
    inset = rotateToLongestEdge(inset);
  }
  const start = seedAlongWall(midEdgeFallback(inset), inventory, ctx);
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
  if (ctx.random() < 0.5) {
    mappings.reverse();
  }
  const closed: PlacedPart[][] = [];
  let best: { parts: PlacedPart[]; head: WorldPort } | null = null;
  for (const ports of mappings) {
    if (Date.now() >= ctx.deadline) {
      break;
    }
    const xs = inset.map((point) => point.x);
    const ys = inset.map((point) => point.y);
    const compact =
      Math.max(...xs) - Math.min(...xs) < 300 || Math.max(...ys) - Math.min(...ys) < 180;
    const raw = orthoSequence(inset, ports.left, ports.right);
    const sequence = compact ? trimTrailingCorner(raw) : raw;
    const walked = attachRun([start.part], start.head, sequence, inventory, ctx);
    if (!walked) {
      continue;
    }
    const liveTail = openPorts(walked.parts, ctx.catalog).find(
      (port) => port.instanceId === start.part.instanceId && port.id === tail.id,
    );
    const sealed = liveTail ? closeGap(walked.parts, walked.head, liveTail, inventory, ctx) : null;
    if (sealed && openPorts(sealed, ctx.catalog).length === 0) {
      closed.push(sealed);
      continue;
    }
    const candidate = sealed ?? walked.parts;
    if (!best || candidate.length > best.parts.length) {
      best = { parts: candidate, head: walked.head };
    }
  }
  if (closed.length > 0) {
    return closed[0];
  }
  if (!best) {
    return [start.part];
  }
  return best.parts;
}

function orthoSequence(inset: Point[], left: 'a' | 'b', right: 'a' | 'b'): Array<{ partId: string; portId?: string }> {
  const sequence: Array<{ partId: string; portId?: string }> = [];
  for (let index = 0; index < inset.length; index += 1) {
    const a = inset[index];
    const b = inset[(index + 1) % inset.length];
    const c = inset[(index + 2) % inset.length];
    const length = distance(a, b);
    const half = index === 0 || index === inset.length - 1;
    const corners = half ? 1 : 2;
    const lead = cornerLead(length, corners);
    const run = (half ? length / 2 : length) - lead * corners;
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

function trimTrailingCorner(
  sequence: Array<{ partId: string; portId?: string }>,
): Array<{ partId: string; portId?: string }> {
  if (sequence.length < 4) {
    return sequence;
  }
  const tail = sequence.slice(-4);
  if (tail.some((item) => item.partId !== 'curve-22')) {
    return sequence;
  }
  return sequence.slice(0, -4);
}

/** Keep a 16-stud straight on short L-stub edges; full R40 lead on long walls. */
function cornerLead(edgeLength: number, corners: 1 | 2): number {
  const maxLead = Math.max(12, (edgeLength - 16) / corners);
  return Math.min(CORNER_LEAD, maxLead);
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
    if (Date.now() >= ctx.deadline) {
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

function pickStartEdge(points: Point[], random: () => number): number {
  const edges = points.map((point, index) => ({
    index,
    length: distance(point, points[(index + 1) % points.length]),
  }));
  const long = edges.filter((edge) => edge.length >= 48);
  const pool = long.length ? long : edges;
  return pool[Math.floor(random() * pool.length)]?.index ?? 0;
}

function lBayRectangles(points: Point[]): Point[][] {
  const xs = [...new Set(points.map((point) => point.x))].sort((a, b) => a - b);
  const ys = [...new Set(points.map((point) => point.y))].sort((a, b) => a - b);
  if (xs.length !== 3 || ys.length !== 3) {
    return [];
  }
  const clockwise = polygonArea(points) < 0;
  const bays: Point[][] = [];
  for (let j = 0; j < 2; j += 1) {
    const midLeft = { x: (xs[0] + xs[1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
    const midRight = { x: (xs[1] + xs[2]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
    if (pointInPolygon(midLeft, points, true) && pointInPolygon(midRight, points, true)) {
      bays.push(rectRing(xs[0], ys[j], xs[2], ys[j + 1], clockwise));
    }
  }
  for (let i = 0; i < 2; i += 1) {
    const midLow = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[0] + ys[1]) / 2 };
    const midHigh = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[1] + ys[2]) / 2 };
    if (pointInPolygon(midLow, points, true) && pointInPolygon(midHigh, points, true)) {
      bays.push(rectRing(xs[i], ys[0], xs[i + 1], ys[2], clockwise));
    }
  }
  return bays.filter(
    (bay) =>
      bay.every((point) => pointInPolygon(point, points, true)) &&
      distance(bay[0], bay[1]) >= MIN_BAY_SIDE &&
      distance(bay[1], bay[2]) >= MIN_BAY_SIDE,
  );
}

function ringHitsObstacle(ring: Point[], plan: FloorPlan): boolean {
  if (plan.obstacles.length === 0) {
    return false;
  }
  const inset = insetVertices(ring, WALL_INSET);
  if (inset.length < 4) {
    return true;
  }
  for (let index = 0; index < inset.length; index += 1) {
    const a = inset[index];
    const b = inset[(index + 1) % inset.length];
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (plan.obstacles.some((obstacle) => pointInPolygon(point, obstacle.points, true))) {
        return true;
      }
    }
  }
  return false;
}

function rectRing(minX: number, minY: number, maxX: number, maxY: number, clockwise: boolean): Point[] {
  const ccw: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  return clockwise ? [ccw[0], ccw[3], ccw[2], ccw[1]] : ccw;
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return area / 2;
}

function rotateToEdge(points: Point[], start: number): Point[] {
  if (points.length < 2) {
    return points;
  }
  const index = ((start % points.length) + points.length) % points.length;
  return [...points.slice(index), ...points.slice(0, index)];
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
  return rotateToEdge(points, best);
}

function reverseWalk(points: Point[]): Point[] {
  if (points.length < 2) {
    return points;
  }
  return [points[1], points[0], ...points.slice(2).reverse()];
}

function midEdgeFallback(points: Point[]): Point[] {
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
  prefix = 'pr',
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
      const move = placeOnHead('curve-22', portId, tip, trail, ctx, prefix);
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
  startAt = (startAt + Math.floor(random() * raw.length)) % raw.length;
  const ordered = [...raw.slice(startAt), ...raw.slice(0, startAt)];
  return random() < 0.5 ? ordered.slice().reverse() : ordered;
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
  const origins = [0, 0.5, 0.3, 0.7, 0.2, 0.8].map((t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }));
  for (const origin of origins) {
    for (const rotation of headings) {
      const part: PlacedPart = {
        instanceId: nextId(ctx, 'pr'),
        partId,
        label: 1,
        x: origin.x,
        y: origin.y,
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
  prefix = 'pr',
): PlacedPart[] | null {
  const face = normalizeHeading(to.heading + 180);
  const turned = turnToHeading(parts, from, face, inventory, ctx, prefix);
  const pretuned = turned ?? { parts, head: from };
  const joined =
    joinHeads(pretuned.parts, pretuned.head, to, inventory, ctx, prefix) ??
    joinHeads(parts, from, to, inventory, ctx, prefix) ??
    joinHeads(parts, to, from, inventory, ctx, prefix) ??
    ovalJoin(parts, from, to, inventory, ctx, prefix, false) ??
    ovalJoin(parts, to, from, inventory, ctx, prefix, false) ??
    ovalJoin(parts, from, to, inventory, ctx, prefix, true) ??
    ovalJoin(parts, to, from, inventory, ctx, prefix, true) ??
    ovalJoin(pretuned.parts, pretuned.head, to, inventory, ctx, prefix, true) ??
    offsetJoin(parts, from, to, inventory, ctx, prefix) ??
    offsetJoin(parts, to, from, inventory, ctx, prefix);
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
