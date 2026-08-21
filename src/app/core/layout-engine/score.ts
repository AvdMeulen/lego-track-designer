import { GenerationPreferences, PlacedPart, TrackLayout } from '../../shared/models/track';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { headingDelta, normalizeHeading } from './geometry';

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

function adjacentSwitchPairs(layout: TrackLayout): number {
  const ids = new Set(
    layout.parts
      .filter((part) => CITY_TRACKS_BY_ID[part.partId]?.category === 'switch')
      .map((part) => part.instanceId),
  );
  return layout.connections.filter(
    (connection) => ids.has(connection.fromInstanceId) && ids.has(connection.toInstanceId),
  ).length;
}

function unusedCrossoverPorts(layout: TrackLayout): number {
  const xo = layout.parts.filter((part) => part.partId === 'double-crossover');
  if (xo.length === 0) {
    return 0;
  }
  const ids = new Set(xo.map((part) => part.instanceId));
  const used = new Set<string>();
  for (const connection of layout.connections) {
    if (ids.has(connection.fromInstanceId)) {
      used.add(`${connection.fromInstanceId}:${connection.fromPortId}`);
    }
    if (ids.has(connection.toInstanceId)) {
      used.add(`${connection.toInstanceId}:${connection.toPortId}`);
    }
  }
  return Math.max(0, xo.length * 4 - used.size);
}

function unusedCrossingPorts(layout: TrackLayout): number {
  const items = layout.parts.filter((part) => part.partId === 'crossing-90');
  if (items.length === 0) {
    return 0;
  }
  const ids = new Set(items.map((part) => part.instanceId));
  const used = new Set<string>();
  for (const connection of layout.connections) {
    if (ids.has(connection.fromInstanceId)) {
      used.add(`${connection.fromInstanceId}:${connection.fromPortId}`);
    }
    if (ids.has(connection.toInstanceId)) {
      used.add(`${connection.toInstanceId}:${connection.toPortId}`);
    }
  }
  return Math.max(0, items.length * 4 - used.size);
}

function closedSwitchPorts(layout: TrackLayout, portId: string): number {
  return layout.parts.filter((part) => {
    if (CITY_TRACKS_BY_ID[part.partId]?.category !== 'switch') {
      return false;
    }
    return layout.connections.some(
      (connection) =>
        (connection.fromInstanceId === part.instanceId && connection.fromPortId === portId) ||
        (connection.toInstanceId === part.instanceId && connection.toPortId === portId),
    );
  }).length;
}

function independentCycles(layout: TrackLayout): number {
  if (layout.parts.length === 0) {
    return 0;
  }
  return Math.max(0, layout.connections.length - layout.parts.length + 1);
}

function headingVariety(parts: PlacedPart[]): number {
  const headings = new Set(
    parts
      .filter((part) => part.partId === 'straight-16')
      .map((part) => Math.round(normalizeHeading(part.rotation) / 22.5) % 8),
  );
  return headings.size >= 3 ? (headings.size - 2) * 6 : 0;
}

/** Penalize a four-sided cardinal box, not L/U silhouettes or a round O. */
export function rectangleEnvelopePenalty(parts: PlacedPart[]): number {
  const straights = parts.filter((part) => part.partId === 'straight-16');
  if (straights.length < 8) {
    return 0;
  }
  const xs = parts.map((part) => part.x);
  const ys = parts.map((part) => part.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 40 || height < 40) {
    return 0;
  }
  const margin = Math.max(10, Math.min(width, height) * 0.12);
  const onLeft = parts.filter((part) => part.x <= minX + margin).length;
  const onRight = parts.filter((part) => part.x >= maxX - margin).length;
  const onTop = parts.filter((part) => part.y <= minY + margin).length;
  const onBottom = parts.filter((part) => part.y >= maxY - margin).length;
  const threshold = Math.max(3, parts.length * 0.1);
  const occupiedSides = [onLeft, onRight, onTop, onBottom].filter((count) => count >= threshold).length;
  const cardinal = straights.filter((part) =>
    [0, 90, 180, 270].some((heading) => headingDelta(part.rotation, heading) < 8),
  ).length;
  const cardinalRatio = cardinal / straights.length;
  const axes = straightHeadingAxes(straights);
  if (occupiedSides === 4 && cardinalRatio > 0.55 && axes <= 2) {
    const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
    if (aspect < 2.4) {
      return 48;
    }
  }
  return 0;
}

function straightHeadingAxes(straights: PlacedPart[]): number {
  return new Set(
    straights.map((part) => Math.round(((((part.rotation % 180) + 180) % 180) / 22.5) % 8)),
  ).size;
}

