import { FloorPlan } from '../../shared/models/floor-plan';
import { PlacedPart, Point, TrackPart } from '../../shared/models/track';
import { placementHitsRoom } from '../floor-plan/space';
import { placementCollides } from './collide';
import { openPorts, remainingInventory } from './connections';
import { distance, headingDelta, portsConnect, WorldPort, worldPorts } from './geometry';
import { GenContext, neighborsOf, nextId, tryAttach } from './place';

export function flexPathBetween(a: Point, b: Point): Point[] {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(6, length / 3);
  const control = { x: mid.x - (dy / length) * bulge, y: mid.y + (dx / length) * bulge };
  const points: Point[] = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    const u = 1 - t;
    points.push({
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
    });
  }
  return points;
}

export function canCloseWithFlex(
  a: { x: number; y: number; heading: number },
  b: { x: number; y: number; heading: number },
  flex: TrackPart,
): boolean {
  const limits = flex.flex;
  if (!limits) {
    return false;
  }
  const chord = distance(a, b);
  if (chord < limits.minChordStuds || chord > limits.lengthStuds) {
    return false;
  }
  if (headingDelta(a.heading, b.heading + 180) > 12) {
    return false;
  }
  const dir = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const error = headingDelta(a.heading, dir) + headingDelta(b.heading, dir + 180);
  return error <= limits.maxBendDegrees;
}

export function flexGapScore(
  a: { x: number; y: number; heading: number },
  b: { x: number; y: number; heading: number },
  flex: TrackPart,
): number {
  const limits = flex.flex;
  if (!limits) {
    return Infinity;
  }
  const chord = distance(a, b);
  const face = headingDelta(a.heading, b.heading + 180);
  const dir = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const bend = headingDelta(a.heading, dir) + headingDelta(b.heading, dir + 180);
  let score = 0;
  if (chord < limits.minChordStuds) {
    score += (limits.minChordStuds - chord) * 10;
  } else if (chord > limits.lengthStuds) {
    score += (chord - limits.lengthStuds) * 2.2;
  } else {
    score += Math.abs(chord - 11) * 0.15;
  }
  score += Math.max(0, face - 12) * 4 + Math.min(face, 12) * 0.25;
  score += Math.max(0, bend - limits.maxBendDegrees) * 3 + Math.min(bend, limits.maxBendDegrees) * 0.08;
  return score;
}

export function canCloseWithFlexPair(
  a: { x: number; y: number; heading: number },
  b: { x: number; y: number; heading: number },
  flex: TrackPart,
): boolean {
  const limits = flex.flex;
  if (!limits) {
    return false;
  }
  const chord = distance(a, b);
  const half = chord / 2;
  if (half < limits.minChordStuds || half > limits.lengthStuds) {
    return false;
  }
  if (headingDelta(a.heading, b.heading + 180) > 12) {
    return false;
  }
  const dir = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const error = headingDelta(a.heading, dir) + headingDelta(b.heading, dir + 180);
  return error <= limits.maxBendDegrees;
}

function makeFlex(
  parts: PlacedPart[],
  a: Point,
  b: Point,
  catalog: Record<string, TrackPart>,
  floorPlan: FloorPlan | null | undefined,
  ignore: Set<string>,
): PlacedPart | null {
  const candidate: PlacedPart = {
    instanceId: `flex-${parts.length + 1}`,
    partId: 'flex-track',
    label: parts.reduce((max, part) => Math.max(max, part.label), 0) + 1,
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    rotation: 0,
    flexPath: flexPathBetween(a, b),
  };
  if (placementCollides(candidate, parts, catalog, ignore)) {
    return null;
  }
  if (floorPlan && placementHitsRoom(candidate, catalog, floorPlan)) {
    return null;
  }
  return candidate;
}

