import { detectConnections, openPorts } from '../layout-engine/connections';
import { distance } from '../layout-engine/geometry';
import {
  GenerationPreferences,
  LayoutMark,
  ParkingSpot,
  PlacedPart,
  ReverseOption,
  TrackLayout,
  TrackPart,
} from '../../shared/models/track';

interface NodeEdge {
  to: string;
  via: string;
}

export function analyzeLayout(
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
  unusedInventory: { partId: string; quantity: number }[],
  message?: string,
): TrackLayout {
  const connections = detectConnections(parts, catalog);
  const graph = buildGraph(parts, connections);
  const parkingSpots = findParkingSpots(parts, catalog, graph);
  const reverseOptions = findReverseOptions(parts, catalog, graph, parkingSpots);
  const opens = openPorts(parts, catalog);
  const parkingEnds = new Set(parkingSpots.map((spot) => spot.endInstanceId));
  const unfinished = opens.filter((port) => {
    const part = catalog[parts.find((item) => item.instanceId === port.instanceId)?.partId ?? ''];
    return part?.category !== 'buffer' && !parkingEnds.has(port.instanceId);
  });
  const marks = buildMarks(parts, parkingSpots, reverseOptions, unfinished);
  const score = {
    total: 0,
    parkingMatches: parkingSpots.length,
    reverseBonus: reverseOptions.reduce((sum, option) => sum + (option.kind === 'dead-end' ? 1 : 3), 0),
    routeBonus: countCycles(graph),
    piecesUsed: parts.length,
    compactness: compactness(parts),
    unfinishedPenalty: unfinished.length,
    specialsBonus: parts.filter((part) =>
      ['switch', 'crossing', 'double-crossover'].includes(catalog[part.partId]?.category),
    ).length,
    flexPenalty: parts.filter((part) => part.partId === 'flex-track').length,
  };

  return {
    parts,
    connections,
    unusedInventory,
    parkingSpots,
    reverseOptions,
    unfinishedPorts: unfinished.length,
    marks,
    notes: [],
    score,
    message,
  };
}

export function preferenceNotes(
  layout: TrackLayout,
  prefs: GenerationPreferences,
  inventory: Record<string, number>,
): string[] {
  const notes: string[] = [];
  const switchCount = (inventory['switch-left'] ?? 0) + (inventory['switch-right'] ?? 0);
  const unusedFlex = layout.unusedInventory.find((item) => item.partId === 'flex-track')?.quantity ?? 0;

  if ((inventory['curve-22'] ?? 0) === 15 && layout.score.routeBonus === 0) {
    notes.push('15 curves cannot close a loop. The remaining gap is larger than one flex piece.');
  }
  if (prefs.targetParkingSpots > 0 && layout.parkingSpots.length === 0) {
    notes.push('No spare switch for a siding.');
  }
  if (prefs.preferReversingRoute && !layout.reverseOptions.some((option) => option.kind !== 'dead-end')) {
    if (switchCount === 0) {
      notes.push('No reversing route with the current pieces.');
    } else if (!layout.reverseOptions.some((option) => option.kind === 'reversing-loop' || option.kind === 'wye')) {
      notes.push('No reversing loop or wye; dead-end reverse is available if there is parking.');
    }
  }
  if (prefs.allowFlexCloses && unusedFlex > 0 && layout.unfinishedPorts > 0) {
    notes.push('Gap too large for flex.');
  }
  if (prefs.targetParkingSpots > layout.parkingSpots.length && layout.parkingSpots.length > 0) {
    notes.push('Fewer parking spots than requested.');
  }
  return notes;
}

function buildMarks(
  parts: PlacedPart[],
  parking: ParkingSpot[],
  reverse: ReverseOption[],
  unfinished: { x: number; y: number; instanceId: string }[],
): LayoutMark[] {
  const byId = Object.fromEntries(parts.map((part) => [part.instanceId, part]));
  const marks: LayoutMark[] = [];

  parking.forEach((spot, index) => {
    const part = byId[spot.endInstanceId];
    if (part) {
      marks.push({
        kind: 'parking',
        x: part.x,
        y: part.y - 7,
        text: `P${index + 1}`,
      });
    }
  });

  for (const option of reverse) {
    if (option.kind === 'dead-end') {
      continue;
    }
    const part = byId[option.partIds[0]];
    if (part) {
      marks.push({
        kind: 'reverse',
        x: part.x,
        y: part.y + 8,
        text: option.kind === 'wye' ? 'Wye' : 'Reverse loop',
      });
    }
  }

  for (const part of parts) {
    if (part.partId !== 'flex-track') {
      continue;
    }
    const point = part.flexPath?.[Math.floor((part.flexPath.length ?? 1) / 2)] ?? part;
    marks.push({ kind: 'flex', x: point.x, y: point.y - 7, text: 'Flex' });
  }

  for (const port of unfinished) {
    marks.push({ kind: 'unfinished', x: port.x, y: port.y - 6, text: 'Open' });
  }

  return marks;
}

function buildGraph(parts: PlacedPart[], connections: TrackLayout['connections']): Map<string, NodeEdge[]> {
  const graph = new Map<string, NodeEdge[]>();
  for (const part of parts) {
    graph.set(part.instanceId, []);
  }
  for (const connection of connections) {
    graph.get(connection.fromInstanceId)?.push({ to: connection.toInstanceId, via: connection.fromPortId });
    graph.get(connection.toInstanceId)?.push({ to: connection.fromInstanceId, via: connection.toPortId });
  }
  return graph;
}

