import { PlacedPart } from '../../shared/models/track';
import { placementCollides } from './collide';
import { detectConnections, openPorts, remainingInventory } from './connections';
import {
  distance,
  headingDelta,
  normalizeHeading,
  portsConnect,
  rotatePoint,
  SWITCH_LENGTH,
  WorldPort,
  worldPorts,
} from './geometry';
import { GenContext, nextId, ownerOf, placeOnHead, stockOf, tryAttach } from './place';
import { TopologyPlan } from './topology';
import { growDeadEnd, ovalJoin, targetClosed } from './wander';

function switchQueue(inventory: Record<string, number>, parts: PlacedPart[]): string[] {
  const left = remainingInventory(inventory, parts);
  const queue: string[] = [];
  for (let i = 0; i < (left['switch-left'] ?? 0); i += 1) {
    queue.push('switch-left');
  }
  for (let i = 0; i < (left['switch-right'] ?? 0); i += 1) {
    queue.push('switch-right');
  }
  return queue;
}

function flipSwitchInPlace(part: PlacedPart): PlacedPart {
  const offset = rotatePoint({ x: SWITCH_LENGTH, y: 0 }, part.rotation);
  return {
    ...part,
    x: part.x + offset.x,
    y: part.y + offset.y,
    rotation: normalizeHeading(part.rotation + 180),
  };
}

interface StraightPair {
  first: PlacedPart;
  second: PlacedPart;
}

function straightPairs(parts: PlacedPart[], catalog: GenContext['catalog']): StraightPair[] {
  const byId = Object.fromEntries(parts.map((part) => [part.instanceId, part]));
  const pairs: StraightPair[] = [];
  for (const connection of detectConnections(parts, catalog)) {
    const a = byId[connection.fromInstanceId];
    const b = byId[connection.toInstanceId];
    if (!a || !b || a.partId !== 'straight-16' || b.partId !== 'straight-16') {
      continue;
    }
    if (headingDelta(a.rotation, b.rotation) > 8 && headingDelta(a.rotation, b.rotation + 180) > 8) {
      continue;
    }
    pairs.push({ first: a, second: b });
  }
  return pairs;
}

function tripleStraights(parts: PlacedPart[], catalog: GenContext['catalog']): PlacedPart[][] {
  const pairs = straightPairs(parts, catalog);
  const triples: PlacedPart[][] = [];
  for (const pair of pairs) {
    const next = pairs.find(
      (other) =>
        other.first.instanceId === pair.second.instanceId &&
        other.second.instanceId !== pair.first.instanceId,
    );
    if (next) {
      triples.push([pair.first, pair.second, next.second]);
    }
  }
  return triples;
}

function farNeighbor(
  pair: StraightPair,
  parts: PlacedPart[],
  catalog: GenContext['catalog'],
): WorldPort | null {
  const connections = detectConnections(parts, catalog);
  const used = new Set([pair.first.instanceId, pair.second.instanceId]);
  for (const connection of connections) {
    const ends = [connection.fromInstanceId, connection.toInstanceId];
    if (!ends.includes(pair.second.instanceId)) {
      continue;
    }
    const otherId = ends[0] === pair.second.instanceId ? ends[1] : ends[0];
    if (used.has(otherId)) {
      continue;
    }
    const other = parts.find((part) => part.instanceId === otherId);
    if (!other) {
      continue;
    }
    const portId =
      connection.fromInstanceId === otherId ? connection.fromPortId : connection.toPortId;
    return worldPorts(catalog[other.partId], other).find((port) => port.id === portId) ?? null;
  }
  return null;
}

function tryReplacePairWithSwitch(
  parts: PlacedPart[],
  pair: StraightPair,
  partId: string,
  ctx: GenContext,
  prefix: string,
): PlacedPart[] | null {
  const far = farNeighbor(pair, parts, ctx.catalog);
  const candidate: PlacedPart = {
    ...pair.first,
    partId,
    instanceId: nextId(ctx, prefix),
  };
  const without = parts.filter(
    (part) => part.instanceId !== pair.first.instanceId && part.instanceId !== pair.second.instanceId,
  );
  const orientations = [candidate, flipSwitchInPlace(candidate)];
  const center = centroid(without.length ? without : parts);
  let best: PlacedPart[] | null = null;
  let bestDist = -1;
  for (const placed of orientations) {
    const ignore = far ? [far.instanceId] : [];
    if (placementCollides(placed, without, ctx.catalog, ignore)) {
      continue;
    }
    const next = [...without, placed];
    const diverge = worldPorts(ctx.catalog[placed.partId], placed).find((port) => port.id === 'diverge');
    const dist = diverge ? distance(diverge, center) : 0;
    if (dist >= bestDist) {
      best = next;
      bestDist = dist;
    }
  }
  return best;
}

