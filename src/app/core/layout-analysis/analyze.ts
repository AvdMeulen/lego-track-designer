import { detectConnections, openPorts } from '../layout-engine/connections';
import { distance } from '../layout-engine/geometry';
import {
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
  const unfinishedPorts = openPorts(parts, catalog).filter((port) => {
    const part = catalog[parts.find((item) => item.instanceId === port.instanceId)?.partId ?? ''];
    return part?.category !== 'buffer';
  }).length;

  return {
    parts,
    connections,
    unusedInventory,
    parkingSpots,
    reverseOptions,
    unfinishedPorts,
    score: {
      total: 0,
      parkingMatches: parkingSpots.length,
      reverseBonus: reverseOptions.length,
      routeBonus: countCycles(graph),
      piecesUsed: parts.length,
      compactness: compactness(parts),
      unfinishedPenalty: unfinishedPorts,
      specialsBonus: parts.filter((part) =>
        ['switch', 'crossing', 'double-crossover'].includes(catalog[part.partId]?.category),
      ).length,
      flexPenalty: parts.filter((part) => part.partId === 'flex-track').length,
    },
    message,
  };
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
    if (length >= 16 || category === 'buffer') {
      spots.push({
        id: `park-${part.instanceId}`,
        endInstanceId: part.instanceId,
        clearLengthStuds: Math.max(length, category === 'buffer' ? 16 : length),
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
    if (category === 'straight' || category === 'flex') {
      length += 16;
    } else if (category === 'curve') {
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

  if (countCycles(graph) > 0 && parts.some((part) => catalog[part.partId]?.category === 'switch')) {
    const switchIds = parts.filter((part) => catalog[part.partId]?.category === 'switch').map((part) => part.instanceId);
    if (switchIds.some((id) => (graph.get(id)?.length ?? 0) >= 3) && countCycles(graph) >= 1) {
      options.push({ kind: 'reversing-loop', partIds: switchIds });
    }
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
      if (wanted.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }
  return [...wanted].every((id) => seen.has(id));
}

function countCycles(graph: Map<string, NodeEdge[]>): number {
  const visited = new Set<string>();
  let cycles = 0;

  const dfs = (node: string, parent: string | null, path: Set<string>) => {
    visited.add(node);
    path.add(node);
    for (const edge of graph.get(node) ?? []) {
      if (edge.to === parent) {
        continue;
      }
      if (path.has(edge.to)) {
        cycles += 1;
        continue;
      }
      if (!visited.has(edge.to)) {
        dfs(edge.to, node, path);
      }
    }
    path.delete(node);
  };

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, null, new Set());
    }
  }
  return cycles;
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
