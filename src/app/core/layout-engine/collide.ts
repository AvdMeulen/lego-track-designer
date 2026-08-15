import { PlacedPart, TrackPart } from '../../shared/models/track';
import { polygonsOverlap, transformPolygon } from './geometry';

export function placementCollides(
  candidate: PlacedPart,
  others: PlacedPart[],
  catalog: Record<string, TrackPart>,
  ignoreInstanceId?: string,
): boolean {
  const part = catalog[candidate.partId];
  const polygon = candidate.flexPath
    ? thickenPath(candidate.flexPath, 4)
    : transformPolygon(part.footprint, candidate);

  return others.some((other) => {
    if (other.instanceId === candidate.instanceId || other.instanceId === ignoreInstanceId) {
      return false;
    }
    const otherPart = catalog[other.partId];
    const otherPolygon = other.flexPath
      ? thickenPath(other.flexPath, 4)
      : transformPolygon(otherPart.footprint, other);
    return polygonsOverlap(polygon, otherPolygon);
  });
}

function thickenPath(path: { x: number; y: number }[], width: number) {
  if (path.length < 2) {
    return path;
  }
  const half = width / 2;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / length) * half;
    const ny = ((b.x - a.x) / length) * half;
    left.push({ x: a.x + nx, y: a.y + ny });
    right.push({ x: a.x - nx, y: a.y - ny });
    if (i === path.length - 2) {
      left.push({ x: b.x + nx, y: b.y + ny });
      right.push({ x: b.x - nx, y: b.y - ny });
    }
  }
  return [...left, ...right.reverse()];
}
