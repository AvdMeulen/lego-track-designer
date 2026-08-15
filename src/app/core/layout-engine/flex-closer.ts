import { PlacedPart, Point, TrackPart } from '../../shared/models/track';
import { placementCollides } from './collide';
import { openPorts } from './connections';
import { distance, headingDelta } from './geometry';

export function flexPathBetween(a: Point, b: Point): Point[] {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(6, length / 3);
  const control = { x: mid.x - (dy / length) * bulge, y: mid.y + (dx / length) * bulge };
  const points: Point[] = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    const u = 1 - t;
    points.push({
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
    });
  }
  return points;
}

export function canCloseWithFlex(
  a: { x: number; y: number; heading: number },
  b: { x: number; y: number; heading: number },
  flex: TrackPart,
): boolean {
  const limits = flex.flex;
  if (!limits) {
    return false;
  }
  const chord = distance(a, b);
  if (chord < limits.minChordStuds || chord > limits.lengthStuds) {
    return false;
  }
  const dir = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const error = headingDelta(a.heading, dir) + headingDelta(b.heading, dir + 180);
  return error <= limits.maxBendDegrees;
}

export function closeWithFlex(
  placed: PlacedPart[],
  catalog: Record<string, TrackPart>,
  remaining: Record<string, number>,
  allowFlex: boolean,
): PlacedPart[] {
  if (!allowFlex || (remaining['flex-track'] ?? 0) <= 0) {
    return placed;
  }
  const flex = catalog['flex-track'];
  if (!flex?.flex) {
    return placed;
  }

  const result = [...placed];
  let left = remaining['flex-track'];
  let label = result.reduce((max, part) => Math.max(max, part.label), 0);

  while (left > 0) {
    const opens = openPorts(result, catalog);
    let pair: [number, number] | null = null;
    let bestChord = Infinity;
    for (let i = 0; i < opens.length; i += 1) {
      for (let j = i + 1; j < opens.length; j += 1) {
        if (!canCloseWithFlex(opens[i], opens[j], flex)) {
          continue;
        }
        const chord = distance(opens[i], opens[j]);
        if (chord < bestChord) {
          bestChord = chord;
          pair = [i, j];
        }
      }
    }
    if (!pair) {
      break;
    }
    const a = opens[pair[0]];
    const b = opens[pair[1]];
    const candidate: PlacedPart = {
      instanceId: `flex-${result.length + 1}`,
      partId: 'flex-track',
      label: (label += 1),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      rotation: 0,
      flexPath: flexPathBetween(a, b),
    };
    const ignore = new Set([a.instanceId, b.instanceId]);
    const blocked = result.some(
      (other) =>
        !ignore.has(other.instanceId) &&
        placementCollides(candidate, [other], catalog),
    );
    if (blocked) {
      break;
    }
    result.push(candidate);
    left -= 1;
  }

  return result;
}