function centroid(parts: PlacedPart[]): { x: number; y: number } {
  if (parts.length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: parts.reduce((sum, part) => sum + part.x, 0) / parts.length,
    y: parts.reduce((sum, part) => sum + part.y, 0) / parts.length,
  };
}

function pairDistance(a: StraightPair, b: StraightPair): number {
  return distance(a.first, b.first);
}

function pickSpreadPairs(pairs: StraightPair[], count: number, parts: PlacedPart[]): StraightPair[] {
  if (pairs.length === 0 || count <= 0) {
    return [];
  }
  const center = centroid(parts);
  const ranked = [...pairs].sort(
    (a, b) => distance(b.first, center) - distance(a.first, center),
  );
  const picked: StraightPair[] = [];
  const used = new Set<string>();
  for (const pair of ranked) {
    if (picked.length >= count) {
      break;
    }
    const ids = [pair.first.instanceId, pair.second.instanceId];
    if (ids.some((id) => used.has(id))) {
      continue;
    }
    if (picked.some((other) => pairDistance(pair, other) < 48)) {
      continue;
    }
    picked.push(pair);
    ids.forEach((id) => used.add(id));
  }
  if (picked.length < count) {
    for (const pair of pairs) {
      if (picked.length >= count) {
        break;
      }
      const ids = [pair.first.instanceId, pair.second.instanceId];
      if (ids.some((id) => used.has(id))) {
        continue;
      }
      picked.push(pair);
      ids.forEach((id) => used.add(id));
    }
  }
  return picked;
}

export function switchOpens(parts: PlacedPart[], catalog: GenContext['catalog']): WorldPort[] {
  return openPorts(parts, catalog).filter((port) => {
    const owner = ownerOf(port, parts);
    return !!owner && catalog[owner.partId].category === 'switch';
  });
}

export function divergesOf(parts: PlacedPart[], catalog: GenContext['catalog']): WorldPort[] {
  return switchOpens(parts, catalog).filter((port) => port.id === 'diverge');
}

function specialOpens(
  parts: PlacedPart[],
  catalog: GenContext['catalog'],
  category: 'double-crossover' | 'crossing',
): WorldPort[] {
  return openPorts(parts, catalog).filter((port) => {
    const owner = ownerOf(port, parts);
    return !!owner && catalog[owner.partId].category === category;
  });
}

function insertSwitches(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  count: number,
  prefix: string,
): PlacedPart[] {
  let result = parts;
  const queue = switchQueue(inventory, result);
  const pairs = pickSpreadPairs(straightPairs(result, ctx.catalog), count, result);
  let used = 0;
  for (const pair of pairs) {
    if (used >= count || used >= queue.length) {
      break;
    }
    const next = tryReplacePairWithSwitch(result, pair, queue[used], ctx, prefix);
    if (next) {
      result = next;
      used += 1;
    }
  }
  return result;
}

function extendSwitchHead(
  parts: PlacedPart[],
  port: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): { parts: PlacedPart[]; head: WorldPort } {
  const owner = ownerOf(port, parts);
  if (!owner || ctx.catalog[owner.partId]?.category !== 'switch' || port.id !== 'diverge') {
    return { parts, head: port };
  }
  if ((stockOf(inventory, parts)['curve-22'] ?? 0) <= 0) {
    return { parts, head: port };
  }
  const order = owner.partId === 'switch-left' ? (['b', 'a'] as const) : (['a', 'b'] as const);
  for (const portId of order) {
    const move = placeOnHead('curve-22', portId, port, parts, ctx, 'par');
    if (move) {
      return { parts: [...parts, move.part], head: move.head };
    }
  }
  return { parts, head: port };
}

