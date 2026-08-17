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
  if (occupiedSides === 4 && cardinalRatio > 0.55) {
    const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
    if (aspect < 2.4) {
      return 36;
    }
  }
  return 0;
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
  const parkLength =
    prefs.targetParkingSpots > 0
      ? (layout.parkingSpots.reduce((sum, spot) => sum + spot.clearLengthStuds, 0) / 16) * 3
      : 0;
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
    headingVariety(layout.parts) -
    unused -
    extraPark -
    rectangleEnvelopePenalty(layout.parts) -
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
