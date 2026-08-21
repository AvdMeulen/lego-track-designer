import { FloorPlan, FloorShape } from '../../shared/models/floor-plan';
import { PlacedPart, Point, TrackPart } from '../../shared/models/track';
import { allFootprints, boundsOf, distance, polygonsOverlap, transformPolygon } from '../layout-engine/geometry';

export const VERTEX_HIT_STUDS = 7;
export const EDGE_HIT_STUDS = 5;
export const ORTHO_SNAP_STUDS = 6;
export const CLOSE_LOOP_STUDS = 10;
export const CM_NUDGE_STUDS = 1.25;
export const CM_NUDGE_LARGE_STUDS = 12.5;

export function pointInPolygon(point: Point, polygon: Point[], includeEdge = true): boolean {
  if (polygon.length < 3) {
    return false;
  }
  if (includeEdge && pointOnPolygonEdge(point, polygon, 0.02)) {
    return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersect =
      a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointOnPolygonEdge(point: Point, polygon: Point[], tolerance = 0.35): boolean {
  for (let i = 0; i < polygon.length; i += 1) {
    if (distanceToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]) <= tolerance) {
      return true;
    }
  }
  return false;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  return distance(point, closestPointOnSegment(point, a, b));
}

export function closestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-8) {
    return { x: a.x, y: a.y };
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function segmentLength(a: Point, b: Point): number {
  return distance(a, b);
}

export function polygonSamples(polygon: Point[]): Point[] {
  const samples = [...polygon];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    samples.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  if (polygon.length) {
    const bounds = boundsOf(polygon);
    samples.push({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
  }
  return samples;
}

export function polygonInside(inner: Point[], outer: Point[]): boolean {
  return polygonSamples(inner).every((point) => pointInPolygon(point, outer, true));
}

export function placementHitsRoom(
  candidate: PlacedPart,
  catalog: Record<string, TrackPart>,
  plan: FloorPlan,
): boolean {
  const spec = catalog[candidate.partId];
  if (!spec) {
    return true;
  }
  const polygons = allFootprints(spec).map((polygon) => transformPolygon(polygon, candidate));
  for (const polygon of polygons) {
    if (!polygonInside(polygon, plan.outer.points)) {
      return true;
    }
    for (const obstacle of plan.obstacles) {
      if (polygonsOverlap(polygon, obstacle.points, 0.02)) {
        const centroid = {
          x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
          y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
        };
        if (pointInPolygon(centroid, obstacle.points, false) || polygonInside(polygon, obstacle.points)) {
          return true;
        }
        if (polygonSamples(polygon).some((point) => pointInPolygon(point, obstacle.points, false))) {
          return true;
        }
      }
    }
  }
  return false;
}

export function orthoSnap(point: Point, others: Point[], threshold = ORTHO_SNAP_STUDS): Point {
  let next = { ...point };
  let bestX = threshold;
  let bestY = threshold;
  for (const other of others) {
    const dx = Math.abs(point.x - other.x);
    const dy = Math.abs(point.y - other.y);
    if (dx < bestX) {
      bestX = dx;
      next = { ...next, x: other.x };
    }
    if (dy < bestY) {
      bestY = dy;
      next = { ...next, y: other.y };
    }
  }
  return next;
}

export function otherVertices(plan: FloorPlan, skip?: { shapeId: string; index: number }): Point[] {
  const points: Point[] = [];
  for (const shape of [plan.outer, ...plan.obstacles]) {
    shape.points.forEach((point, index) => {
      if (skip && skip.shapeId === shape.id && skip.index === index) {
        return;
      }
      points.push(point);
    });
  }
  return points;
}

export type FloorHit =
  | { kind: 'vertex'; shapeId: string; index: number; role: 'outer' | 'obstacle' }
  | { kind: 'edge'; shapeId: string; index: number; role: 'outer' | 'obstacle'; at: Point };

export function hitTestFloor(plan: FloorPlan, point: Point): FloorHit | null {
  let bestVertex: FloorHit | null = null;
  let bestVertexDist = VERTEX_HIT_STUDS;
  for (const shape of [plan.outer, ...plan.obstacles]) {
    const role = shape.id === plan.outer.id ? 'outer' : 'obstacle';
    shape.points.forEach((vertex, index) => {
      const dist = distance(point, vertex);
      if (dist < bestVertexDist) {
        bestVertexDist = dist;
        bestVertex = { kind: 'vertex', shapeId: shape.id, index, role };
      }
    });
  }
  if (bestVertex) {
    return bestVertex;
  }
  let bestEdge: FloorHit | null = null;
  let bestEdgeDist = EDGE_HIT_STUDS;
  for (const shape of [plan.outer, ...plan.obstacles]) {
    const role = shape.id === plan.outer.id ? 'outer' : 'obstacle';
    for (let index = 0; index < shape.points.length; index += 1) {
      const a = shape.points[index];
      const b = shape.points[(index + 1) % shape.points.length];
      const at = closestPointOnSegment(point, a, b);
      const dist = distance(point, at);
      if (dist < bestEdgeDist) {
        bestEdgeDist = dist;
        bestEdge = { kind: 'edge', shapeId: shape.id, index, role, at };
      }
    }
  }
  return bestEdge;
}

export function shapeById(plan: FloorPlan, shapeId: string): FloorShape | undefined {
  if (plan.outer.id === shapeId) {
    return plan.outer;
  }
  return plan.obstacles.find((shape) => shape.id === shapeId);
}

export function insertVertex(shape: FloorShape, edgeIndex: number, point: Point): FloorShape {
  const points = [...shape.points];
  points.splice(edgeIndex + 1, 0, { x: point.x, y: point.y });
  return { ...shape, points };
}

export function moveVertex(shape: FloorShape, index: number, point: Point): FloorShape {
  const points = shape.points.map((item, itemIndex) => (itemIndex === index ? { x: point.x, y: point.y } : item));
  return { ...shape, points };
}

export function moveEdge(shape: FloorShape, edgeIndex: number, delta: Point): FloorShape {
  const a = edgeIndex;
  const b = (edgeIndex + 1) % shape.points.length;
  const points = shape.points.map((item, index) =>
    index === a || index === b ? { x: item.x + delta.x, y: item.y + delta.y } : item,
  );
  return { ...shape, points };
}

export function removeVertex(shape: FloorShape, index: number): FloorShape | null {
  if (shape.points.length <= 3) {
    return null;
  }
  return {
    ...shape,
    points: shape.points.filter((_, itemIndex) => itemIndex !== index),
  };
}

export function replaceShape(plan: FloorPlan, shape: FloorShape): FloorPlan {
  if (shape.id === plan.outer.id) {
    return { ...plan, outer: shape };
  }
  return {
    ...plan,
    obstacles: plan.obstacles.map((item) => (item.id === shape.id ? shape : item)),
  };
}

export function floorBounds(plan: FloorPlan): { minX: number; minY: number; maxX: number; maxY: number } {
  return boundsOf(plan.outer.points.flatMap((point) => [point]).concat(plan.obstacles.flatMap((shape) => shape.points)));
}

export function nextObstacleId(plan: FloorPlan): string {
  let index = plan.obstacles.length + 1;
  const used = new Set(plan.obstacles.map((shape) => shape.id));
  while (used.has(`obs-${index}`)) {
    index += 1;
  }
  return `obs-${index}`;
}
