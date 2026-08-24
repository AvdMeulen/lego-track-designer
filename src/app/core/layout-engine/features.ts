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
import { GenContext, neighborsOf, nextId, ownerOf, placeOnHead, seedOrigin, stockOf, tryAttach } from './place';
import { TopologyPlan } from './topology';
import { attachSequenceFrom, growDeadEnd, joinHeads, ovalJoin, targetClosed, wanderJoin } from './wander';

/** Train-length siding. Leftovers belong on the loops, not a runway. */
const PARK_SIDING = 6;
/** Below this, a two-curve passing loop may be the only way to close a second route. */
const LARGE_LAYOUT = 80;

function switchQueue(inventory: Record<string, number>, parts: PlacedPart[]): string[] {
  const left = remainingInventory(inventory, parts);
  const nLeft = left['switch-left'] ?? 0;
  const nRight = left['switch-right'] ?? 0;
  const queue: string[] = [];
  const pairs = Math.min(nLeft, nRight);
  for (let i = 0; i < pairs; i += 1) {
    queue.push('switch-left', 'switch-right');
  }
  for (let i = 0; i < nLeft - pairs; i += 1) {
    queue.push('switch-left');
  }
  for (let i = 0; i < nRight - pairs; i += 1) {
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
  rawPair: StraightPair,
  partId: string,
  ctx: GenContext,
  prefix: string,
): PlacedPart[] | null {
  const pair = orderStraightPair(rawPair);
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
  const preferInward = ctx.random() < 0.65;
  let best: PlacedPart[] | null = null;
  let bestDist = preferInward ? Number.POSITIVE_INFINITY : -1;
  for (const placed of orientations) {
    const ignore = far ? [far.instanceId] : [];
    if (placementCollides(placed, without, ctx.catalog, ignore)) {
      continue;
    }
    const next = [...without, placed];
    const diverge = worldPorts(ctx.catalog[placed.partId], placed).find((port) => port.id === 'diverge');
    const dist = diverge ? distance(diverge, center) : 0;
    if (preferInward ? dist <= bestDist : dist >= bestDist) {
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

function orderStraightPair(pair: StraightPair): StraightPair {
  const dx = pair.second.x - pair.first.x;
  const dy = pair.second.y - pair.first.y;
  const rad = (pair.first.rotation * Math.PI) / 180;
  const dot = dx * Math.cos(rad) + dy * Math.sin(rad);
  return dot >= 0 ? pair : { first: pair.second, second: pair.first };
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
    if (picked.some((other) => distance(pair.first, other.first) < 48)) {
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

function straightPartRuns(pairs: StraightPair[]): PlacedPart[][] {
  const byId = new Map<string, PlacedPart>();
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    const list = adj.get(a) ?? [];
    if (!list.includes(b)) {
      list.push(b);
      adj.set(a, list);
    }
  };
  for (const pair of pairs) {
    byId.set(pair.first.instanceId, pair.first);
    byId.set(pair.second.instanceId, pair.second);
    addEdge(pair.first.instanceId, pair.second.instanceId);
    addEdge(pair.second.instanceId, pair.first.instanceId);
  }
  const visited = new Set<string>();
  const runs: PlacedPart[][] = [];
  const nodes = [...adj.keys()];
  const starts = nodes.filter((id) => (adj.get(id)?.length ?? 0) === 1);
  for (const seed of starts.length ? starts : nodes) {
    if (visited.has(seed)) {
      continue;
    }
    const run: PlacedPart[] = [];
    let prev: string | null = null;
    let cur: string | null = seed;
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const part = byId.get(cur);
      if (part) {
        run.push(part);
      }
      const next: string | undefined = (adj.get(cur) ?? []).find((id) => id !== prev);
      prev = cur;
      cur = next ?? null;
    }
    if (run.length >= 2) {
      runs.push(run);
    }
  }
  return runs;
}

function claimPair(pair: StraightPair, used: Set<string>): boolean {
  const ids = [pair.first.instanceId, pair.second.instanceId];
  if (ids.some((id) => used.has(id))) {
    return false;
  }
  ids.forEach((id) => used.add(id));
  return true;
}

/** Two switches on one straight run so their diverges can join as a local bubble. */
function pickClusteredPairs(pairs: StraightPair[], count: number): StraightPair[] {
  if (pairs.length === 0 || count <= 0) {
    return [];
  }
  const used = new Set<string>();
  const picked: StraightPair[] = [];
  const runs = straightPartRuns(pairs).sort((a, b) => b.length - a.length);
  const bubbles = Math.floor(count / 2);
  for (let i = 0; i < bubbles; i += 1) {
    let placed = false;
    for (const run of runs) {
      for (const spacer of [1, 0]) {
        const span = 3 + spacer;
        for (let start = 0; start + span < run.length; start += 1) {
          const first = orderStraightPair({ first: run[start], second: run[start + 1] });
          const second = orderStraightPair({
            first: run[start + 2 + spacer],
            second: run[start + 3 + spacer],
          });
          const ids = [
            first.first.instanceId,
            first.second.instanceId,
            second.first.instanceId,
            second.second.instanceId,
          ];
          if (new Set(ids).size !== 4 || ids.some((id) => used.has(id))) {
            continue;
          }
          ids.forEach((id) => used.add(id));
          picked.push(first, second);
          placed = true;
          break;
        }
        if (placed) {
          break;
        }
      }
      if (placed) {
        break;
      }
    }
    if (!placed) {
      break;
    }
  }
  if (picked.length < count) {
    for (const pair of pairs) {
      if (picked.length >= count) {
        break;
      }
      if (claimPair(orderStraightPair(pair), used)) {
        picked.push(orderStraightPair(pair));
      }
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
  clustered = false,
): PlacedPart[] {
  let result = parts;
  const queue = switchQueue(inventory, result);
  const available = straightPairs(result, ctx.catalog);
  const pairs = clustered
    ? pickClusteredPairs(available, count)
    : pickSpreadPairs(available, count, result);
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

function pickPassingSlices(
  pairs: StraightPair[],
  bubbles: number,
  random: () => number,
): PlacedPart[][] {
  const runs = straightPartRuns(pairs).sort((a, b) => b.length - a.length);
  const used = new Set<string>();
  const slices: PlacedPart[][] = [];
  const take = (need: number) => {
    for (const run of runs) {
      if (slices.length >= bubbles) {
        return;
      }
      const slack = Math.max(0, run.length - need - 1);
      const start = slack > 0 ? 1 + Math.floor(random() * slack) : 0;
      for (let i = start; i + need <= run.length; i += 1) {
        const slice = run.slice(i, i + need);
        if (slice.some((part) => used.has(part.instanceId))) {
          continue;
        }
        slice.forEach((part) => used.add(part.instanceId));
        slices.push(slice);
        break;
      }
    }
  };
  take(10);
  take(8);
  take(6);
  take(4);
  return slices;
}

function closePassingHeads(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  if (portsConnect(start, target)) {
    return parts.length >= LARGE_LAYOUT ? null : parts;
  }
  const left = stockOf(inventory, parts);
  const maxS = Math.min(8, left['straight-16'] ?? 0);
  const longEnough = (built: PlacedPart[]) => parts.length < LARGE_LAYOUT || built.length >= parts.length + 6;
  for (let n = 0; n <= maxS; n += 1) {
    const sequence = Array.from({ length: n }, () => ({ partId: 'straight-16' }));
    const built = attachSequenceFrom(parts, start, sequence, target, ctx, 'rte');
    if (built && longEnough(built)) {
      return built;
    }
  }
  if ((left['curve-22'] ?? 0) >= 2) {
    const turns: Array<['a' | 'b', 'a' | 'b']> = [
      ['a', 'b'],
      ['b', 'a'],
    ];
    for (const [first, second] of turns) {
      for (let extra = 0; extra <= Math.min(4, maxS); extra += 1) {
        const sequence: Array<{ partId: string; portId?: string }> = [{ partId: 'curve-22', portId: first }];
        for (let i = 0; i < extra; i += 1) {
          sequence.push({ partId: 'straight-16' });
        }
        sequence.push({ partId: 'curve-22', portId: second });
        const built = attachSequenceFrom(parts, start, sequence, target, ctx, 'rte');
        if (built && longEnough(built)) {
          return built;
        }
      }
    }
  }
  if (parts.length >= LARGE_LAYOUT) {
    const bulge = uTurnJoin(parts, start, target, inventory, ctx);
    if (bulge && longEnough(bulge)) {
      return bulge;
    }
    const walked = wanderJoin(
      parts,
      start,
      target,
      inventory,
      ctx,
      'rte',
      ctx.random() < 0.7 ? 'inward' : 'mixed',
      6,
    );
    if (walked && longEnough(walked)) {
      return walked;
    }
    const oval = ovalJoin(parts, start, target, inventory, ctx, 'rte', false);
    return oval && longEnough(oval) ? oval : null;
  }
  return (
    wanderJoin(parts, start, target, inventory, ctx, 'rte', ctx.random() < 0.7 ? 'inward' : 'mixed') ??
    joinHeads(parts, start, target, inventory, ctx, 'rte') ??
    ovalJoin(parts, start, target, inventory, ctx, 'rte', false)
  );
}

function closeLongPassing(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  ignore: string[],
): PlacedPart[] | null {
  if (parts.length >= 40 && Date.now() < ctx.deadline - 400) {
    const leftover = stockOf(inventory, parts);
    if ((leftover['curve-22'] ?? 0) + (leftover['straight-16'] ?? 0) >= 8) {
      const bias = ctx.random() < 0.7 ? 'outward' : 'mixed';
      const wandered = wanderJoin(parts, start, target, inventory, ctx, 'rte', bias, 8);
      if (wandered && wandered.length >= parts.length + 8) {
        return wandered;
      }
    }
  }
  const first = extendSwitchHead(parts, start, inventory, ctx, ignore, false);
  const added = first.parts
    .filter((part) => !parts.some((item) => item.instanceId === part.instanceId))
    .map((part) => part.instanceId);
  const liveTarget = openPorts(first.parts, ctx.catalog).find(
    (port) => port.instanceId === target.instanceId && port.id === target.id,
  );
  if (!liveTarget) {
    return null;
  }
  const second = extendSwitchHead(first.parts, liveTarget, inventory, ctx, [...ignore, ...added], false);
  if (portsConnect(first.head, second.head)) {
    const bulge = uTurnJoin(first.parts, first.head, liveTarget, inventory, ctx);
    if (bulge && bulge.length >= parts.length + 6 && targetClosed(bulge, ctx.catalog, liveTarget)) {
      return bulge;
    }
    return null;
  }
  const maxS = Math.min(10, stockOf(inventory, second.parts)['straight-16'] ?? 0);
  for (let n = 4; n <= maxS; n += 1) {
    const built = attachSequenceFrom(
      second.parts,
      first.head,
      Array.from({ length: n }, () => ({ partId: 'straight-16' })),
      second.head,
      ctx,
      'rte',
    );
    if (built && built.length >= parts.length + 6) {
      return built;
    }
  }
  return null;
}

function tryPassingLoop(
  parts: PlacedPart[],
  slice: PlacedPart[],
  firstId: string,
  secondId: string,
  inventory: Record<string, number>,
  ctx: GenContext,
  minSize = 4,
): PlacedPart[] | null {
  const sizes = (parts.length >= 32 ? [10, 8, 6, 4] : [6, 4]).filter((size) => size >= minSize);
  for (const size of sizes) {
    if (slice.length < size) {
      continue;
    }
    const requireLong = parts.length >= 32 && size >= 8;
    const next = tryPassingLoopWindow(
      parts,
      slice.slice(0, size),
      firstId,
      secondId,
      inventory,
      ctx,
      requireLong,
    );
    if (next) {
      return next;
    }
  }
  return null;
}

function tryPassingLoopWindow(
  parts: PlacedPart[],
  slice: PlacedPart[],
  firstId: string,
  secondId: string,
  inventory: Record<string, number>,
  ctx: GenContext,
  requireLong = false,
): PlacedPart[] | null {
  const span = slice.length;
  if (span < 4) {
    return null;
  }
  const window = slice;
  const replace = [window[0], window[1], window[span - 2], window[span - 1]];
  const keepMiddle = window.slice(2, span - 2);
  const replaceIds = new Set(replace.map((part) => part.instanceId));
  const without = parts.filter((part) => !replaceIds.has(part.instanceId));
  const middleIds = keepMiddle.map((part) => part.instanceId);
  const ignore = [
    ...middleIds,
    ...without
      .filter(
        (part) =>
          !middleIds.includes(part.instanceId) && replace.some((item) => distance(part, item) < 40),
      )
      .map((part) => part.instanceId),
  ];
  const firstPair = orderStraightPair({ first: window[0], second: window[1] });
  const secondPair = orderStraightPair({ first: window[span - 2], second: window[span - 1] });
  const make = (partId: string, pose: PlacedPart, flip: boolean): PlacedPart => {
    const placed: PlacedPart = {
      ...pose,
      partId,
      instanceId: nextId(ctx, 'rte'),
    };
    return flip ? flipSwitchInPlace(placed) : placed;
  };
  const attempts: Array<[PlacedPart, PlacedPart]> = [
    [make(firstId, firstPair.first, false), make(secondId, secondPair.first, true)],
    [make(firstId, firstPair.first, true), make(secondId, secondPair.first, false)],
    [make(secondId, firstPair.first, false), make(firstId, secondPair.first, true)],
    [make(secondId, firstPair.first, true), make(firstId, secondPair.first, false)],
  ];
  const center = centroid(without.length ? without : parts);
  const inward = ctx.random() < 0.65;
  const ranked = attempts
    .filter(
      ([a, b]) =>
        !placementCollides(a, without, ctx.catalog, ignore) &&
        !placementCollides(b, [...without, a], ctx.catalog, ignore),
    )
    .sort((left, right) =>
      requireLong || !inward
        ? divergeSpread(right, center, ctx) - divergeSpread(left, center, ctx)
        : divergeSpread(left, center, ctx) - divergeSpread(right, center, ctx),
    );
  for (const [a, b] of ranked) {
    const placed = [...without, a, b];
    const diverges = divergesOf(placed, ctx.catalog);
    if (diverges.length < 2) {
      continue;
    }
    const featureIgnore = [a.instanceId, b.instanceId, ...middleIds];
    const leftover = stockOf(inventory, placed);
    const roomy = placed.length >= 40;
    if (requireLong || (roomy && (leftover['curve-22'] ?? 0) >= 12 && (leftover['straight-16'] ?? 0) >= 4)) {
      const nested = closeLongPassing(placed, diverges[0], diverges[1], inventory, ctx, featureIgnore);
      if (nested && divergesOf(nested, ctx.catalog).length === 0) {
        return nested;
      }
      if (requireLong) {
        continue;
      }
    }
    const first = extendSwitchHead(placed, diverges[0], inventory, ctx, featureIgnore, roomy);
    const added = first.parts.filter((part) => !placed.some((item) => item.instanceId === part.instanceId));
    const second = extendSwitchHead(first.parts, diverges[1], inventory, ctx, [
      ...featureIgnore,
      ...added.map((part) => part.instanceId),
    ], roomy);
    const joined = closePassingHeads(second.parts, first.head, second.head, inventory, ctx);
    if (joined && divergesOf(joined, ctx.catalog).length === 0) {
      return joined;
    }
  }
  return null;
}

function divergeSpread(
  pair: [PlacedPart, PlacedPart],
  center: { x: number; y: number },
  ctx: GenContext,
): number {
  return pair.reduce((sum, part) => {
    const diverge = worldPorts(ctx.catalog[part.partId], part).find((port) => port.id === 'diverge');
    return sum + (diverge ? distance(diverge, center) : 0);
  }, 0);
}

function insertPassingLoops(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
  bubbles: number,
  minSize = 4,
): PlacedPart[] {
  let result = parts;
  const slices = pickPassingSlices(straightPairs(result, ctx.catalog), bubbles, ctx.random);
  for (const slice of slices) {
    if (slice.length < minSize) {
      continue;
    }
    const queue = switchQueue(inventory, result);
    if (queue.length < 2) {
      break;
    }
    const next = tryPassingLoop(result, slice, queue[0], queue[1], inventory, ctx, minSize);
    if (next) {
      result = next;
    }
  }
  return result;
}

function extendSwitchHead(
  parts: PlacedPart[],
  port: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
  extraIgnore: string[] = [],
  inward = true,
): { parts: PlacedPart[]; head: WorldPort } {
  const owner = ownerOf(port, parts);
  if (!owner || ctx.catalog[owner.partId]?.category !== 'switch' || port.id !== 'diverge') {
    return { parts, head: port };
  }
  if ((stockOf(inventory, parts)['curve-22'] ?? 0) <= 0) {
    return { parts, head: port };
  }
  const ignore = [...extraIgnore, owner.instanceId];
  const center = centroid(parts);
  const candidates: Array<{ parts: PlacedPart[]; head: WorldPort; radial: number }> = [];
  for (const portId of ['a', 'b'] as const) {
    const move = placeOnHead('curve-22', portId, port, parts, ctx, 'par', ignore);
    if (move) {
      candidates.push({
        parts: [...parts, move.part],
        head: move.head,
        radial: distance(move.head, center),
      });
    }
  }
  if (candidates.length === 0) {
    return { parts, head: port };
  }
  candidates.sort((a, b) => (inward ? a.radial - b.radial : b.radial - a.radial));
  return { parts: candidates[0].parts, head: candidates[0].head };
}

function outwardTurnOrder(
  start: WorldPort,
  parts: PlacedPart[],
  ctx: GenContext,
): Array<'a' | 'b'> {
  const center = centroid(parts);
  const left = placeOnHead('curve-22', 'a', start, parts, ctx, 'dir', [start.instanceId]);
  const right = placeOnHead('curve-22', 'b', start, parts, ctx, 'dir', [start.instanceId]);
  const leftDist = left ? distance(left.head, center) : -1;
  const rightDist = right ? distance(right.head, center) : -1;
  return leftDist >= rightDist ? ['a', 'b'] : ['b', 'a'];
}

function inwardTurnOrder(
  start: WorldPort,
  parts: PlacedPart[],
  ctx: GenContext,
): Array<'a' | 'b'> {
  const outward = outwardTurnOrder(start, parts, ctx);
  return outward[0] === 'a' ? ['b', 'a'] : ['a', 'b'];
}

function joinOpenPairs(
  parts: PlacedPart[],
  starts: WorldPort[],
  inventory: Record<string, number>,
  ctx: GenContext,
  prefix: string,
  preferRoomy = false,
  organicOnly = false,
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
      const inward = ctx.random() < 0.7;
      const leftover = stockOf(inventory, result);
      const generous =
        result.length >= 40 && (leftover['curve-22'] ?? 0) >= 12 && (leftover['straight-16'] ?? 0) >= 4;
      const startExt = generous
        ? { parts: result, head: liveStart }
        : extendSwitchHead(result, liveStart, inventory, ctx, [], inward);
      const targetExt = generous
        ? { parts: startExt.parts, head: liveTarget }
        : extendSwitchHead(startExt.parts, liveTarget, inventory, ctx, [], inward);
      const bias = inward ? 'inward' : ctx.random() < 0.5 ? 'mixed' : 'outward';
      const turns = inward
        ? inwardTurnOrder(startExt.head, targetExt.parts, ctx)
        : outwardTurnOrder(startExt.head, targetExt.parts, ctx);
      const next = organicOnly
        ? wanderJoin(targetExt.parts, startExt.head, targetExt.head, inventory, ctx, prefix, bias, 8)
        : (joinHeads(targetExt.parts, startExt.head, targetExt.head, inventory, ctx, prefix) ??
          wanderJoin(targetExt.parts, startExt.head, targetExt.head, inventory, ctx, prefix, bias) ??
          ovalJoin(targetExt.parts, startExt.head, targetExt.head, inventory, ctx, prefix, preferRoomy, turns));
      if (
        next &&
        targetClosed(next, ctx.catalog, targetExt.head) &&
        targetClosed(next, ctx.catalog, startExt.head) &&
        (result.length < LARGE_LAYOUT || organicOnly || next.length >= result.length + 6)
      ) {
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
    const center = centroid(without.length ? without : parts);
    const preferInward = ctx.random() < 0.65;
    let best: PlacedPart | null = null;
    let bestOut = preferInward ? Number.POSITIVE_INFINITY : -1;
    for (const xoPort of ['a', 'b', 'c', 'd']) {
      const placed = tryAttach(part, xoPort, attachOn, without, ctx.catalog, nextId(ctx, 'xo'), ignore, ctx.floorPlan);
      if (!placed) {
        continue;
      }
      const unused = worldPorts(ctx.catalog['double-crossover'], placed).filter((port) => port.id !== xoPort);
      const out = unused.reduce((sum, port) => sum + distance(port, center), 0);
      if (preferInward ? out <= bestOut : out >= bestOut) {
        best = placed;
        bestOut = out;
      }
    }
    if (best) {
      return [...without, best];
    }
  }
  if (parts.length === 0) {
    return seedCrossover(inventory, ctx, false) ?? parts;
  }
  return parts;
}

function seedCrossover(inventory: Record<string, number>, ctx: GenContext, roomy = false): PlacedPart[] | null {
  if ((inventory['double-crossover'] ?? 0) <= 0) {
    return null;
  }
  const origin = seedOrigin(ctx);
  const seeded: PlacedPart = {
    instanceId: nextId(ctx, 'xo'),
    partId: 'double-crossover',
    label: 1,
    x: origin.x,
    y: origin.y,
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
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  const firstStock = roomy
    ? {
        ...inventory,
        'curve-22': Math.max(16, Math.floor(curves * 0.5)),
        'straight-16': Math.max(4, Math.floor(straights * 0.5)),
      }
    : inventory;
  const first =
    wanderJoin([seeded], a, b, firstStock, ctx, 'xo', 'mixed') ??
    ovalJoin([seeded], a, b, firstStock, ctx, 'xo', roomy);
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
  return (
    wanderJoin(first, liveC, liveD, inventory, ctx, 'xo', 'inward') ??
    ovalJoin(first, liveC, liveD, inventory, ctx, 'xo', roomy) ??
    first
  );
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
    const placed = tryAttach(part, 'west', attachOn, without, ctx.catalog, nextId(ctx, 'cr'), [], ctx.floorPlan);
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
    const available = left['straight-16'] ?? 0;
    if (available < 3) {
      break;
    }
    const length = Math.min(PARK_SIDING, available);
    const parkStock = { ...inventory, 'curve-22': 0 };
    result = growDeadEnd(result, opens[0], parkStock, ctx, length, 'sid');
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
    const joined =
      wanderJoin(parts, liveStart, liveTarget, inventory, ctx, 'kel', 'mixed') ??
      ovalJoin(parts, liveStart, liveTarget, inventory, ctx, 'kel');
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
  const origin = seedOrigin(ctx);
  const seeded: PlacedPart = {
    instanceId: nextId(ctx, 'sw'),
    partId: queue[0],
    label: 1,
    x: origin.x,
    y: origin.y,
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
  return liveDiverge ? growDeadEnd(loop, liveDiverge, inventory, ctx, Math.min(PARK_SIDING, parkLength), 'sid') : loop;
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
  const origin = seedOrigin(ctx);
  const seeded: PlacedPart = {
    instanceId: nextId(ctx, 'rte'),
    partId: queue[0],
    label: 1,
    x: origin.x,
    y: origin.y,
    rotation: 0,
  };
  void roomyCore;
  const through = worldPorts(ctx.catalog[seeded.partId], seeded).find((port) => port.id === 'through');
  const stem = worldPorts(ctx.catalog[seeded.partId], seeded).find((port) => port.id === 'stem');
  if (!through || !stem) {
    return null;
  }
  const turnOrder: Array<'a' | 'b'> = seeded.partId === 'switch-left' ? ['b', 'a'] : ['a', 'b'];
  const loop = ovalJoin([seeded], through, stem, inventory, ctx, 'rte', false, turnOrder);
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
  const large = parts.length >= 16;
  if (large) {
    const before = parts;
    let result =
      parts.length >= 40 ? insertPassingLoops(parts, inventory, ctx, count, 8) : insertPassingLoops(parts, inventory, ctx, count);
    const placed = result.filter((part) => part.partId.startsWith('switch-')).length;
    const need = Math.max(0, count * 2 - placed);
    if (need === 0 && divergesOf(result, ctx.catalog).length === 0 && placed > 0) {
      return result;
    }
    if (parts.length >= 40 && need > 0 && ctx.deadline - Date.now() > 700) {
      result = insertSwitches(result, inventory, ctx, need, 'rte', false);
      const afterSwitches = result.length;
      result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', false, true);
      if (
        divergesOf(result, ctx.catalog).length === 0 &&
        result.filter((part) => part.partId.startsWith('switch-')).length >= count * 2 &&
        result.length - afterSwitches >= 8
      ) {
        return result;
      }
    }
    result = insertPassingLoops(parts, inventory, ctx, count);
    if (divergesOf(result, ctx.catalog).length === 0 && result.some((part) => part.partId.startsWith('switch-'))) {
      return result;
    }
    result = insertSwitches(parts, inventory, ctx, count * 2, 'rte', true);
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', false);
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', true);
    if (divergesOf(result, ctx.catalog).length === 0 && result.some((part) => part.partId.startsWith('switch-'))) {
      return result;
    }
    return before;
  }
  const seeded = seedDualRoute(inventory, ctx, roomyCore);
  if (seeded && divergesOf(seeded, ctx.catalog).length === 0) {
    return seeded;
  }
  let result = seeded ?? parts;
  const placed = result.filter((part) => part.partId.startsWith('switch-')).length;
  const stillNeed = Math.max(0, count * 2 - placed);
  if (stillNeed > 0) {
    result = insertSwitches(result, inventory, ctx, stillNeed, 'rte', true);
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', false);
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', true);
  } else if (divergesOf(result, ctx.catalog).length >= 2) {
    result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'rte', false);
  }
  void parking;
  return result;
}

function tryPlaceCrossover(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] {
  const before = parts;
  let result = insertCrossover(parts, inventory, ctx);
  if (!result.some((part) => part.partId === 'double-crossover')) {
    return before;
  }
  const opens = specialOpens(result, ctx.catalog, 'double-crossover');
  if (opens.length >= 2) {
    if (result.length >= 40 && ctx.deadline - Date.now() > 500) {
      const bias = ctx.random() < 0.7 ? 'outward' : 'mixed';
      const walked = wanderJoin(result, opens[0], opens[1], inventory, ctx, 'xo', bias, 8);
      if (walked && specialOpens(walked, ctx.catalog, 'double-crossover').length === 0) {
        return walked;
      }
    }
    const oval =
      ovalJoin(result, opens[0], opens[1], inventory, ctx, 'xo', false) ??
      ovalJoin(result, opens[0], opens[1], inventory, ctx, 'xo', true);
    if (oval && specialOpens(oval, ctx.catalog, 'double-crossover').length === 0) {
      return oval;
    }
  }
  result = joinOpenPairs(result, specialOpens(result, ctx.catalog, 'double-crossover'), inventory, ctx, 'xo', false);
  return specialOpens(result, ctx.catalog, 'double-crossover').length > 0 ? before : result;
}

export function applyCrossover(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  plan: TopologyPlan,
  ctx: GenContext,
): PlacedPart[] {
  if (plan.crossovers > 0 && parts.length >= 32) {
    return tryPlaceCrossover(parts, inventory, ctx);
  }
  return parts;
}

export function applyRouteFeatures(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  plan: TopologyPlan,
  ctx: GenContext,
): PlacedPart[] {
  let result = parts;

  if (plan.dualRoutes > 0) {
    result = placeDualRoutes(result, inventory, ctx, plan.dualRoutes, plan.parking === 0, plan.parking);
  }

  if (
    plan.crossovers > 0 &&
    !result.some((part) => part.partId === 'double-crossover') &&
    openPorts(result, ctx.catalog).length <= plan.parking
  ) {
    result = tryPlaceCrossover(result, inventory, ctx);
    if (!result.some((part) => part.partId === 'double-crossover') && result.length < 16) {
      const roomy = (inventory['curve-22'] ?? 0) >= 40 && (inventory['straight-16'] ?? 0) >= 20;
      const seeded = seedCrossover(inventory, ctx, roomy);
      if (seeded) {
        result = seeded;
      }
    }
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

function lengthenShortBypasses(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] {
  if (parts.length < 40) {
    return parts;
  }
  let result = parts;
  const switches = result.filter((part) => part.partId.startsWith('switch-'));
  for (let i = 0; i < switches.length; i += 1) {
    for (let j = i + 1; j < switches.length; j += 1) {
      const path = shortDivergePath(result, switches[i].instanceId, switches[j].instanceId, ctx);
      if (!path || path.length === 0 || path.length - 1 > 4) {
        continue;
      }
      const remove = new Set(
        path.filter((id) =>
          ['rte', 'par', 'xo', 'kel', 'det', 'inf'].some((prefix) => id.startsWith(prefix)),
        ),
      );
      if (remove.size === 0) {
        continue;
      }
      const without = result.filter((part) => !remove.has(part.instanceId));
      const opens = divergesOf(without, ctx.catalog).filter(
        (port) => port.instanceId === switches[i].instanceId || port.instanceId === switches[j].instanceId,
      );
      if (opens.length >= 2) {
        const joined = uTurnJoin(without, opens[0], opens[1], inventory, ctx);
        if (
          joined &&
          joined.length >= without.length + 6 &&
          targetClosed(joined, ctx.catalog, opens[0]) &&
          targetClosed(joined, ctx.catalog, opens[1]) &&
          compactPairCount(joined, ctx) < compactPairCount(result, ctx)
        ) {
          result = joined;
          continue;
        }
      }
      const relocated = relocateCompactPair(
        result,
        switches[i].instanceId,
        switches[j].instanceId,
        remove,
        inventory,
        ctx,
      );
      if (relocated) {
        result = relocated;
      }
    }
  }
  return result;
}

function compactPairCount(parts: PlacedPart[], ctx: GenContext): number {
  const switches = parts.filter((part) => part.partId.startsWith('switch-'));
  let count = 0;
  for (let i = 0; i < switches.length; i += 1) {
    for (let j = i + 1; j < switches.length; j += 1) {
      const path = shortDivergePath(parts, switches[i].instanceId, switches[j].instanceId, ctx);
      if (path && path.length > 0 && path.length - 1 <= 4) {
        count += 1;
      }
    }
  }
  return count;
}

function circuitClosed(parts: PlacedPart[], catalog: GenContext['catalog']): boolean {
  return openPorts(parts, catalog).every((port) => port.instanceId.startsWith('sid'));
}

function uTurnJoin(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const left = stockOf(inventory, parts);
  const curves = left['curve-22'] ?? 0;
  const straights = left['straight-16'] ?? 0;
  if (curves < 8) {
    return null;
  }
  const ignore = [target.instanceId, start.instanceId];
  const seeds: Array<{ partId: string; portId: string }> = [
    ...(straights > 0 ? [{ partId: 'straight-16', portId: 'a' }] : []),
    { partId: 'curve-22', portId: 'a' },
    { partId: 'curve-22', portId: 'b' },
  ];
  for (const seed of seeds) {
    const move = placeOnHead(seed.partId, seed.portId, start, parts, ctx, 'rte', ignore);
    if (!move || portsConnect(move.head, target)) {
      continue;
    }
    const grown = [...parts, move.part];
    const restStraights = straights - (seed.partId === 'straight-16' ? 1 : 0);
    const restCurves = curves - (seed.partId === 'curve-22' ? 1 : 0);
    if (restCurves < 8) {
      continue;
    }
    for (const turn of ['a', 'b'] as const) {
      for (let end = 0; end <= Math.min(6, restStraights); end += 1) {
        const sequence: Array<{ partId: string; portId?: string }> = [];
        for (let i = 0; i < 4; i += 1) {
          sequence.push({ partId: 'curve-22', portId: turn });
        }
        for (let i = 0; i < end; i += 1) {
          sequence.push({ partId: 'straight-16' });
        }
        for (let i = 0; i < 4; i += 1) {
          sequence.push({ partId: 'curve-22', portId: turn });
        }
        const built = attachSequenceFrom(grown, move.head, sequence, target, ctx, 'rte');
        if (built && built.length >= parts.length + 6) {
          return built;
        }
      }
    }
  }
  return null;
}

function fillSwitchWithStraights(
  remaining: PlacedPart[],
  sw: PlacedPart,
  original: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  if ((stockOf(inventory, remaining)['straight-16'] ?? 0) < 2) {
    return null;
  }
  const throughIds = new Set(['stem', 'through']);
  const neighbors: WorldPort[] = [];
  for (const connection of detectConnections(original, ctx.catalog)) {
    const fromSwitch = connection.fromInstanceId === sw.instanceId && throughIds.has(connection.fromPortId);
    const toSwitch = connection.toInstanceId === sw.instanceId && throughIds.has(connection.toPortId);
    if (!fromSwitch && !toSwitch) {
      continue;
    }
    const otherId = fromSwitch ? connection.toInstanceId : connection.fromInstanceId;
    const otherPort = fromSwitch ? connection.toPortId : connection.fromPortId;
    const other = remaining.find((part) => part.instanceId === otherId);
    if (!other) {
      continue;
    }
    const port = worldPorts(ctx.catalog[other.partId], other).find((item) => item.id === otherPort);
    if (port) {
      neighbors.push(port);
    }
  }
  if (neighbors.length >= 2) {
    const built = attachSequenceFrom(
      remaining,
      neighbors[0],
      [{ partId: 'straight-16' }, { partId: 'straight-16' }],
      neighbors[1],
      ctx,
      'p',
    );
    if (built) {
      return built;
    }
  }
  const offset = rotatePoint({ x: 16, y: 0 }, sw.rotation);
  const first: PlacedPart = {
    instanceId: nextId(ctx, 'p'),
    partId: 'straight-16',
    label: 1,
    x: sw.x,
    y: sw.y,
    rotation: sw.rotation,
  };
  const second: PlacedPart = {
    ...first,
    instanceId: nextId(ctx, 'p'),
    x: sw.x + offset.x,
    y: sw.y + offset.y,
  };
  const ignore = neighborsOf(sw.instanceId, original, ctx.catalog);
  if (
    placementCollides(first, remaining, ctx.catalog, ignore) ||
    placementCollides(second, [...remaining, first], ctx.catalog, ignore)
  ) {
    return null;
  }
  return [...remaining, first, second];
}

function throughOuterPorts(
  original: PlacedPart[],
  switchIds: Set<string>,
  remaining: PlacedPart[],
  ctx: GenContext,
): WorldPort[] {
  const throughIds = new Set(['stem', 'through']);
  const remainingIds = new Set(remaining.map((part) => part.instanceId));
  const ports: WorldPort[] = [];
  for (const connection of detectConnections(original, ctx.catalog)) {
    const fromSwitch = switchIds.has(connection.fromInstanceId) && throughIds.has(connection.fromPortId);
    const toSwitch = switchIds.has(connection.toInstanceId) && throughIds.has(connection.toPortId);
    if (!fromSwitch && !toSwitch) {
      continue;
    }
    const otherId = fromSwitch ? connection.toInstanceId : connection.fromInstanceId;
    if (switchIds.has(otherId) || !remainingIds.has(otherId)) {
      continue;
    }
    const otherPort = fromSwitch ? connection.toPortId : connection.fromPortId;
    const other = remaining.find((part) => part.instanceId === otherId);
    const port = other
      ? worldPorts(ctx.catalog[other.partId], other).find((item) => item.id === otherPort)
      : null;
    if (port && !ports.some((item) => item.instanceId === port.instanceId && item.id === port.id)) {
      ports.push(port);
    }
  }
  return ports;
}

function restoreSwitchRun(
  remaining: PlacedPart[],
  first: PlacedPart,
  second: PlacedPart,
  original: PlacedPart[],
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const switchIds = new Set([first.instanceId, second.instanceId]);
  const outers = throughOuterPorts(original, switchIds, remaining, ctx);
  if (outers.length >= 2) {
    const maxS = Math.min(6, stockOf(inventory, remaining)['straight-16'] ?? 0);
    for (let n = 2; n <= maxS; n += 1) {
      const built = attachSequenceFrom(
        remaining,
        outers[0],
        Array.from({ length: n }, () => ({ partId: 'straight-16' })),
        outers[1],
        ctx,
        'p',
      );
      if (built && circuitClosed(built, ctx.catalog)) {
        return built;
      }
    }
  }
  let filled = fillSwitchWithStraights(remaining, first, original, inventory, ctx);
  if (!filled) {
    return null;
  }
  filled = fillSwitchWithStraights(filled, second, original, inventory, ctx);
  return filled && circuitClosed(filled, ctx.catalog) ? filled : null;
}

function relocateCompactPair(
  parts: PlacedPart[],
  firstId: string,
  secondId: string,
  remove: Set<string>,
  inventory: Record<string, number>,
  ctx: GenContext,
): PlacedPart[] | null {
  const first = parts.find((part) => part.instanceId === firstId);
  const second = parts.find((part) => part.instanceId === secondId);
  if (!first || !second) {
    return null;
  }
  const switchCount = parts.filter((part) => part.partId.startsWith('switch-')).length;
  const without = parts.filter(
    (part) => !remove.has(part.instanceId) && part.instanceId !== firstId && part.instanceId !== secondId,
  );
  const restored = restoreSwitchRun(without, first, second, parts, inventory, ctx);
  if (!restored) {
    return null;
  }
  const longPass = insertPassingLoops(restored, inventory, ctx, 1, 8);
  if (
    longPass.filter((part) => part.partId.startsWith('switch-')).length >= switchCount &&
    circuitClosed(longPass, ctx.catalog) &&
    compactPairCount(longPass, ctx) === 0
  ) {
    return longPass;
  }
  const spread = insertSwitches(restored, inventory, ctx, 2, 'rte', false);
  const diverges = divergesOf(spread, ctx.catalog);
  if (diverges.length < 2 || Date.now() > ctx.deadline - 400) {
    return null;
  }
  const walked =
    wanderJoin(spread, diverges[0], diverges[1], inventory, ctx, 'rte', 'outward', 8) ??
    wanderJoin(spread, diverges[0], diverges[1], inventory, ctx, 'rte', 'mixed', 8);
  if (
    walked &&
    walked.filter((part) => part.partId.startsWith('switch-')).length >= switchCount &&
    circuitClosed(walked, ctx.catalog) &&
    compactPairCount(walked, ctx) === 0
  ) {
    return walked;
  }
  return null;
}

function shortDivergePath(
  parts: PlacedPart[],
  firstId: string,
  secondId: string,
  ctx: GenContext,
): string[] | null {
  const connections = detectConnections(parts, ctx.catalog);
  const adj = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = adj.get(from) ?? [];
    if (!list.includes(to)) {
      list.push(to);
      adj.set(from, list);
    }
  };
  for (const connection of connections) {
    add(connection.fromInstanceId, connection.toInstanceId);
    add(connection.toInstanceId, connection.fromInstanceId);
  }
  const switchIds = new Set(
    parts.filter((part) => part.partId.startsWith('switch-')).map((part) => part.instanceId),
  );
  const neighbor = (instanceId: string): string | null => {
    for (const connection of connections) {
      if (connection.fromInstanceId === instanceId && connection.fromPortId === 'diverge') {
        return connection.toInstanceId;
      }
      if (connection.toInstanceId === instanceId && connection.toPortId === 'diverge') {
        return connection.fromInstanceId;
      }
    }
    return null;
  };
  const start = neighbor(firstId);
  const goal = neighbor(secondId);
  if (!start || !goal) {
    return null;
  }
  if (start === goal) {
    return [start];
  }
  const seen = new Set<string>([start, ...switchIds]);
  seen.delete(start);
  const parent = new Map<string, string>();
  let frontier = [start];
  let hops = 0;
  while (frontier.length && hops <= 4) {
    const next: string[] = [];
    for (const node of frontier) {
      if (node === goal) {
        const path = [goal];
        let cursor = goal;
        while (cursor !== start) {
          const prev = parent.get(cursor);
          if (!prev) {
            return null;
          }
          path.push(prev);
          cursor = prev;
        }
        path.reverse();
        return path;
      }
      for (const other of adj.get(node) ?? []) {
        if (seen.has(other) || switchIds.has(other)) {
          continue;
        }
        seen.add(other);
        parent.set(other, node);
        next.push(other);
      }
    }
    frontier = next;
    hops += 1;
  }
  return null;
}

export function applyFeatures(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  plan: TopologyPlan,
  ctx: GenContext,
): PlacedPart[] {
  return applyRouteFeatures(applyCrossover(parts, inventory, plan, ctx), inventory, plan, ctx);
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
  if (!hasParkingSiding(result, ctx) && result.length <= 28) {
    const seeded = seedFromSwitch(inventory, ctx, PARK_SIDING);
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
    result = joinOpenPairs(result, specialOpens(result, ctx.catalog, 'double-crossover'), inventory, ctx, 'xo', false);
    if (specialOpens(result, ctx.catalog, 'double-crossover').length > 0) {
      result = before;
    }
  }
  if ((left['crossing-90'] ?? 0) > 0 && !result.some((part) => part.partId === 'crossing-90')) {
    result = insertCrossing(result, inventory, ctx);
    result = joinOpenPairs(result, specialOpens(result, ctx.catalog, 'crossing'), inventory, ctx, 'cr', true);
  }
  const switchesLeft = switchQueue(inventory, result);
  const placedSwitches = result.filter((part) => part.partId.startsWith('switch-')).length;
  if (switchesLeft.length >= 2 && (parking === 0 || placedSwitches < 2)) {
    const before = result;
    result = insertPassingLoops(result, inventory, ctx, 1);
    if (divergesOf(result, ctx.catalog).length > 0) {
      const openBefore = divergesOf(before, ctx.catalog).length;
      result = insertSwitches(before, inventory, ctx, 2, 'sw', true);
      result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'sw', false);
      result = joinOpenPairs(result, divergesOf(result, ctx.catalog), inventory, ctx, 'sw', true);
      if (divergesOf(result, ctx.catalog).length > openBefore) {
        result = before;
      }
    }
  }
  return lengthenShortBypasses(result, inventory, ctx);
}