/** A rhombus / parallelogram uses two straight headings, including a 22.5° diamond. */
export function twoAxisLoopPenalty(parts: PlacedPart[]): number {
  const straights = parts.filter(
    (part) => part.partId === 'straight-16' && !part.instanceId.startsWith('sid'),
  );
  if (straights.length < 16) {
    return 0;
  }
  return straightHeadingAxes(straights) <= 2 ? 40 : 0;
}

function parkingRunwayPenalty(layout: TrackLayout): number {
  const longest = layout.parkingSpots.reduce((max, spot) => Math.max(max, spot.clearLengthStuds), 0);
  return Math.max(0, longest / 16 - 8) * 18;
}

/** Two long parallel cardinal runways, not a mountain road. */
function longestCircuitStraightRun(layout: TrackLayout): number {
  const byId = Object.fromEntries(layout.parts.map((part) => [part.instanceId, part]));
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = adj.get(a) ?? [];
    if (!list.includes(b)) {
      list.push(b);
      adj.set(a, list);
    }
  };
  for (const connection of layout.connections) {
    const a = byId[connection.fromInstanceId];
    const b = byId[connection.toInstanceId];
    if (!a || !b || a.partId !== 'straight-16' || b.partId !== 'straight-16') {
      continue;
    }
    if (a.instanceId.startsWith('sid') || b.instanceId.startsWith('sid')) {
      continue;
    }
    if (headingDelta(a.rotation, b.rotation) > 8 && headingDelta(a.rotation, b.rotation + 180) > 8) {
      continue;
    }
    add(a.instanceId, b.instanceId);
    add(b.instanceId, a.instanceId);
  }
  const visited = new Set<string>();
  let longest = 0;
  for (const start of adj.keys()) {
    if (visited.has(start) || (adj.get(start)?.length ?? 0) > 1) {
      continue;
    }
    let len = 0;
    let prev: string | null = null;
    let cur: string | null = start;
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      len += 1;
      const next: string | null = (adj.get(cur) ?? []).find((id) => id !== prev) ?? null;
      prev = cur;
      cur = next;
    }
    longest = Math.max(longest, len);
  }
  return longest;
}

function hasOppositeCurveBend(layout: TrackLayout, prefixes: string[]): boolean {
  const ids = new Set(
    layout.parts
      .filter(
        (part) =>
          prefixes.some((prefix) => part.instanceId.startsWith(prefix)) && part.partId === 'curve-22',
      )
      .map((part) => part.instanceId),
  );
  for (const connection of layout.connections) {
    if (!ids.has(connection.fromInstanceId) || !ids.has(connection.toInstanceId)) {
      continue;
    }
    const fromTurn = connection.fromPortId === 'a' ? 1 : -1;
    const toTurn = connection.toPortId === 'b' ? 1 : -1;
    if (fromTurn * toTurn < 0) {
      return true;
    }
  }
  return false;
}

/** Outer stadium bubbles: only cardinal straights and no S-bends. */
function simpleBubblePenalty(layout: TrackLayout): number {
  let penalty = 0;
  for (const prefix of ['rte', 'xo', 'cr']) {
    const pieces = layout.parts.filter(
      (part) =>
        part.instanceId.startsWith(prefix) &&
        (part.partId === 'curve-22' || part.partId === 'straight-16'),
    );
    if (pieces.length < 14) {
      continue;
    }
    const straights = pieces.filter((part) => part.partId === 'straight-16');
    const curves = pieces.filter((part) => part.partId === 'curve-22');
    if (straights.length < 2 || curves.length < 12) {
      continue;
    }
    const cardinal = straights.filter((part) =>
      [0, 90, 180, 270].some((heading) => headingDelta(part.rotation, heading) < 8),
    ).length;
    if (cardinal === straights.length && !hasOppositeCurveBend(layout, [prefix])) {
      penalty += 22;
    }
  }
  return penalty;
}

