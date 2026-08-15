import { analyzeLayout, preferenceNotes } from '../layout-analysis/analyze';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import {
  DEFAULT_PREFERENCES,
  GenerationPreferences,
  PlacedPart,
  TrackLayout,
  TrackPart,
} from '../../shared/models/track';
import { placementCollides } from './collide';
import { detectConnections, remainingInventory, unusedItems } from './connections';
import { closeWithFlex } from './flex-closer';
import {
  attachPart,
  CURVE_ANGLE,
  distance,
  headingDelta,
  normalizeHeading,
  portsConnect,
  rotatePoint,
  SWITCH_LENGTH,
  WorldPort,
  worldPorts,
} from './geometry';
import { openPorts } from './connections';

export interface GenerateOptions {
  seed?: number;
  timeoutMs?: number;
}

const RIGID_ORDER = [
  'straight-16',
  'curve-22',
  'switch-left',
  'switch-right',
  'crossing-90',
  'double-crossover',
];

const PARK_STRAIGHTS = 5;
const MAX_CURVE_RUN = 6;

interface SeqItem {
  partId: string;
  portId?: string;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function inventoryMap(items: { partId: string; quantity: number }[]): Record<string, number> {
  return Object.fromEntries(items.map((item) => [item.partId, item.quantity]));
}

function unusedRigidCount(layout: TrackLayout): number {
  return layout.unusedInventory
    .filter((item) => item.partId !== 'flex-track')
    .reduce((sum, item) => sum + item.quantity, 0);
}

function unusedSpecialCount(layout: TrackLayout): number {
  return layout.unusedInventory
    .filter((item) =>
      ['switch-left', 'switch-right', 'crossing-90', 'double-crossover'].includes(item.partId),
    )
    .reduce((sum, item) => sum + item.quantity, 0);
}

function scoreLayout(layout: TrackLayout, prefs: GenerationPreferences): number {
  const parkingDelta = Math.abs(layout.parkingSpots.length - prefs.targetParkingSpots);
  const reverse = prefs.preferReversingRoute ? layout.reverseOptions.length * 8 : 0;
  const pieces = prefs.preferMorePieces ? layout.parts.length * 2 : 0;
  const compact = prefs.compact ? layout.score.compactness * 10 : 0;
  const spread =
    prefs.compact || layout.score.routeBonus === 0
      ? 0
      : Math.min(18, 1 / Math.max(layout.score.compactness, 0.08));
  const loop = layout.score.routeBonus * 16;
  const specials = layout.score.specialsBonus * 8;
  const unused = unusedRigidCount(layout) * 4 + unusedSpecialCount(layout) * 12;
  const parkLength = (layout.parkingSpots.reduce((sum, spot) => sum + spot.clearLengthStuds, 0) / 16) * 3;
  const longPark = layout.parkingSpots.filter((spot) => spot.clearLengthStuds >= PARK_STRAIGHTS * 16).length * 20;
  return (
    40 -
    parkingDelta * 10 +
    reverse +
    pieces +
    compact +
    spread +
    loop +
    specials +
    parkLength +
    longPark -
    unused -
    layout.score.unfinishedPenalty * 3 -
    layout.score.flexPenalty * 6
  );
}

function finalize(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  prefs: GenerationPreferences,
  message?: string,
): TrackLayout {
  const catalog = CITY_TRACKS_BY_ID;
  const allowFlex = prefs.allowFlexCloses && (inventory['curve-22'] ?? 0) !== 15;
  const withFlex = closeWithFlex(parts, catalog, remainingInventory(inventory, parts), allowFlex);
  const labeled = withFlex.map((part, index) => ({ ...part, label: index + 1 }));
  const layout = analyzeLayout(labeled, catalog, unusedItems(inventory, labeled), message);
  layout.notes = preferenceNotes(layout, prefs, inventory);
  if (layout.notes.length) {
    layout.message = layout.notes.join(' ');
  }
  layout.score.total = scoreLayout(layout, prefs);
  return layout;
}

function neighborsOf(
  instanceId: string,
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
): string[] {
  return detectConnections(parts, catalog)
    .filter((connection) => connection.fromInstanceId === instanceId || connection.toInstanceId === instanceId)
    .map((connection) =>
      connection.fromInstanceId === instanceId ? connection.toInstanceId : connection.fromInstanceId,
    );
}

function tryAttach(
  part: TrackPart,
  localPortId: string,
  target: WorldPort,
  existing: PlacedPart[],
  catalog: Record<string, TrackPart>,
  instanceId: string,
  label: number,
  extraIgnore: string[] = [],
): PlacedPart | null {
  const pose = attachPart(part, localPortId, target);
  const candidate: PlacedPart = { instanceId, partId: part.id, label, ...pose };
  const ignore = [target.instanceId, ...neighborsOf(target.instanceId, existing, catalog), ...extraIgnore];
  if (placementCollides(candidate, existing, catalog, ignore)) {
    return null;
  }
  return candidate;
}

function ownerOf(port: WorldPort, parts: PlacedPart[]): PlacedPart | undefined {
  return parts.find((item) => item.instanceId === port.instanceId);
}

function isSwitchPort(port: WorldPort, parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  const owner = ownerOf(port, parts);
  return !!owner && catalog[owner.partId].category === 'switch';
}

function isCrossoverPort(port: WorldPort, parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  const owner = ownerOf(port, parts);
  return !!owner && catalog[owner.partId].category === 'double-crossover';
}

function splitInt(total: number, buckets: number, random: () => number, min = 0): number[] {
  if (buckets <= 0) {
    return [];
  }
  const usedMin = Math.min(min, Math.floor(total / buckets));
  const values = Array.from({ length: buckets }, () => usedMin);
  let left = total - usedMin * buckets;
  while (left > 0) {
    values[Math.floor(random() * buckets)] += 1;
    left -= 1;
  }
  return values;
}

function rectangleSides(straights: number, spread: boolean, neededRun: number): number[] {
  const n = Math.max(0, straights - (straights % 2));
  let long = spread && n >= 8 ? Math.floor(n * 0.4) : Math.floor(n / 4);
  let short = n / 2 - long;
  if (short < 0) {
    long = n / 2;
    short = 0;
  }
  if (neededRun > 0 && long < neededRun && n >= neededRun * 2) {
    long = Math.min(neededRun, n / 2);
    short = n / 2 - long;
  }
  return [long, short, long, short];
}

function sidesToSequence(sides: number[], curvesPerCorner = 4): SeqItem[] {
  const sequence: SeqItem[] = [];
  for (const count of sides) {
    for (let i = 0; i < count; i += 1) {
      sequence.push({ partId: 'straight-16' });
    }
    for (let i = 0; i < curvesPerCorner; i += 1) {
      sequence.push({ partId: 'curve-22' });
    }
  }
  return sequence;
}

function freePort(
  part: PlacedPart,
  catalog: Record<string, TrackPart>,
  usedPortId: string,
): WorldPort | null {
  return worldPorts(catalog[part.partId], part).find((port) => port.id !== usedPortId) ?? null;
}

function buildSequence(
  sequence: SeqItem[],
  catalog: Record<string, TrackPart>,
  requireClear = true,
): PlacedPart[] | null {
  if (sequence.length === 0) {
    return null;
  }
  const first = catalog[sequence[0].partId];
  const startPortId = sequence[0].portId ?? first.ports[0].id;
  const parts: PlacedPart[] = [
    { instanceId: 'p1', partId: first.id, label: 1, x: 0, y: 0, rotation: 0 },
  ];
  let head = freePort(parts[0], catalog, startPortId);
  for (let i = 1; i < sequence.length; i += 1) {
    if (!head) {
      return null;
    }
    const part = catalog[sequence[i].partId];
    const portId = sequence[i].portId ?? part.ports[0].id;
    const placed = requireClear
      ? tryAttach(part, portId, head, parts, catalog, `p${i + 1}`, i + 1)
      : { instanceId: `p${i + 1}`, partId: part.id, label: i + 1, ...attachPart(part, portId, head) };
    if (!placed) {
      return null;
    }
    parts.push(placed);
    head = freePort(placed, catalog, portId);
  }
  return parts;
}

function classicOvalSequence(straights: number): SeqItem[] {
  return sidesToSequence(rectangleSides(straights, false, 0));
}

function rectangleLoopSequence(straights: number, neededRun = 0, spread = false): SeqItem[] {
  return sidesToSequence(rectangleSides(straights, spread, neededRun));
}

function octagonSequence(straights: number): SeqItem[] | null {
  const n = Math.max(0, straights - (straights % 2));
  if (n < 8) {
    return null;
  }
  const base = Math.floor(n / 8);
  let rem = n - base * 8;
  const sides = Array.from({ length: 8 }, () => base);
  for (let pair = 0; rem >= 2 && pair < 4; pair += 1) {
    sides[pair] += 1;
    sides[pair + 4] += 1;
    rem -= 2;
  }
  return sidesToSequence(sides, 2);
}

function jogItems(leftFirst: boolean): SeqItem[] {
  const first = leftFirst ? 'a' : 'b';
  const second = leftFirst ? 'b' : 'a';
  return [
    { partId: 'curve-22', portId: first },
    { partId: 'curve-22', portId: first },
    { partId: 'curve-22', portId: second },
    { partId: 'curve-22', portId: second },
  ];
}

function wobbleItems(leftFirst: boolean): SeqItem[] {
  return [...jogItems(leftFirst), ...jogItems(!leftFirst)];
}

function wobbleRingSequence(
  straights: number,
  extraCurves: number,
  random: () => number,
  neededRun: number,
  spread: boolean,
): SeqItem[] {
  const sides = rectangleSides(straights, spread, neededRun);
  const fullPairs = Math.min(2, Math.floor(Math.max(0, extraCurves) / 16));
  const jogPairs = Math.min(2 - fullPairs, Math.floor(Math.max(0, extraCurves - fullPairs * 16) / 8));
  if (fullPairs === 0 && jogPairs === 0) {
    return sidesToSequence(sides);
  }
  const startLong = random() >= 0.35;
  const pairs: Array<{ sides: [number, number]; kind: 'wobble' | 'jog'; leftFirst: boolean }> = [];
  if (fullPairs >= 1) {
    pairs.push({ sides: startLong ? [0, 2] : [1, 3], kind: 'wobble', leftFirst: random() >= 0.5 });
  }
  if (fullPairs >= 2) {
    pairs.push({ sides: startLong ? [1, 3] : [0, 2], kind: 'wobble', leftFirst: random() >= 0.5 });
  }
  if (jogPairs >= 1) {
    const used = new Set(pairs.flatMap((pair) => pair.sides));
    const next: [number, number] = used.has(0) ? [1, 3] : [0, 2];
    pairs.push({ sides: next, kind: 'jog', leftFirst: random() >= 0.5 });
  }
  const extras = [0, 0, 0, 0].map(() => [] as SeqItem[][]);
  for (const pair of pairs) {
    const items = pair.kind === 'wobble' ? wobbleItems(pair.leftFirst) : jogItems(pair.leftFirst);
    extras[pair.sides[0]].push(items);
    extras[pair.sides[1]].push(items);
  }
  const sequence: SeqItem[] = [];
  for (let side = 0; side < 4; side += 1) {
    const bumps = extras[side];
    const count = sides[side];
    const chunk = bumps.length ? Math.floor(count / (bumps.length + 1)) : count;
    let placed = 0;
    for (const bump of bumps) {
      for (let i = 0; i < chunk; i += 1) {
        sequence.push({ partId: 'straight-16' });
        placed += 1;
      }
      sequence.push(...bump);
    }
    for (let i = placed; i < count; i += 1) {
      sequence.push({ partId: 'straight-16' });
    }
    for (let i = 0; i < 4; i += 1) {
      sequence.push({ partId: 'curve-22' });
    }
  }
  return sequence;
}

function loopCloses(parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  return openPorts(parts, catalog).length === 0;
}

function isBranchPort(port: WorldPort, parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  if (port.id === 'diverge') {
    return true;
  }
  return isCrossoverPort(port, parts, catalog) && port.id !== 'a' && port.id !== 'b';
}

function mainlineCloses(parts: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  return openPorts(parts, catalog).every((port) => isBranchPort(port, parts, catalog));
}

function collectRings(
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  random: () => number,
  reservedStraights: number,
  neededRun: number,
  spread = false,
): PlacedPart[][] {
  const curves = inventory['curve-22'] ?? 0;
  const reserved = Math.max(0, (inventory['straight-16'] ?? 0) - reservedStraights);
  const all = inventory['straight-16'] ?? 0;
  if (curves < 16) {
    return [];
  }
  const extra = curves - 16;
  const attempts: Array<SeqItem[] | null> = [
    wobbleRingSequence(reserved, extra, random, neededRun, spread),
    wobbleRingSequence(reserved, extra, random, neededRun, false),
    rectangleLoopSequence(reserved, neededRun, spread),
    octagonSequence(reserved),
    classicOvalSequence(reserved),
    wobbleRingSequence(all, extra, random, neededRun, spread),
  ];
  const rings: PlacedPart[][] = [];
  for (const sequence of attempts) {
    if (!sequence) {
      continue;
    }
    const parts = buildSequence(sequence, catalog, false);
    if (parts && loopCloses(parts, catalog)) {
      rings.push(parts);
    }
  }
  return rings;
}

function switchQueue(inventory: Record<string, number>): string[] {
  const queue: string[] = [];
  let left = inventory['switch-left'] ?? 0;
  let right = inventory['switch-right'] ?? 0;
  while (left > 0 || right > 0) {
    if (left > 0) {
      queue.push('switch-left');
      left -= 1;
    }
    if (right > 0) {
      queue.push('switch-right');
      right -= 1;
    }
  }
  return queue;
}

function straightRuns(parts: PlacedPart[]): Array<{ start: number; length: number }> {
  const n = parts.length;
  const runs: Array<{ start: number; length: number }> = [];
  let i = 0;
  while (i < n) {
    if (parts[i].partId !== 'straight-16') {
      i += 1;
      continue;
    }
    if (i === 0 && n > 1 && parts[n - 1].partId === 'straight-16') {
      i += 1;
      continue;
    }
    let length = 0;
    while (length < n && parts[(i + length) % n].partId === 'straight-16') {
      length += 1;
    }
    runs.push({ start: i, length });
    i += length;
  }
  if (runs.length === 0 && n >= 2 && parts.every((part) => part.partId === 'straight-16')) {
    runs.push({ start: 0, length: n });
  }
  return runs;
}

function insertSwitchesIntoLoop(
  parts: PlacedPart[],
  inventory: Record<string, number>,
): PlacedPart[] {
  const result = parts.map((part) => ({ ...part }));
  const queue = switchQueue(inventory);
  if (queue.length === 0) {
    return result;
  }
  const taken = new Set<number>();
  const picks: number[] = [];
  const takeAt = (index: number) => {
    const next = (index + 1) % result.length;
    if (
      result[index]?.partId === 'straight-16' &&
      result[next]?.partId === 'straight-16' &&
      !taken.has(index) &&
      !taken.has(next)
    ) {
      picks.push(index);
      taken.add(index);
      taken.add(next);
      return true;
    }
    return false;
  };
  const runs = straightRuns(result).sort((a, b) => b.length - a.length);
  for (const run of runs) {
    if (picks.length >= queue.length) {
      break;
    }
    if (queue.length - picks.length >= 2 && run.length >= 6) {
      takeAt(run.start + 1);
      takeAt(run.start + run.length - 3);
    } else if (run.length >= 2) {
      takeAt(run.start + Math.max(0, Math.floor(run.length / 2) - 1));
    }
  }
  if (picks.length === 0) {
    for (let i = 0; i < result.length && picks.length < queue.length; i += 1) {
      takeAt(i);
    }
  }
  const remove = new Set<number>();
  picks.slice(0, queue.length).forEach((target, index) => {
    result[target] = { ...result[target], partId: queue[index] };
    remove.add((target + 1) % result.length);
  });
  return result.filter((_, index) => !remove.has(index));
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

function centroidOf(parts: PlacedPart[]): { x: number; y: number } {
  if (parts.length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: parts.reduce((sum, part) => sum + part.x, 0) / parts.length,
    y: parts.reduce((sum, part) => sum + part.y, 0) / parts.length,
  };
}

function divergeDistance(part: PlacedPart, catalog: Record<string, TrackPart>, center: { x: number; y: number }): number {
  const diverge = worldPorts(catalog[part.partId], part).find((port) => port.id === 'diverge');
  return diverge ? distance(diverge, center) : 0;
}

function reorientSwitchesForSidings(
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
): PlacedPart[] {
  const center = centroidOf(parts);
  return parts.map((part) => {
    if (catalog[part.partId]?.category !== 'switch') {
      return part;
    }
    const flipped = flipSwitchInPlace(part);
    const trial = parts.map((item) => (item.instanceId === part.instanceId ? flipped : item));
    if (!mainlineCloses(trial, catalog)) {
      return part;
    }
    return divergeDistance(flipped, catalog, center) > divergeDistance(part, catalog, center) ? flipped : part;
  });
}

function insertCrossoverIntoLoop(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
): PlacedPart[] {
  if ((inventory['double-crossover'] ?? 0) < 1) {
    return parts;
  }
  const n = parts.length;
  const triples: Array<{ start: number; score: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const slot = [i, (i + 1) % n, (i + 2) % n];
    if (!slot.every((index) => parts[index].partId === 'straight-16')) {
      continue;
    }
    const prev = parts[(i - 1 + n) % n];
    const after = parts[(i + 3) % n];
    triples.push({
      start: i,
      score: (prev.partId === 'straight-16' ? 10 : 0) + (after.partId === 'straight-16' ? 10 : 0),
    });
  }
  triples.sort((a, b) => b.score - a.score);
  for (const triple of triples) {
    const slot = [triple.start, (triple.start + 1) % n, (triple.start + 2) % n];
    const drop = new Set(slot);
    const kept = parts.filter((_, index) => !drop.has(index));
    const before = parts[(triple.start - 1 + n) % n];
    const after = parts[(triple.start + 3) % n];
    const firstPorts = worldPorts(catalog[parts[triple.start].partId], parts[triple.start]);
    const lastPorts = worldPorts(catalog[parts[slot[2]].partId], parts[slot[2]]);
    const joints = [
      ...worldPorts(catalog[before.partId], before).filter((port) =>
        firstPorts.some((item) => portsConnect(port, item)),
      ),
      ...worldPorts(catalog[after.partId], after).filter((port) =>
        lastPorts.some((item) => portsConnect(port, item)),
      ),
    ];
    for (const joint of joints) {
      for (const xoPort of ['a', 'b', 'c', 'd']) {
        const pose = attachPart(catalog['double-crossover'], xoPort, joint);
        const placed: PlacedPart = {
          instanceId: `xo${parts.length + 1}`,
          partId: 'double-crossover',
          label: parts.length + 1,
          ...pose,
        };
        const next = [...kept, placed];
        if (mainlineCloses(next, catalog)) {
          return next;
        }
      }
    }
  }
  return parts;
}

function facePassingSwitches(
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
): PlacedPart[] {
  const switches = parts.filter((part) => catalog[part.partId]?.category === 'switch');
  const used = new Set<string>();
  let result = parts;
  for (const first of switches) {
    if (used.has(first.instanceId)) {
      continue;
    }
    const partner = switches.find(
      (item) =>
        item.instanceId !== first.instanceId &&
        !used.has(item.instanceId) &&
        headingDelta(first.rotation, item.rotation) < 25,
    );
    if (!partner) {
      continue;
    }
    used.add(first.instanceId);
    used.add(partner.instanceId);
    const flipped = flipSwitchInPlace(partner);
    const trial = result.map((part) => (part.instanceId === partner.instanceId ? flipped : part));
    if (!mainlineCloses(trial, catalog)) {
      continue;
    }
    const from = worldPorts(catalog[first.partId], first).find((port) => port.id === 'diverge');
    const before = worldPorts(catalog[partner.partId], partner).find((port) => port.id === 'diverge');
    const after = worldPorts(catalog[flipped.partId], flipped).find((port) => port.id === 'diverge');
    if (from && before && after && distance(from, after) <= distance(from, before)) {
      result = trial;
    }
  }
  return result;
}

function bestDivergePair(opens: WorldPort[]): [WorldPort, WorldPort] | null {
  let best: { a: WorldPort; b: WorldPort; score: number } | null = null;
  for (let i = 0; i < opens.length; i += 1) {
    for (let j = i + 1; j < opens.length; j += 1) {
      const opposite = headingDelta(opens[i].heading, opens[j].heading + 180);
      const score = distance(opens[i], opens[j]) + opposite * 0.4;
      if (!best || score < best.score) {
        best = { a: opens[i], b: opens[j], score };
      }
    }
  }
  return best ? [best.a, best.b] : null;
}

function switchOpens(parts: PlacedPart[], catalog: Record<string, TrackPart>): WorldPort[] {
  return openPorts(parts, catalog)
    .filter((port) => isSwitchPort(port, parts, catalog))
    .sort((a, b) => {
      const rank = (port: WorldPort) => (port.id === 'diverge' ? 2 : 1);
      return rank(b) - rank(a);
    });
}

function connectsToSameSwitch(
  free: WorldPort,
  start: WorldPort,
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
): boolean {
  const owner = ownerOf(start, parts);
  if (!owner || catalog[owner.partId].category !== 'switch') {
    return false;
  }
  return worldPorts(catalog[owner.partId], owner).some((port) => portsConnect(free, port));
}

function growToward(
  parts: PlacedPart[],
  start: WorldPort,
  target: WorldPort,
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
): PlacedPart[] {
  const result = [...parts];
  let current = start;
  let curveRun = 0;
  for (let step = 0; step < 36; step += 1) {
    if (portsConnect(current, target)) {
      return result;
    }
    const left = remainingInventory(inventory, result);
    const types = ['straight-16', 'curve-22'].filter((id) => (left[id] ?? 0) > 0);
    let best: { part: PlacedPart; free: WorldPort; score: number; curve: boolean } | null = null;
    for (const type of types) {
      if (type === 'curve-22' && curveRun >= MAX_CURVE_RUN) {
        continue;
      }
      const part = catalog[type];
      for (const local of part.ports) {
        const candidate = tryAttach(
          part,
          local.id,
          current,
          result,
          catalog,
          `ret${result.length + 1}`,
          result.length + 1,
          [target.instanceId],
        );
        if (!candidate) {
          continue;
        }
        const frees = worldPorts(part, candidate).filter((port) => port.id !== local.id);
        for (const free of frees) {
          if (connectsToSameSwitch(free, start, result, catalog)) {
            continue;
          }
          if (portsConnect(free, target)) {
            result.push(candidate);
            return result;
          }
          const score = distance(free, target) + headingDelta(free.heading, target.heading + 180) * 0.25;
          if (!best || score < best.score) {
            best = { part: candidate, free, score, curve: type === 'curve-22' };
          }
        }
      }
    }
    if (!best || best.score >= distance(current, target) + 24) {
      break;
    }
    result.push(best.part);
    current = best.free;
    curveRun = best.curve ? curveRun + 1 : 0;
  }
  return result;
}

function connectOpenDiverges(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
): PlacedPart[] {
  let result = parts;
  for (let step = 0; step < 3; step += 1) {
    const opens = switchOpens(result, catalog).filter((port) => port.id === 'diverge');
    if (opens.length < 2) {
      break;
    }
    const pair = bestDivergePair(opens);
    if (!pair) {
      break;
    }
    const next = growToward(result, pair[0], pair[1], inventory, catalog);
    const nextOpens = switchOpens(next, catalog).filter((port) => port.id === 'diverge').length;
    if (nextOpens < opens.length) {
      result = next;
      continue;
    }
    break;
  }
  return result;
}

function connectLeftoverBranches(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
): PlacedPart[] {
  let result = parts;
  const starts = switchOpens(result, catalog).filter((port) => port.id === 'diverge');
  for (const start of starts) {
    const targets = openPorts(result, catalog)
      .filter((port) => port.instanceId !== start.instanceId)
      .sort((a, b) => distance(start, a) - distance(start, b));
    if (targets.length === 0) {
      break;
    }
    const next = growToward(result, start, targets[0], inventory, catalog);
    if (openPorts(next, catalog).length < openPorts(result, catalog).length) {
      result = next;
    }
  }
  return result;
}

function addParkingSiding(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  length: number,
): PlacedPart[] {
  const opens = switchOpens(parts, catalog);
  if (opens.length === 0 || length <= 0) {
    return parts;
  }
  const result = [...parts];
  let current = opens[0];
  const straight = catalog['straight-16'];
  for (let i = 0; i < length; i += 1) {
    const left = remainingInventory(inventory, result);
    if ((left['straight-16'] ?? 0) <= 0) {
      break;
    }
    const placed = tryAttach(
      straight,
      'a',
      current,
      result,
      catalog,
      `sid${result.length + 1}`,
      result.length + 1,
    );
    if (!placed) {
      break;
    }
    const free = worldPorts(straight, placed).find((port) => port.id === 'b');
    const joinsLoop =
      !!free &&
      openPorts(result, catalog).some(
        (port) => port.instanceId !== current.instanceId && portsConnect(free, port),
      );
    if (joinsLoop) {
      break;
    }
    result.push(placed);
    current = free ?? current;
  }
  return result;
}

function addParkingSidings(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  count: number,
): PlacedPart[] {
  let result = parts;
  for (let i = 0; i < count; i += 1) {
    const left = remainingInventory(inventory, result);
    const available = left['straight-16'] ?? 0;
    if (available <= 0 || switchOpens(result, catalog).length === 0) {
      break;
    }
    const length = Math.min(available, i === count - 1 ? Math.max(PARK_STRAIGHTS, Math.min(6, available)) : PARK_STRAIGHTS);
    result = addParkingSiding(result, inventory, catalog, Math.max(1, length));
  }
  return result;
}

function extendCrossoverParallels(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  keepStraights = 0,
): PlacedPart[] {
  if (!parts.some((part) => catalog[part.partId].category === 'double-crossover')) {
    return parts;
  }
  const result = [...parts];
  const straight = catalog['straight-16'];
  let progress = true;
  while (progress) {
    progress = false;
    const opens = openPorts(result, catalog).filter(
      (port) => isCrossoverPort(port, result, catalog) || ownerOf(port, result)?.partId === 'straight-16',
    );
    for (const open of opens) {
      const left = remainingInventory(inventory, result);
      if ((left['straight-16'] ?? 0) <= keepStraights) {
        return result;
      }
      const ignore = result
        .filter((part) => catalog[part.partId].category === 'double-crossover')
        .map((part) => part.instanceId);
      let placed: PlacedPart | null = null;
      for (const portId of ['a', 'b']) {
        placed = tryAttach(
          straight,
          portId,
          open,
          result,
          catalog,
          `xo${result.length + 1}`,
          result.length + 1,
          ignore,
        );
        if (placed) {
          break;
        }
      }
      if (placed) {
        result.push(placed);
        progress = true;
      }
    }
  }
  return result;
}

function parallelFromCrossover(
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
): PlacedPart[] | null {
  if ((inventory['double-crossover'] ?? 0) < 1 || (inventory['straight-16'] ?? 0) < 2) {
    return null;
  }
  const start: PlacedPart[] = [
    { instanceId: 'dc1', partId: 'double-crossover', label: 1, x: 0, y: 0, rotation: 0 },
  ];
  return extendCrossoverParallels(start, inventory, catalog);
}

function pointToPointSequence(inventory: Record<string, number>, random: () => number): SeqItem[] | null {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  if (curves + straights < 2) {
    return null;
  }
  const sequence: SeqItem[] = [];
  const curveGroups = Math.max(1, 2 + Math.floor(random() * 3));
  const straightGroups = splitInt(straights, curveGroups, random, 0);
  const curvesPer = splitInt(curves, curveGroups, random, 0);
  for (let i = 0; i < curveGroups; i += 1) {
    for (let s = 0; s < straightGroups[i]; s += 1) {
      sequence.push({ partId: 'straight-16' });
    }
    for (let c = 0; c < curvesPer[i]; c += 1) {
      sequence.push({ partId: 'curve-22' });
    }
  }
  return sequence.length ? sequence : null;
}

function headingSteps(from: number, to: number): number {
  let delta = normalizeHeading(to - from);
  if (delta > 180) {
    delta -= 360;
  }
  return Math.round(delta / CURVE_ANGLE);
}

function homeScore(head: WorldPort, goal: WorldPort): number {
  const dist = distance(head, goal);
  const face = headingDelta(head.heading, goal.heading + 180);
  if (dist > 36) {
    const bear = (Math.atan2(goal.y - head.y, goal.x - head.x) * 180) / Math.PI;
    return dist + headingDelta(head.heading, bear) * 0.7;
  }
  return dist + face * 0.9;
}

function placeOnHead(
  partId: string,
  portId: string,
  head: WorldPort,
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
  ignoreStart: boolean,
): { part: PlacedPart; head: WorldPort } | null {
  const ignore = ignoreStart && parts[0] ? [parts[0].instanceId] : [];
  const placed = tryAttach(
    catalog[partId],
    portId,
    head,
    parts,
    catalog,
    `w${parts.length + 1}`,
    parts.length + 1,
    ignore,
  );
  if (!placed) {
    return null;
  }
  const next = freePort(placed, catalog, portId);
  return next ? { part: placed, head: next } : null;
}

function wanderHomeLoop(
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  random: () => number,
  deadline: number,
): PlacedPart[] | null {
  const curves = inventory['curve-22'] ?? 0;
  const straights = inventory['straight-16'] ?? 0;
  if (curves < 16) {
    return null;
  }
  const startId = straights > 0 ? 'straight-16' : 'curve-22';
  const start: PlacedPart = { instanceId: 'w1', partId: startId, label: 1, x: 0, y: 0, rotation: 0 };
  const goal = worldPorts(catalog[startId], start).find((port) => port.id === 'a');
  const firstHead = freePort(start, catalog, 'a');
  if (!goal || !firstHead) {
    return null;
  }

  let parts = [start];
  let head = firstHead;
  const wandered = [false];
  const heads = [head];
  let backtracks = 0;
  const maxParts = Math.min(120, 2 + straights + curves);

  const restore = () => {
    if (parts.length <= 1) {
      return false;
    }
    let popped = 0;
    while (parts.length > 1 && popped < 4) {
      const wasWander = wandered.pop();
      parts.pop();
      heads.pop();
      popped += 1;
      if (wasWander || popped >= 2) {
        break;
      }
    }
    head = heads[heads.length - 1];
    backtracks += 1;
    return true;
  };

  const commit = (move: { part: PlacedPart; head: WorldPort }, wander: boolean) => {
    parts = [...parts, move.part];
    head = move.head;
    wandered.push(wander);
    heads.push(head);
  };

  for (let step = 0; step < 420 && Date.now() < deadline; step += 1) {
    if (portsConnect(head, goal) && parts.length >= 8) {
      return parts;
    }
    if (backtracks > 90 || parts.length > maxParts) {
      break;
    }
    const left = remainingInventory(inventory, parts);
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
    const mustHome = curvesLeft <= minTurns + 2 || dist < 32 || parts.length > maxParts - 8;
    const wanderP = mustHome ? 0 : 0.4 * Math.min(1, (curvesLeft - minTurns) / 10);
    const wander = random() < wanderP;
    const near = dist < 28;
    const options: Array<{ partId: string; portId: string }> = [];
    if (straightLeft > 0) {
      options.push({ partId: 'straight-16', portId: 'a' });
    }
    if (curvesLeft > 0) {
      options.push({ partId: 'curve-22', portId: 'a' }, { partId: 'curve-22', portId: 'b' });
    }
    if (options.length === 0) {
      if (!restore()) {
        break;
      }
      continue;
    }
    let chosen: { part: PlacedPart; head: WorldPort } | null = null;
    if (wander && curvesLeft >= 4 && random() < 0.28) {
      const leftFirst = random() >= 0.5;
      const jog = leftFirst ? (['a', 'a', 'b', 'b'] as const) : (['b', 'b', 'a', 'a'] as const);
      let trail = parts;
      let tip = head;
      const chunk: Array<{ part: PlacedPart; head: WorldPort }> = [];
      let ok = true;
      for (const portId of jog) {
        const move = placeOnHead('curve-22', portId, tip, trail, catalog, false);
        if (!move) {
          ok = false;
          break;
        }
        chunk.push(move);
        trail = [...trail, move.part];
        tip = move.head;
      }
      if (ok && homeScore(tip, goal) <= homeScore(head, goal) + 40) {
        for (const move of chunk) {
          commit(move, true);
        }
        continue;
      }
    }
    if (wander) {
      const pick = options[Math.floor(random() * options.length)];
      chosen = placeOnHead(pick.partId, pick.portId, head, parts, catalog, near);
      if (chosen && homeScore(chosen.head, goal) > homeScore(head, goal) + 36) {
        chosen = null;
      }
    } else {
      let best: { move: { part: PlacedPart; head: WorldPort }; score: number } | null = null;
      for (const option of options) {
        const move = placeOnHead(option.partId, option.portId, head, parts, catalog, near);
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
  return portsConnect(head, goal) && parts.length >= 8 ? parts : null;
}

function decorateLoop(
  parts: PlacedPart[],
  inventory: Record<string, number>,
  catalog: Record<string, TrackPart>,
  prefs: GenerationPreferences,
): PlacedPart[] {
  let result = insertCrossoverIntoLoop(parts, inventory, catalog);
  result = facePassingSwitches(
    reorientSwitchesForSidings(insertSwitchesIntoLoop(result, inventory), catalog),
    catalog,
  );
  const keep = prefs.targetParkingSpots * PARK_STRAIGHTS + 8;
  result = extendCrossoverParallels(result, inventory, catalog, keep);
  result = connectOpenDiverges(result, inventory, catalog);
  if (prefs.preferReversingRoute) {
    result = connectLeftoverBranches(result, inventory, catalog);
  }
  if (prefs.targetParkingSpots > 0) {
    result = addParkingSidings(result, inventory, catalog, prefs.targetParkingSpots);
  }
  return result;
}

function search(
  inventory: Record<string, number>,
  _prefs: GenerationPreferences,
  random: () => number,
  deadline: number,
  startParts?: PlacedPart[],
): PlacedPart[] {
  const catalog = CITY_TRACKS_BY_ID;
  const seedId = RIGID_ORDER.find((id) => (inventory[id] ?? 0) > 0 && catalog[id].ports.length >= 1);
  const start: PlacedPart[] =
    startParts && startParts.length
      ? startParts
      : seedId
        ? [{ instanceId: 'p1', partId: seedId, label: 1, x: 0, y: 0, rotation: 0 }]
        : [];
  if (start.length === 0) {
    return [];
  }
  let best = start;

  const visit = (parts: PlacedPart[], curveRun: number) => {
    if (Date.now() > deadline) {
      return;
    }
    if (parts.length > best.length) {
      best = parts;
    }
    const left = remainingInventory(inventory, parts);
    const opens = openPorts(parts, catalog);
    if (opens.length === 0 || parts.length > 48) {
      return;
    }

    const types = RIGID_ORDER.filter((id) => (left[id] ?? 0) > 0).sort((a, b) => {
      if (a === 'straight-16') {
        return -1;
      }
      if (b === 'straight-16') {
        return 1;
      }
      return random() - 0.5;
    });
    const switchOpen = opens.filter((port) => isSwitchPort(port, parts, catalog));
    const otherOpens = opens
      .filter((port) => !isSwitchPort(port, parts, catalog))
      .sort(() => random() - 0.5)
      .slice(0, 2);
    const ports = [...switchOpen, ...otherOpens];
    let attempts = 0;
    for (const open of ports) {
      for (const type of types) {
        if (type === 'curve-22' && (curveRun >= MAX_CURVE_RUN || open.id === 'diverge')) {
          continue;
        }
        const part = catalog[type];
        for (const local of part.ports) {
          if (Date.now() > deadline || attempts > 18) {
            return;
          }
          attempts += 1;
          const candidate = tryAttach(
            part,
            local.id,
            open,
            parts,
            catalog,
            `p${parts.length + 1}`,
            parts.length + 1,
          );
          if (candidate) {
            const nextRun = type === 'curve-22' ? curveRun + 1 : 0;
            visit([...parts, candidate], nextRun);
          }
        }
      }
    }
  };

  visit(start, 0);
  return best;
}

function reservedStraightsFor(inventory: Record<string, number>, prefs: GenerationPreferences): number {
  const switches = (inventory['switch-left'] ?? 0) + (inventory['switch-right'] ?? 0);
  const parking = prefs.targetParkingSpots * PARK_STRAIGHTS;
  const returning = switches >= 2 && prefs.targetParkingSpots < 2 ? 4 : 0;
  const crossover = (inventory['double-crossover'] ?? 0) > 0 ? 4 : 0;
  const neededOnLoop = switches * 2 + ((inventory['double-crossover'] ?? 0) > 0 ? 3 : 0);
  const available = inventory['straight-16'] ?? 0;
  return Math.min(parking + returning + crossover, Math.max(0, available - neededOnLoop));
}

export function generateLayout(
  items: { partId: string; quantity: number }[],
  prefs: GenerationPreferences = DEFAULT_PREFERENCES,
  options: GenerateOptions = {},
): TrackLayout {
  const inventory = inventoryMap(items);
  const catalog = CITY_TRACKS_BY_ID;
  const random = rng(options.seed ?? 1);
  const deadline = Date.now() + (options.timeoutMs ?? 2200);
  const candidates: TrackLayout[] = [];
  const reserved = reservedStraightsFor(inventory, prefs);
  const neededRun =
    ((inventory['switch-left'] ?? 0) + (inventory['switch-right'] ?? 0) > 0 ? 2 : 0) +
    ((inventory['double-crossover'] ?? 0) > 0 ? 3 : 0);

  const spread = !prefs.compact;
  const rings = collectRings(inventory, catalog, random, reserved, neededRun, spread)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
  const wandered = wanderHomeLoop(inventory, catalog, random, deadline);
  if (wandered && loopCloses(wandered, catalog)) {
    rings.unshift(wandered);
  }
  for (const ring of rings.slice(0, 4)) {
    const decorated = decorateLoop(ring, inventory, catalog, prefs);
    candidates.push(finalize(decorated, inventory, prefs, 'layout.variedLoop'));
    if (loopCloses(ring, catalog) && !mainlineCloses(decorated, catalog)) {
      candidates.push(finalize(ring, inventory, prefs, 'layout.roundedLoop'));
    }
  }

  const parallels = parallelFromCrossover(inventory, catalog);
  if (parallels) {
    const withPark =
      prefs.targetParkingSpots > 0
        ? addParkingSidings(
            insertSwitchesIntoLoop(parallels, inventory),
            inventory,
            catalog,
            prefs.targetParkingSpots,
          )
        : parallels;
    candidates.push(finalize(withPark, inventory, prefs, 'layout.parallels'));
  }

  const hasLoop = candidates.some((layout) => layout.score.routeBonus > 0);
  const lineSeq = pointToPointSequence(inventory, random);
  if (lineSeq && !hasLoop) {
    const parts = buildSequence(lineSeq, catalog, false);
    if (parts) {
      candidates.push(finalize(parts, inventory, prefs, 'layout.pointToPoint'));
    }
  }

  if (!hasLoop && (inventory['switch-left'] ?? 0) + (inventory['switch-right'] ?? 0) > 0) {
    const switchId = (inventory['switch-left'] ?? 0) > 0 ? 'switch-left' : 'switch-right';
    const seeded: PlacedPart[] = [{ instanceId: 's1', partId: switchId, label: 1, x: 0, y: 0, rotation: 0 }];
    const withSiding = addParkingSidings(seeded, inventory, catalog, Math.max(1, prefs.targetParkingSpots));
    const grown = search(inventory, prefs, random, deadline, withSiding);
    candidates.push(finalize(grown, inventory, prefs, 'layout.switchLed'));
  }

  if (!hasLoop) {
    const searched = search(inventory, prefs, random, deadline);
    if (searched.length) {
      candidates.push(finalize(searched, inventory, prefs, 'layout.search'));
    }
  }

  if (candidates.length === 0) {
    return finalize([], inventory, prefs, 'layout.noPieces');
  }

  const fifteenCurves = (inventory['curve-22'] ?? 0) === 15;
  const usable = fifteenCurves
    ? candidates.filter((layout) => layout.score.routeBonus === 0)
    : candidates;
  const looped = usable.filter((layout) => layout.score.routeBonus > 0);
  const pool = prefs.loopPlusParking && looped.length ? looped : usable.length ? usable : candidates;
  pool.sort((a, b) => b.score.total - a.score.total);
  const best = pool[0];
  if (best.parts.length === 0) {
    best.message = 'layout.couldNotPlace';
  }
  return best;
}

export function emptyLayout(): TrackLayout {
  return finalize([], {}, DEFAULT_PREFERENCES, 'layout.noDesign');
}