function joinOpenPairs(
  parts: PlacedPart[],
  starts: WorldPort[],
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix: string,
  preferRoomy = false,
): PlacedPart[] {
  let result = parts;
  const remaining = [...starts];
  while (remaining.length >= 2) {
    const start = remaining.shift()!;
    remaining.sort((a, b) => distance(start, a) - distance(start, b));
    let joined = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const target = remaining[i];
      const liveStart = openPorts(result, ctx.catalog).find(
        (port) => port.instanceId === start.instanceId && port.id === start.id,
      );
      const liveTarget = openPorts(result, ctx.catalog).find(
        (port) => port.instanceId === target.instanceId && port.id === target.id,
      );
      if (!liveStart || !liveTarget) {
        continue;
      }
      const startExt = extendSwitchHead(result, liveStart, inventory, ctx);
      const targetExt = extendSwitchHead(startExt.parts, liveTarget, inventory, ctx);
      const next = ovalJoin(
        targetExt.parts,
        startExt.head,
        targetExt.head,
        inventory,
        ctx,
        prefix,
        preferRoomy,
      );
      if (next && targetClosed(next, ctx.catalog, targetExt.head) && targetClosed(next, ctx.catalog, startExt.head)) {
        result = next;
        remaining.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (!joined) {
      break;
    }
  }
  return result;
}

function insertCrossover(parts: PlacedPart[], inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  if ((stockOf(inventory, parts)['double-crossover'] ?? 0) <= 0) {
    return parts;
  }
  const triples = tripleStraights(parts, ctx.catalog);
  const part = ctx.catalog['double-crossover'];
  for (const triple of triples) {
    const incoming = worldPorts(ctx.catalog[triple[0].partId], triple[0]);
    const connections = detectConnections(parts, ctx.catalog);
    let attachOn: WorldPort | null = null;
    for (const port of incoming) {
      const hit = connections.find(
        (connection) =>
          (connection.fromInstanceId === triple[0].instanceId && connection.fromPortId === port.id) ||
          (connection.toInstanceId === triple[0].instanceId && connection.toPortId === port.id),
      );
      if (!hit) {
        continue;
      }
      const otherId =
        hit.fromInstanceId === triple[0].instanceId ? hit.toInstanceId : hit.fromInstanceId;
      if (triple.some((item) => item.instanceId === otherId)) {
        continue;
      }
      const other = parts.find((item) => item.instanceId === otherId);
      if (!other) {
        continue;
      }
      const otherPort = hit.fromInstanceId === otherId ? hit.fromPortId : hit.toPortId;
      attachOn = worldPorts(ctx.catalog[other.partId], other).find((item) => item.id === otherPort) ?? null;
      if (attachOn) {
        break;
      }
    }
    if (!attachOn) {
      continue;
    }
    const without = parts.filter((item) => !triple.some((piece) => piece.instanceId === item.instanceId));
    const ignore = triple.map((item) => item.instanceId);
    for (const xoPort of ['a', 'b', 'c', 'd']) {
      const placed = tryAttach(part, xoPort, attachOn, without, ctx.catalog, nextId(ctx, 'xo'), ignore);
      if (placed) {
        return [...without, placed];
      }
    }
  }
  if (parts.length === 0) {
    return seedCrossover(inventory, ctx) ?? parts;
  }
  return parts;
}

function seedCrossover(inventory: Record<string, number>, ctx: GenContext): PlacedPart[] | null {
  if ((inventory['double-crossover'] ?? 0) <= 0) {
    return null;
  }
  const seeded: PlacedPart = {
    instanceId: nextId(ctx, 'xo'),
    partId: 'double-crossover',
    label: 1,
    x: 0,
    y: 0,
    rotation: 0,
  };
  const ports = worldPorts(ctx.catalog['double-crossover'], seeded);
  const a = ports.find((port) => port.id === 'a');
  const b = ports.find((port) => port.id === 'b');
  const c = ports.find((port) => port.id === 'c');
  const d = ports.find((port) => port.id === 'd');
  if (!a || !b) {
    return [seeded];
  }
  const first = ovalJoin([seeded], a, b, inventory, ctx, 'xo');
  if (!first) {
    return [seeded];
  }
  const liveC = openPorts(first, ctx.catalog).find(
    (port) => port.instanceId === seeded.instanceId && port.id === 'c',
  );
  const liveD = openPorts(first, ctx.catalog).find(
    (port) => port.instanceId === seeded.instanceId && port.id === 'd',
  );
  if (!liveC || !liveD || !c || !d) {
    return first;
  }
  return ovalJoin(first, liveC, liveD, inventory, ctx, 'xo') ?? first;
}

function insertCrossing(parts: PlacedPart[], inventory: Record<string, number>, ctx: GenContext): PlacedPart[] {
  if ((stockOf(inventory, parts)['crossing-90'] ?? 0) <= 0) {
    return parts;
  }
  const pairs = straightPairs(parts, ctx.catalog);
  const singles = parts.filter((part) => part.partId === 'straight-16');
  const part = ctx.catalog['crossing-90'];
  for (const straight of singles) {
    const ports = worldPorts(ctx.catalog[straight.partId], straight);
    const connections = detectConnections(parts, ctx.catalog);
    let attachOn: WorldPort | null = null;
    for (const port of ports) {
      const hit = connections.find(
        (connection) =>
          (connection.fromInstanceId === straight.instanceId && connection.fromPortId === port.id) ||
          (connection.toInstanceId === straight.instanceId && connection.toPortId === port.id),
      );
      if (!hit) {
        continue;
      }
      const otherId =
        hit.fromInstanceId === straight.instanceId ? hit.toInstanceId : hit.fromInstanceId;
      const other = parts.find((item) => item.instanceId === otherId);
      if (!other) {
        continue;
      }
      const otherPort = hit.fromInstanceId === otherId ? hit.fromPortId : hit.toPortId;
      attachOn = worldPorts(ctx.catalog[other.partId], other).find((item) => item.id === otherPort) ?? null;
      if (attachOn) {
        break;
      }
    }
    if (!attachOn) {
      continue;
    }
    const without = parts.filter((item) => item.instanceId !== straight.instanceId);
    const placed = tryAttach(part, 'west', attachOn, without, ctx.catalog, nextId(ctx, 'cr'));
    if (placed) {
      return [...without, placed];
    }
  }
  void pairs;
  return parts;
}

function addParking(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  count: number,
): PlacedPart[] {
  let result = parts;
  for (let i = 0; i < count; i += 1) {
    const opens = divergesOf(result, ctx.catalog);
    if (opens.length === 0) {
      break;
    }
    const left = stockOf(inventory, result);
    const available = (left['straight-16'] ?? 0) + (left['curve-22'] ?? 0);
    if (available <= 0) {
      break;
    }
    const length = Math.max(1, available);
    result = growDeadEnd(result, opens[0], inventory, ctx, length, 'sid');
  }
  return result;
}

function closeKeerlus(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] {
  const opens = switchOpens(parts, ctx.catalog);
  const diverges = opens.filter((port) => port.id === 'diverge');
  const throughs = opens.filter((port) => port.id === 'through');
  if (diverges.length === 0) {
    return parts;
  }
  const start = diverges[0];
  const targets = [
    ...throughs.filter((port) => port.instanceId === start.instanceId),
    ...throughs,
    ...specialOpens(parts, ctx.catalog, 'double-crossover'),
    ...specialOpens(parts, ctx.catalog, 'crossing'),
    ...diverges.filter((port) => port.instanceId !== start.instanceId),
  ];
  for (const target of targets) {
    const liveStart = openPorts(parts, ctx.catalog).find(
      (port) => port.instanceId === start.instanceId && port.id === start.id,
    );
    const liveTarget = openPorts(parts, ctx.catalog).find(
      (port) => port.instanceId === target.instanceId && port.id === target.id,
    );
    if (!liveStart || !liveTarget) {
      continue;
    }
    const joined = ovalJoin(parts, liveStart, liveTarget, inventory, ctx, 'kel');
    if (joined && targetClosed(joined, ctx.catalog, liveTarget)) {
      return joined;
    }
  }
  return parts;
}

function seedFromSwitch(
  inventory: Record<string, number>,
  ctx: GenContext,
  parkLength: number,
): PlacedPart[] | null {
  const queue = switchQueue(inventory, []);
  if (queue.length === 0) {
    return null;
  }
  const seeded: PlacedPart = {
    instanceId: nextId(ctx, 'sw'),
    partId: queue[0],
    label: 1,
    x: 0,
    y: 0,
    rotation: 0,
  };
  const through = worldPorts(ctx.catalog[seeded.partId], seeded).find((port) => port.id === 'through');
  const stem = worldPorts(ctx.catalog[seeded.partId], seeded).find((port) => port.id === 'stem');
  if (!through || !stem) {
    return null;
  }
  const turnOrder: Array<'a' | 'b'> = seeded.partId === 'switch-left' ? ['b', 'a'] : ['a', 'b'];
  const loop = ovalJoin([seeded], through, stem, inventory, ctx, 'sw', false, turnOrder);
  if (!loop) {
    return null;
  }
  if (parkLength <= 0) {
    return loop;
  }
  const liveDiverge = openPorts(loop, ctx.catalog).find(
    (port) => port.instanceId === seeded.instanceId && port.id === 'diverge',
  );
  return liveDiverge ? growDeadEnd(loop, liveDiverge, inventory, ctx, parkLength, 'sid') : loop;
}

function seedDualRoute(
  inventory: Record<string, number>,
  ctx: GenContext,
  roomyCore: boolean,
): PlacedPart[] | null {
  const queue = switchQueue(inventory, []);
  if (queue.length < 2) {
    return null;
  }
  const seeded: PlacedPart = {
    instanceId: nextId(ctx, 'rte'),
    partId: queue[0],
    label: 1,
    x: 0,
    y: 0,
    rotation: 0,
  };
  const through = worldPorts(ctx.catalog[seeded.partId], seeded).find((port) => port.id === 'through');
  const stem = worldPorts(ctx.catalog[seeded.partId], seeded).find((port) => port.id === 'stem');
  if (!through || !stem) {
    return null;
  }
  const plenty =
    roomyCore && (inventory['curve-22'] ?? 0) >= 60 && (inventory['straight-16'] ?? 0) >= 40;
  const turnOrder: Array<'a' | 'b'> = seeded.partId === 'switch-left' ? ['b', 'a'] : ['a', 'b'];
  const loop = ovalJoin([seeded], through, stem, inventory, ctx, 'rte', plenty, turnOrder);
  if (!loop) {
    return null;
  }
  const withSecond = insertSwitches(loop, inventory, ctx, 1, 'rte');
  const diverges = divergesOf(withSecond, ctx.catalog);
  if (diverges.length < 2) {
    return loop;
  }
  const joined =
    joinOpenPairs(withSecond, diverges, inventory, ctx, 'rte', true) ?? withSecond;
  const closed = joinOpenPairs(joined, divergesOf(joined, ctx.catalog), inventory, ctx, 'rte', false);
  return divergesOf(closed, ctx.catalog).length === 0 ? closed : loop;
}

function placeDualRoutes(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  count: number,
  roomyCore: boolean,
  parking: number,
): PlacedPart[] {
  const seeded = seedDualRoute(inventory, ctx, roomyCore);
  if (seeded && divergesOf(seeded, ctx.catalog).length === 0) {
    return seeded;
  }
  if (parking > 0) {
    return parts;
  }
  let result = seeded ?? parts;
  const placed = result.filter((part) => part.partId.startsWith('switch-')).length;
  const stillNeed = Math.max(0, count * 2 - placed);
  if (stillNeed > 0) {
    result = insertSwitches(result, inventory, ctx, stillNeed, 'rte');
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', true);
  } else if (divergesOf(result, ctx.catalog).length >= 2) {
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', true);
  }
  return result;
}

export function applyFeatures(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  plan: TopologyPlan,
  ctx: GenContext,
): PlacedPart[] {
  let result = parts;

  if (plan.dualRoutes > 0) {
    result = placeDualRoutes(result, inventory, ctx, plan.dualRoutes, plan.parking === 0, plan.parking);
  }

  const beforeXo = result;
  result = insertCrossover(result, inventory, ctx);
  if (
    plan.crossovers > 0 &&
    !result.some((part) => part.partId === 'double-crossover') &&
    !result.some((part) => part.partId.startsWith('switch-'))
  ) {
    const seeded = seedCrossover(inventory, ctx);
    if (seeded) {
      result = seeded;
    }
  }
  result = joinOpenPairs(result, specialOpens(result, ctx.catalog, 'double-crossover'), inventory, ctx, 'xo', true);
  if (plan.parking > 0 && specialOpens(result, ctx.catalog, 'double-crossover').length > 0) {
    result = beforeXo;
  }
  result = insertCrossing(result, inventory, ctx);
  result = joinOpenPairs(result, specialOpens(result, ctx.catalog, 'crossing'), inventory, ctx, 'cr', true);

  if (plan.keerlussen > 0 && plan.dualRoutes === 0 && plan.parking === 0) {
    result = insertSwitches(result, inventory, ctx, plan.keerlussen, 'kel');
    result = closeKeerlus(result, inventory, ctx);
    if (!result.some((part) => part.partId.startsWith('switch-'))) {
      const seeded = seedFromSwitch(inventory, ctx, 0);
      if (seeded) {
        result = seeded;
      }
      result = closeKeerlus(result, inventory, ctx);
    }
  }

  const leftoverDiverges = divergesOf(result, ctx.catalog);
  if (leftoverDiverges.length >= 2) {
    result = joinOpenPairs(result, leftoverDiverges, inventory, ctx, 'rte', true);
  } else if (leftoverDiverges.length === 1 && plan.parking === 0) {
    result = closeKeerlus(result, inventory, ctx);
  }

  return result;
}

export function placeParking(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  count: number,
): PlacedPart[] {
  if (count <= 0) {
    return parts;
  }
  let result = parts;
  const openDiverges = divergesOf(result, ctx.catalog).length;
  if (openDiverges < count) {
    result = insertSwitches(result, inventory, ctx, count - openDiverges, 'sid');
  }
  result = addParking(result, inventory, ctx, count);
  if (!hasParkingSiding(result, ctx)) {
    result = insertSwitches(result, inventory, ctx, count, 'sid');
    result = addParking(result, inventory, ctx, count);
  }
  if (!hasParkingSiding(result, ctx)) {
    const left = stockOf(inventory, result);
    const seeded = seedFromSwitch(inventory, ctx, Math.max(8, left['straight-16'] ?? 0));
    if (seeded) {
      return seeded;
    }
  }
  return result;
}

function hasParkingSiding(parts: PlacedPart[], ctx: GenContext): boolean {
  const connections = detectConnections(parts, ctx.catalog);
  const degree = new Map<string, number>();
  for (const part of parts) {
    degree.set(part.instanceId, 0);
  }
  for (const connection of connections) {
    degree.set(connection.fromInstanceId, (degree.get(connection.fromInstanceId) ?? 0) + 1);
    degree.set(connection.toInstanceId, (degree.get(connection.toInstanceId) ?? 0) + 1);
  }
  return parts.some(
    (part) =>
      (part.partId === 'straight-16' || part.partId === 'curve-22') && (degree.get(part.instanceId) ?? 0) === 1,
  );
}

export function placeRemainingSpecials(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  parking = 0,
): PlacedPart[] {
  let result = parts;
  const left = stockOf(inventory, result);
  if ((left['double-crossover'] ?? 0) > 0 && !result.some((part) => part.partId === 'double-crossover')) {
    const before = result;
    result = insertCrossover(result, inventory, ctx);
    result = joinOpenPairs(result, specialOpens(result, ctx.catalog, 'double-crossover'), inventory, ctx, 'xo', true);
    if (parking > 0 && specialOpens(result, ctx.catalog, 'double-crossover').length > 0) {
      result = before;
    }
  }
  if ((left['crossing-90'] ?? 0) > 0 && !result.some((part) => part.partId === 'crossing-90')) {
    result = insertCrossing(result, inventory, ctx);
    result = joinOpenPairs(result, specialOpens(result, ctx.catalog, 'crossing'), inventory, ctx, 'cr', true);
  }
  if (parking > 0) {
    return result;
  }
  const switchesLeft = switchQueue(inventory, result);
  if (switchesLeft.length >= 2) {
    const before = result;
    const openBefore = divergesOf(result, ctx.catalog).length;
    result = insertSwitches(result, inventory, ctx, 2, 'sw');
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'sw', true);
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'sw', false);
    if (divergesOf(result, ctx.catalog).length > openBefore) {
      result = before;
    }
  }
  return result;
}