function findParkingSpots(
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
  graph: Map<string, NodeEdge[]>,
): ParkingSpot[] {
  const byId = Object.fromEntries(parts.map((part) => [part.instanceId, part]));
  const spots: ParkingSpot[] = [];

  for (const part of parts) {
    const category = catalog[part.partId]?.category;
    const degree = graph.get(part.instanceId)?.length ?? 0;
    const isEnd = category === 'buffer' || degree === 1;
    if (!isEnd) {
      continue;
    }
    const { length, switchId } = walkClearLength(part.instanceId, graph, byId, catalog);
    const siding = !!switchId && length >= 16;
    const bufferedEnd = category === 'buffer';
    if (siding || bufferedEnd) {
      spots.push({
        id: `park-${part.instanceId}`,
        endInstanceId: part.instanceId,
        clearLengthStuds: Math.max(length, bufferedEnd ? 16 : length),
        switchInstanceId: switchId,
      });
    }
  }
  return spots;
}

function walkClearLength(
  start: string,
  graph: Map<string, NodeEdge[]>,
  byId: Record<string, PlacedPart>,
  catalog: Record<string, TrackPart>,
): { length: number; switchId?: string } {
  let length = 0;
  let current = start;
  let previous: string | null = null;
  let switchId: string | undefined;
  const visited = new Set<string>();

  while (current && !visited.has(current)) {
    visited.add(current);
    const part = byId[current];
    const category = catalog[part.partId]?.category;
    if (category === 'straight' || category === 'flex' || category === 'curve') {
      length += 16;
    }
    if (category === 'switch') {
      switchId = current;
      break;
    }
    const neighbors = (graph.get(current) ?? []).map((edge) => edge.to).filter((id) => id !== previous);
    if (neighbors.length !== 1) {
      break;
    }
    previous = current;
    current = neighbors[0];
  }
  return { length, switchId };
}

function nodesOnCycles(graph: Map<string, NodeEdge[]>): Set<string> {
  const onCycle = new Set<string>();
  const visited = new Set<string>();

  const dfs = (node: string, parent: string | null, stack: string[]) => {
    visited.add(node);
    stack.push(node);
    for (const edge of graph.get(node) ?? []) {
      if (edge.to === parent) {
        continue;
      }
      const seenAt = stack.indexOf(edge.to);
      if (seenAt >= 0) {
        for (const id of stack.slice(seenAt)) {
          onCycle.add(id);
        }
        continue;
      }
      if (!visited.has(edge.to)) {
        dfs(edge.to, node, stack);
      }
    }
    stack.pop();
  };

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, null, []);
    }
  }
  return onCycle;
}

function findReverseOptions(
  parts: PlacedPart[],
  catalog: Record<string, TrackPart>,
  graph: Map<string, NodeEdge[]>,
  parking: ParkingSpot[],
): ReverseOption[] {
  const options: ReverseOption[] = parking.map((spot) => ({
    kind: 'dead-end' as const,
    partIds: [spot.endInstanceId],
  }));

  const cyclic = nodesOnCycles(graph);
  const switchIds = parts
    .filter((part) => catalog[part.partId]?.category === 'switch')
    .map((part) => part.instanceId);
  const balloon = switchIds.filter((id) => cyclic.has(id) && (graph.get(id)?.length ?? 0) >= 2);
  if (balloon.length) {
    options.push({ kind: 'reversing-loop', partIds: balloon });
  }

  const switches = parts.filter((part) => catalog[part.partId]?.category === 'switch');
  if (switches.length >= 3 && switchesConnected(switches, graph)) {
    options.push({ kind: 'wye', partIds: switches.map((item) => item.instanceId) });
  }

  return options;
}

function switchesConnected(switches: PlacedPart[], graph: Map<string, NodeEdge[]>): boolean {
  if (switches.length === 0) {
    return false;
  }
  const wanted = new Set(switches.map((item) => item.instanceId));
  const seen = new Set<string>();
  const queue = [switches[0].instanceId];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    for (const edge of graph.get(id) ?? []) {
      queue.push(edge.to);
    }
  }
  return [...wanted].every((id) => seen.has(id));
}

function countCycles(graph: Map<string, NodeEdge[]>): number {
  return nodesOnCycles(graph).size > 0 ? 1 : 0;
}

function compactness(parts: PlacedPart[]): number {
  if (parts.length === 0) {
    return 0;
  }
  const xs = parts.map((part) => part.x);
  const ys = parts.map((part) => part.y);
  const width = Math.max(...xs) - Math.min(...xs) + 16;
  const height = Math.max(...ys) - Math.min(...ys) + 16;
  return 1 / Math.max(1, (width * height) / 1000);
}

export function layoutUsesAll(parts: PlacedPart[], expected: Record<string, number>): boolean {
  const used: Record<string, number> = {};
  for (const part of parts) {
    used[part.partId] = (used[part.partId] ?? 0) + 1;
  }
  return Object.entries(expected).every(([id, qty]) => (used[id] ?? 0) === qty);
}

export function farthestOpenGap(parts: PlacedPart[], catalog: Record<string, TrackPart>): number {
  const opens = openPorts(parts, catalog);
  let max = 0;
  for (let i = 0; i < opens.length; i += 1) {
    for (let j = i + 1; j < opens.length; j += 1) {
      max = Math.max(max, distance(opens[i], opens[j]));
    }
  }
  return max;
}
