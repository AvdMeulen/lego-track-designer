import { FloorPlan } from '../../shared/models/floor-plan';
import { GenerationPreferences, PlacedPart } from '../../shared/models/track';
import { floorBounds, placementHitsRoom } from '../floor-plan/space';
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
  const maxSteps = Math.min(120, 8 + Object.values(inventory).reduce((sum, qty) => sum + qty, 0));
  let lastSpecialAt = { x: start.x, y: start.y };
  let idle = 0;

  for (let step = 0; step < maxSteps && Date.now() < ctx.deadline; step += 1) {
    const stock = remainingInventory(inventory, parts);
    const heads = openPorts(parts, ctx.catalog);
    if (!heads.length) {
      const leftover = (stock['straight-16'] ?? 0) + (stock['curve-22'] ?? 0);
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

    const placedSwitch = maybePlaceSwitch(parts, inventory, ctx, heads, lastSpecialAt, prefs);
    if (placedSwitch) {
      parts = placedSwitch.parts;
      lastSpecialAt = { x: placedSwitch.at.x, y: placedSwitch.at.y };
      idle = 0;
      continue;
    }

    const grown = growBestHead(parts, inventory, ctx, heads);
    if (grown) {
      parts = grown;
      idle = 0;
      continue;
    }

    const joined = joinNearestHeads(parts, inventory, ctx, heads);
    if (joined) {
      parts = joined;
      idle = 0;
      continue;
    }

    idle += 1;
    if (idle > 6) {
      break;
    }
  }

  parts = closeRemaining(parts, inventory, ctx);
  const leftover = remainingInventory(inventory, parts);
  if ((leftover['straight-16'] ?? 0) + (leftover['curve-22'] ?? 0) > 0) {
    parts = inflateLoop(parts, inventory, ctx, 16, prefs.targetParkingSpots * 6);
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
  const candidates: Array<{ x: number; y: number; rotation: number }> = [{ x: 0, y: 0, rotation: 0 }];
  if (ctx.floorPlan) {
    const bounds = floorBounds(ctx.floorPlan);
    for (let y = bounds.minY + 14; y < bounds.maxY - 14; y += 20) {
      for (let x = bounds.minX + 14; x < bounds.maxX - 14; x += 20) {
        candidates.push({ x, y, rotation: 0 });
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
  const sample = heads.length > 4 ? heads.filter((_, index) => index % Math.ceil(heads.length / 4) === 0) : heads;
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
        const closeEarly = remaining > 18 ? Math.max(0, 90 - toward) : 0;
        const wall = wallScore(free, ctx.floorPlan);
        const mix = type === 'curve-22' && ctx.random() < 0.55 ? 6 : 0;
        const score = toward * 0.35 + wall + mix + closeEarly + ctx.random() * 4;
        if (!best || score < best.score) {
          best = { parts: [...parts, candidate], score };
        }
      }
    }
  }
  return best?.parts ?? null;
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
): PlacedPart[] | null {
  if (heads.length < 2) {
    return null;
  }
  let pair: [WorldPort, WorldPort] | null = null;
  let best = 80;
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