/** Local feature-circuit bypasses between switch diverges are not a useful second route. */
export function shortSwitchBypassPenalty(layout: TrackLayout, maxHops = 4): number {
  const switches = layout.parts.filter((part) => CITY_TRACKS_BY_ID[part.partId]?.category === 'switch');
  if (switches.length < 2) {
    return 0;
  }
  const switchIds = new Set(switches.map((part) => part.instanceId));
  const featurePiece = (instanceId: string): boolean =>
    ['rte', 'par', 'xo', 'kel', 'det', 'inf', 'cr', 'br', 'sw'].some((prefix) =>
      instanceId.startsWith(prefix),
    );
  const adj = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = adj.get(from) ?? [];
    if (!list.includes(to)) {
      list.push(to);
      adj.set(from, list);
    }
  };
  for (const connection of layout.connections) {
    add(connection.fromInstanceId, connection.toInstanceId);
    add(connection.toInstanceId, connection.fromInstanceId);
  }
  const divergeNeighbor = (instanceId: string): string | null => {
    for (const connection of layout.connections) {
      if (connection.fromInstanceId === instanceId && connection.fromPortId === 'diverge') {
        return connection.toInstanceId;
      }
      if (connection.toInstanceId === instanceId && connection.toPortId === 'diverge') {
        return connection.fromInstanceId;
      }
    }
    return null;
  };
  const hopsBetween = (start: string, goal: string): number | null => {
    if (start === goal) {
      return 0;
    }
    if (!featurePiece(start) || !featurePiece(goal)) {
      return null;
    }
    const seen = new Set<string>([start, ...switchIds]);
    seen.delete(start);
    let frontier = [start];
    let hops = 0;
    while (frontier.length && hops <= maxHops) {
      const next: string[] = [];
      for (const node of frontier) {
        if (node === goal) {
          return hops;
        }
        for (const neighbor of adj.get(node) ?? []) {
          if (seen.has(neighbor) || switchIds.has(neighbor) || !featurePiece(neighbor)) {
            continue;
          }
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
      hops += 1;
    }
    return null;
  };
  let pairs = 0;
  for (let i = 0; i < switches.length; i += 1) {
    for (let j = i + 1; j < switches.length; j += 1) {
      const from = divergeNeighbor(switches[i].instanceId);
      const to = divergeNeighbor(switches[j].instanceId);
      if (!from || !to) {
        continue;
      }
      const hops = hopsBetween(from, to);
      if (hops !== null && hops <= maxHops) {
        pairs += 1;
      }
    }
  }
  return pairs * 48;
}

export function scoreLayout(layout: TrackLayout, prefs: GenerationPreferences): number {
  const parkingDelta = Math.abs(layout.parkingSpots.length - prefs.targetParkingSpots);
  const extraPark = Math.max(0, layout.parkingSpots.length - prefs.targetParkingSpots) * 16;
  const xoOpen = unusedCrossoverPorts(layout);
  const crOpen = unusedCrossingPorts(layout);
  const xoBonus = layout.parts.some((part) => part.partId === 'double-crossover') && xoOpen === 0 ? 28 : 0;
  const crBonus = layout.parts.some((part) => part.partId === 'crossing-90') && crOpen === 0 ? 22 : 0;
  const cycles = independentCycles(layout);
  const unused = unusedRigidCount(layout) * 8 + unusedSpecialCount(layout) * 40;
  const parkPieces = layout.parkingSpots.reduce((sum, spot) => sum + spot.clearLengthStuds, 0) / 16;
  const parkLength = prefs.targetParkingSpots > 0 ? Math.min(parkPieces, 8) * 3 : 0;
  const diverges = closedSwitchPorts(layout, 'diverge');
  const throughs = closedSwitchPorts(layout, 'through');
  return (
    50 -
    parkingDelta * 20 +
    cycles * 22 +
    layout.score.specialsBonus * 10 +
    xoBonus +
    crBonus +
    parkLength +
    diverges * 10 +
    throughs * 6 +
    headingVariety(layout.parts) +
    Math.min(36, layout.score.compactness * 250) -
    unused -
    extraPark -
    parkingRunwayPenalty(layout) -
    Math.max(0, longestCircuitStraightRun(layout) - 8) * 5 -
    rectangleEnvelopePenalty(layout.parts) -
    twoAxisLoopPenalty(layout.parts) -
    simpleBubblePenalty(layout) -
    shortSwitchBypassPenalty(layout) -
    adjacentSwitchPairs(layout) * 24 -
    layout.score.unfinishedPenalty * (layout.score.routeBonus > 0 ? 40 : 4) -
    layout.score.flexPenalty * 8 -
    xoOpen * 12 -
    crOpen * 10
  );
}

export function layoutIsValid(layout: TrackLayout, inventory: Record<string, number>): boolean {
  if (layout.unfinishedPorts > 0) {
    return false;
  }
  const specialsInStock =
    (inventory['switch-left'] ?? 0) +
    (inventory['switch-right'] ?? 0) +
    (inventory['double-crossover'] ?? 0) +
    (inventory['crossing-90'] ?? 0);
  if (specialsInStock > 0 && layout.score.specialsBonus === 0) {
    return false;
  }
  return true;
}