export function tryPlaceFlex(
  parts: PlacedPart[],
  a: WorldPort,
  b: WorldPort,
  catalog: Record<string, TrackPart>,
  floorPlan?: FloorPlan | null,
  flexLeft = 1,
): PlacedPart[] | null {
  const flex = catalog['flex-track'];
  if (!flex?.flex || flexLeft <= 0) {
    return null;
  }
  const ignore = new Set([a.instanceId, b.instanceId]);
  if (canCloseWithFlex(a, b, flex)) {
    const one = makeFlex(parts, a, b, catalog, floorPlan, ignore);
    return one ? [...parts, one] : null;
  }
  if (flexLeft < 2 || !canCloseWithFlexPair(a, b, flex)) {
    return null;
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const first = makeFlex(parts, a, mid, catalog, floorPlan, ignore);
  if (!first) {
    return null;
  }
  const second = makeFlex(
    [...parts, first],
    mid,
    b,
    catalog,
    floorPlan,
    new Set([...ignore, first.instanceId]),
  );
  return second ? [...parts, first, second] : null;
}

export function closeWithFlex(
  placed: PlacedPart[],
  catalog: Record<string, TrackPart>,
  remaining: Record<string, number>,
  allowFlex: boolean,
  floorPlan?: FloorPlan | null,
): PlacedPart[] {
  if (!allowFlex || (remaining['flex-track'] ?? 0) <= 0) {
    return placed;
  }
  const flex = catalog['flex-track'];
  if (!flex?.flex) {
    return placed;
  }

  const result = [...placed];
  let left = remaining['flex-track'];

  while (left > 0) {
    const opens = openPorts(result, catalog);
    let pair: [WorldPort, WorldPort] | null = null;
    let bestChord = Infinity;
    for (let i = 0; i < opens.length; i += 1) {
      for (let j = i + 1; j < opens.length; j += 1) {
        const pairable =
          canCloseWithFlex(opens[i], opens[j], flex) ||
          (left >= 2 && canCloseWithFlexPair(opens[i], opens[j], flex));
        if (!pairable) {
          continue;
        }
        const chord = distance(opens[i], opens[j]);
        if (chord < bestChord) {
          bestChord = chord;
          pair = [opens[i], opens[j]];
        }
      }
    }
    if (!pair) {
      break;
    }
    const closed = tryPlaceFlex(result, pair[0], pair[1], catalog, floorPlan, left);
    if (!closed) {
      break;
    }
    const added = closed.length - result.length;
    result.length = 0;
    result.push(...closed);
    left -= added;
  }

  return result;
}

export function approachThenFlex(
  parts: PlacedPart[],
  from: WorldPort,
  to: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  if ((inventory['curve-22'] ?? 0) === 15) {
    return null;
  }
  if ((remainingInventory(inventory, parts)['flex-track'] ?? 0) <= 0) {
    return null;
  }
  const flex = ctx.catalog['flex-track'];
  if (!flex?.flex) {
    return null;
  }

  let result = parts;
  let left = from;
  let right = to;
  const flexLeft = remainingInventory(inventory, parts)['flex-track'] ?? 0;
  const immediate = tryPlaceFlex(result, left, right, ctx.catalog, ctx.floorPlan, flexLeft);
  if (immediate) {
    return immediate;
  }

  for (let step = 0; step < 32 && Date.now() < ctx.deadline - 80; step += 1) {
    const live = livePair(result, left, right, ctx);
    if (!live) {
      break;
    }
    left = live[0];
    right = live[1];
    if (portsConnect(left, right)) {
      return result;
    }
    const snapped = tryPlaceFlex(
      result,
      left,
      right,
      ctx.catalog,
      ctx.floorPlan,
      remainingInventory(inventory, result)['flex-track'] ?? 0,
    );
    if (snapped) {
      return snapped;
    }

    if (distance(left, right) < flex.flex.minChordStuds) {
      const trimmed = trimRigidTip(result, left, ctx) ?? trimRigidTip(result, right, ctx);
      if (!trimmed) {
        break;
      }
      result = trimmed.parts;
      continue;
    }

    const current = approachScore(left, right, flex);
    const inchLeft = bestFlexStep(result, left, right, inventory, ctx, flex);
    const inchRight = bestFlexStep(result, right, left, inventory, ctx, flex);
    const leftScore = inchLeft ? approachScore(inchLeft.head, right, flex) : Infinity;
    const rightScore = inchRight ? approachScore(left, inchRight.head, flex) : Infinity;
    let picked: { parts: PlacedPart[]; head: WorldPort; side: 'left' | 'right'; score: number } | null = null;
    if (inchLeft && leftScore < current - 0.05) {
      picked = { parts: inchLeft.parts, head: inchLeft.head, side: 'left', score: leftScore };
    }
    if (inchRight && rightScore < (picked?.score ?? current - 0.05)) {
      picked = { parts: inchRight.parts, head: inchRight.head, side: 'right', score: rightScore };
    }
    if (!picked) {
      break;
    }
    result = picked.parts;
    if (picked.side === 'left') {
      left = picked.head;
    } else {
      right = picked.head;
    }
  }

  const live = livePair(result, left, right, ctx);
  if (!live) {
    return null;
  }
  return (
    tryPlaceFlex(
      result,
      live[0],
      live[1],
      ctx.catalog,
      ctx.floorPlan,
      remainingInventory(inventory, result)['flex-track'] ?? 0,
    ) ?? finishWithCurvesAndFlex(result, live[0], live[1], inventory, ctx)
  );
}

function finishWithCurvesAndFlex(
  parts: PlacedPart[],
  from: WorldPort,
  to: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const flexed = tryPlaceFlex(
    parts,
    from,
    to,
    ctx.catalog,
    ctx.floorPlan,
    remainingInventory(inventory, parts)['flex-track'] ?? 0,
  );
  if (flexed) {
    return flexed;
  }
  if ((remainingInventory(inventory, parts)['curve-22'] ?? 0) < 1) {
    return null;
  }
  let base = parts;
  let start = from;
  let target = to;
  for (let trim = 0; trim < 3; trim += 1) {
    const found = curveTowardFlex(base, start, target, inventory, ctx) ??
      curveTowardFlex(base, target, start, inventory, ctx);
    if (found) {
      return found;
    }
    const trimmed = trimRigidTip(base, start, ctx) ?? trimRigidTip(base, target, ctx);
    if (!trimmed) {
      break;
    }
    base = trimmed.parts;
    const live = livePair(base, start, target, ctx);
    const opens = live ?? (openPorts(base, ctx.catalog).length === 2
      ? ([openPorts(base, ctx.catalog)[0], openPorts(base, ctx.catalog)[1]] as const)
      : null);
    if (!opens) {
      break;
    }
    start = opens[0];
    target = opens[1];
  }
  return null;
}

function curveTowardFlex(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  for (const portId of ['a', 'b'] as const) {
    let trail = parts;
    let tip = start;
    for (let step = 0; step < 2; step += 1) {
      if ((remainingInventory(inventory, trail)['curve-22'] ?? 0) <= 0) {
        break;
      }
      const move = tryAttach(
        ctx.catalog['curve-22'],
        portId,
        tip,
        trail,
        ctx.catalog,
        nextId(ctx, 'fx'),
        [target.instanceId],
        ctx.floorPlan,
      );
      if (!move) {
        break;
      }
      const free = worldPorts(ctx.catalog['curve-22'], move).find((port) => port.id !== portId);
      if (!free) {
        break;
      }
      trail = [...trail, move];
      tip = free;
      if (portsConnect(tip, target)) {
        return trail;
      }
      const closed = tryPlaceFlex(
        trail,
        tip,
        target,
        ctx.catalog,
        ctx.floorPlan,
        remainingInventory(inventory, trail)['flex-track'] ?? 0,
      );
      if (closed) {
        return closed;
      }
    }
  }
  return null;
}

function approachScore(
  a: { x: number; y: number; heading: number },
  b: WorldPort,
  flex: TrackPart,
): number {
  if (canCloseWithFlex(a, b, flex)) {
    return 0;
  }
  const dist = distance(a, b);
  const bear = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const aim = headingDelta(a.heading, bear) + headingDelta(b.heading, bear + 180);
  if (dist > 16) {
    return dist + aim * 0.85 + headingDelta(a.heading, b.heading + 180) * 0.25;
  }
  return flexGapScore(a, b, flex);
}

function livePair(
  parts: PlacedPart[],
  left: WorldPort,
  right: WorldPort,
  ctx: GenContext,
): [WorldPort, WorldPort] | null {
  const opens = openPorts(parts, ctx.catalog);
  const a = opens.find((port) => port.instanceId === left.instanceId && port.id === left.id);
  const b = opens.find((port) => port.instanceId === right.instanceId && port.id === right.id);
  return a && b ? [a, b] : null;
}

function bestFlexStep(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  flex: TrackPart,
): { parts: PlacedPart[]; head: WorldPort } | null {
  const left = remainingInventory(inventory, parts);
  const bear = (Math.atan2(target.y - start.y, target.x - start.x) * 180) / Math.PI;
  const turn = headingDelta(start.heading, bear);
  const types = (turn > 18 ? ['curve-22'] : ['straight-16', 'curve-22']).filter(
    (id) => (left[id] ?? 0) > 0,
  );
  let best: { parts: PlacedPart[]; head: WorldPort; score: number } | null = null;
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
        nextId(ctx, 'fx'),
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
      const score = approachScore(free, target, flex);
      if (!best || score < best.score) {
        best = { parts: [...parts, candidate], head: free, score };
      }
    }
  }
  return best;
}

function trimRigidTip(
  parts: PlacedPart[],
  head: WorldPort,
  ctx: GenContext,
): { parts: PlacedPart[] } | null {
  const owner = parts.find((part) => part.instanceId === head.instanceId);
  if (!owner || (owner.partId !== 'straight-16' && owner.partId !== 'curve-22')) {
    return null;
  }
  const neighbors = neighborsOf(head.instanceId, parts, ctx.catalog);
  if (neighbors.length !== 1) {
    return null;
  }
  return { parts: parts.filter((part) => part.instanceId !== head.instanceId) };
}
