import { PlacedPart, TrackPart } from '../../shared/models/track';
import { placementCollides } from './collide';
import { detectConnections, remainingInventory } from './connections';
import { attachPart, WorldPort, worldPorts } from './geometry';

export interface GenContext {
  catalog: Record<string, TrackPart>;
  random: () => number;
  deadline: number;
  seq: number;
}

export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function inventoryMap(items: { partId: string; quantity: number }[]): Record<string, number> {
  return Object.fromEntries(items.map((item) => [item.partId, item.quantity]));
}

export function nextId(ctx: GenContext, prefix: string): string {
  ctx.seq += 1;
  return `${prefix}${ctx.seq}`;
}

export function stockOf(inventory: Record<string, number>, parts: PlacedPart[]): Record<string, number> {
  return remainingInventory(inventory, parts);
}

export function neighborsOf(
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

export function tryAttach(
  part: TrackPart,
  localPortId: string,
  target: WorldPort,
  existing: PlacedPart[],
  catalog: Record<string, TrackPart>,
  instanceId: string,
  extraIgnore: string[] = [],
): PlacedPart | null {
  const pose = attachPart(part, localPortId, target);
  const candidate: PlacedPart = { instanceId, partId: part.id, label: 1, ...pose };
  const ignore = [target.instanceId, ...neighborsOf(target.instanceId, existing, catalog), ...extraIgnore];
  if (placementCollides(candidate, existing, catalog, ignore)) {
    return null;
  }
  return candidate;
}

export function freePort(part: PlacedPart, catalog: Record<string, TrackPart>, usedPortId: string): WorldPort | null {
  return worldPorts(catalog[part.partId], part).find((port) => port.id !== usedPortId) ?? null;
}

export function placeOnHead(
  partId: string,
  portId: string,
  head: WorldPort,
  parts: PlacedPart[],
  ctx: GenContext,
  prefix: string,
  extraIgnore: string[] = [],
): { part: PlacedPart; head: WorldPort } | null {
  const placed = tryAttach(
    ctx.catalog[partId],
    portId,
    head,
    parts,
    ctx.catalog,
    nextId(ctx, prefix),
    extraIgnore,
  );
  if (!placed) {
    return null;
  }
  const next = freePort(placed, ctx.catalog, portId);
  return next ? { part: placed, head: next } : null;
}

export function ownerOf(port: WorldPort, parts: PlacedPart[]): PlacedPart | undefined {
  return parts.find((item) => item.instanceId === port.instanceId);
}
