import { FloorPlan } from '../../shared/models/floor-plan';
import { GenerationPreferences, PlacedPart } from '../../shared/models/track';
import { floorBounds, pointInPolygon, placementHitsRoom } from '../floor-plan/space';
import { openPorts, remainingInventory } from './connections';
import { distance, WorldPort, worldPorts } from './geometry';
import { GenContext, nextId, placeOnHead, tryAttach } from './place';
import { growToward, inflateLoop, loopCloses } from './wander';

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

  for (let step = 0; step < maxSteps && Date.now() < ctx.deadline; step += 1) {
    const stock = remainingInventory(inventory, parts);
    const leftover = (stock['straight-16'] ?? 0) + (stock['curve-22'] ?? 0);
    const heads = openPorts(parts, ctx.catalog);
    const gap = uncoveredSpot(parts, ctx.floorPlan);
    const filling = leftover > 20 && (gap?.clearance ?? 0) > 40;
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

    if (parts.length >= (filling ? 28 : 8)) {
      const placedSwitch = maybePlaceSwitch(parts, inventory, ctx, heads, lastSpecialAt, prefs);
      if (placedSwitch) {
        parts = placedSwitch.parts;
        lastSpecialAt = { x: placedSwitch.at.x, y: placedSwitch.at.y };
        idle = 0;
        continue;
      }
    }

    const grown = growBestHead(parts, inventory, ctx, heads);
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

  const gap = uncoveredSpot(parts, ctx.floorPlan);
  if (!gap || gap.clearance < 40) {
    parts = closeRemaining(parts, inventory, ctx);
  }
  const leftover = remainingInventory(inventory, parts);
  if ((leftover['straight-16'] ?? 0) + (leftover['curve-22'] ?? 0) > 0) {
    const empty = uncoveredSpot(parts, ctx.floorPlan);
    const steps = (empty?.clearance ?? 0) > 36 ? 28 : 16;
    parts = inflateLoop(parts, inventory, ctx, steps, prefs.targetParkingSpots * 6, false, empty?.point ?? null);
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
): PlacedPart[] | null {
  const stock = remainingInventory(inventory, parts);
  const types = ['straight-16', 'curve-22'].filter((id) => (stock[id] ?? 0) > 0);
  if (!types.length) {
    return null;
  }
  const others = heads;
  let best: { parts: PlacedPart[]; score: number } | null = null;
  const sample =
    ctx.floorPlan || heads.length <= 6
      ? heads
      : heads.filter((_, index) => index % Math.ceil(heads.length / 4) === 0);
  const cx = parts.reduce((sum, part) => sum + part.x, 0) / parts.length;
  const cy = parts.reduce((sum, part) => sum + part.y, 0) / parts.length;
  const far = uncoveredSpot(parts, ctx.floorPlan)?.point ?? farFloorPoint(parts, ctx.floorPlan);
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
        const toward = others
          .filter((port) => port.instanceId !== head.instanceId)
          .reduce((min, port) => Math.min(min, distance(free, port)), 240);
        const leftover = remainingInventory(inventory, [...parts, candidate]);
        const remaining = (leftover['straight-16'] ?? 0) + (leftover['curve-22'] ?? 0);
        const wall = wallScore(free, ctx.floorPlan);
        const mix = type === 'curve-22' && ctx.random() < 0.55 ? 6 : 0;
        const headBias = far ? Math.hypot(head.x - far.x, head.y - far.y) * 0.2 : 0;
        const score = ctx.floorPlan
          ? roomGrowScore(free, remaining, toward, wall, mix, cx, cy, far, ctx.random(), head) + headBias
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

function uncoveredSpot(
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
  for (const head of heads) {
    if (distance(head, lastSpecial) < MIN_SPECIAL_GAP) {
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
  const joined = growToward(parts, pair[0], pair[1], inventory, ctx, 'jn');
  if (joined.length <= parts.length) {
    return null;
  }
  return joined;
}

function closeRemaining(parts: PlacedPart[], inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  let result = parts;
  for (let attempt = 0; attempt < 8 && !loopCloses(result, ctx.catalog); attempt += 1) {
    const heads = openPorts(result, ctx.catalog);
    if (heads.length < 2) {
      break;
    }
    const joined = joinNearestHeads(result, inventory, ctx, heads);
    if (!joined) {
      break;
    }
    result = joined;
  }
  return result;
}
