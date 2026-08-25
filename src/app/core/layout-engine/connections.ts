import { Connection, PlacedPart, TrackPart } from '../../shared/models/track';
import { CONNECT_TOLERANCE, distance, portsConnect, WorldPort, worldPorts } from './geometry';

export function catalogMap(parts: readonly TrackPart[]): Record<string, TrackPart> {
  return Object.fromEntries(parts.map((part) => [part.id, part]));
}

export function allWorldPorts(placed: PlacedPart[], catalog: Record<string, TrackPart>): WorldPort[] {
  return placed.flatMap((item) => worldPorts(catalog[item.partId], item));
}

export function detectConnections(placed: PlacedPart[], catalog: Record<string, TrackPart>): Connection[] {
  const ports = allWorldPorts(placed, catalog);
  const connections: Connection[] = [];
  const used = new Set<string>();

  for (let i = 0; i < ports.length; i += 1) {
    for (let j = i + 1; j < ports.length; j += 1) {
      const a = ports[i];
      const b = ports[j];
      if (a.instanceId === b.instanceId) {
        continue;
      }
      const keyA = `${a.instanceId}:${a.id}`;
      const keyB = `${b.instanceId}:${b.id}`;
      if (used.has(keyA) || used.has(keyB)) {
        continue;
      }
      if (portsConnect(a, b) || flexJoins(a, b, placed, catalog)) {
        used.add(keyA);
        used.add(keyB);
        connections.push({
          fromInstanceId: a.instanceId,
          fromPortId: a.id,
          toInstanceId: b.instanceId,
          toPortId: b.id,
        });
      }
    }
  }
  return connections;
}

function flexJoins(
  a: WorldPort,
  b: WorldPort,
  placed: PlacedPart[],
  catalog: Record<string, TrackPart>,
): boolean {
  if (distance(a, b) > CONNECT_TOLERANCE) {
    return false;
  }
  return isFlexPort(a, placed, catalog) || isFlexPort(b, placed, catalog);
}

function isFlexPort(port: WorldPort, placed: PlacedPart[], catalog: Record<string, TrackPart>): boolean {
  const owner = placed.find((part) => part.instanceId === port.instanceId);
  return !!owner?.flexPath && owner.flexPath.length >= 2 && !!catalog[owner.partId]?.flex;
}

export function openPorts(placed: PlacedPart[], catalog: Record<string, TrackPart>): WorldPort[] {
  const connections = detectConnections(placed, catalog);
  const used = new Set<string>();
  for (const connection of connections) {
    used.add(`${connection.fromInstanceId}:${connection.fromPortId}`);
    used.add(`${connection.toInstanceId}:${connection.toPortId}`);
  }
  return allWorldPorts(placed, catalog).filter((port) => !used.has(`${port.instanceId}:${port.id}`));
}

export function remainingInventory(
  inventory: Record<string, number>,
  placed: PlacedPart[],
): Record<string, number> {
  const left = { ...inventory };
  for (const item of placed) {
    left[item.partId] = (left[item.partId] ?? 0) - 1;
  }
  return left;
}

export function unusedItems(inventory: Record<string, number>, placed: PlacedPart[]) {
  return Object.entries(remainingInventory(inventory, placed))
    .filter(([, quantity]) => quantity > 0)
    .map(([partId, quantity]) => ({ partId, quantity }));
}

/** Number of disjoint track pieces (parking sidings count as connected through their switch). */
export function connectedGroupCount(placed: PlacedPart[], catalog: Record<string, TrackPart>): number {
  if (placed.length === 0) {
    return 0;
  }
  const parent = new Map(placed.map((part) => [part.instanceId, part.instanceId]));
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (parent.get(root) !== root) {
      const next = parent.get(root) ?? root;
      parent.set(root, parent.get(next) ?? next);
      root = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  };
  for (const connection of detectConnections(placed, catalog)) {
    union(connection.fromInstanceId, connection.toInstanceId);
  }
  return new Set(placed.map((part) => find(part.instanceId))).size;
}
