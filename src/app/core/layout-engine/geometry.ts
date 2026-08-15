import { Point, Port, TrackPart } from '../../shared/models/track';

export const CONNECT_TOLERANCE = 0.35;
export const HEADING_TOLERANCE = 4;
export const CURVE_RADIUS = 40;
export const CURVE_ANGLE = 22.5;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function normalizeHeading(deg: number): number {
  const value = deg % 360;
  return value < 0 ? value + 360 : value;
}

export function headingDelta(a: number, b: number): number {
  const delta = Math.abs(normalizeHeading(a) - normalizeHeading(b)) % 360;
  return delta > 180 ? 360 - delta : delta;
}

export function rotatePoint(point: Point, deg: number): Point {
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtractPoints(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface WorldPort extends Port {
  instanceId: string;
}

export function worldPort(
  part: TrackPart,
  placement: { x: number; y: number; rotation: number; instanceId: string },
  portId: string,
): WorldPort {
  const local = part.ports.find((port) => port.id === portId);
  if (!local) {
    throw new Error(`Unknown port ${portId} on ${part.id}`);
  }
  const rotated = rotatePoint(local, placement.rotation);
  return {
    id: local.id,
    instanceId: placement.instanceId,
    x: placement.x + rotated.x,
    y: placement.y + rotated.y,
    heading: normalizeHeading(local.heading + placement.rotation),
  };
}

export function worldPorts(
  part: TrackPart,
  placement: { x: number; y: number; rotation: number; instanceId: string },
): WorldPort[] {
  return part.ports.map((port) => worldPort(part, placement, port.id));
}

export function portsConnect(a: Pick<Port, 'x' | 'y' | 'heading'>, b: Pick<Port, 'x' | 'y' | 'heading'>): boolean {
  return distance(a, b) <= CONNECT_TOLERANCE && headingDelta(a.heading, b.heading + 180) <= HEADING_TOLERANCE;
}

export function attachPart(
  part: TrackPart,
  localPortId: string,
  target: Pick<Port, 'x' | 'y' | 'heading'>,
): { x: number; y: number; rotation: number } {
  const local = part.ports.find((port) => port.id === localPortId);
  if (!local) {
    throw new Error(`Unknown port ${localPortId} on ${part.id}`);
  }
  const rotation = normalizeHeading(target.heading + 180 - local.heading);
  const rotated = rotatePoint(local, rotation);
  return {
    x: target.x - rotated.x,
    y: target.y - rotated.y,
    rotation,
  };
}

export function transformPolygon(
  polygon: Point[],
  placement: { x: number; y: number; rotation: number },
): Point[] {
  return polygon.map((point) => {
    const rotated = rotatePoint(point, placement.rotation);
    return { x: placement.x + rotated.x, y: placement.y + rotated.y };
  });
}

function project(polygon: Point[], axis: Point): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of polygon) {
    const value = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function axesOf(polygon: Point[]): Point[] {
  const axes: Point[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const edge = { x: next.x - current.x, y: next.y - current.y };
    const length = Math.hypot(edge.x, edge.y) || 1;
    axes.push({ x: -edge.y / length, y: edge.x / length });
  }
  return axes;
}

export function polygonsOverlap(a: Point[], b: Point[], inset = 0.45): boolean {
  if (a.length < 3 || b.length < 3) {
    return false;
  }
  const axes = [...axesOf(a), ...axesOf(b)];
  for (const axis of axes) {
    const projA = project(a, axis);
    const projB = project(b, axis);
    if (projA.max - inset < projB.min || projB.max - inset < projA.min) {
      return false;
    }
  }
  return true;
}

export function allFootprints(part: { footprint: Point[]; extraFootprints?: Point[][] }): Point[][] {
  return [part.footprint, ...(part.extraFootprints ?? [])];
}

export function polygonCenter(points: Point[]): Point {
  const bounds = boundsOf(points);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function boundsOf(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function curveEnd(radius = CURVE_RADIUS, angle = CURVE_ANGLE, sign = 1): Point {
  const rad = degToRad(angle);
  return {
    x: radius * Math.sin(rad),
    y: sign * radius * (1 - Math.cos(rad)),
  };
}

/** Constant-width ring segment along an R40 centerline, not a bounding wedge. */
export function curveSector(
  radius = CURVE_RADIUS,
  angle = CURVE_ANGLE,
  halfWidth = 4,
  sign = 1,
  steps = 1,
): Point[] {
  const outer: Point[] = [];
  const inner: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const rad = degToRad((angle * i) / steps);
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const y = sign * radius * (1 - cos);
    outer.push({
      x: (radius + halfWidth) * sin,
      y: y - sign * halfWidth * cos,
    });
    inner.push({
      x: (radius - halfWidth) * sin,
      y: y + sign * halfWidth * cos,
    });
  }
  return [...outer, ...inner.reverse()];
}

export function curveArtworkPath(
  radius = CURVE_RADIUS,
  angle = CURVE_ANGLE,
  halfWidth = 4,
  sign = 1,
): string {
  const [outerStart, outerEnd, innerEnd, innerStart] = curveSector(radius, angle, halfWidth, sign, 1);
  const outerR = radius + halfWidth;
  const innerR = radius - halfWidth;
  const sweep = sign >= 0 ? 1 : 0;
  const back = sign >= 0 ? 0 : 1;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 0 ${sweep} ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 0 ${back} ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function rectPath(x: number, y: number, width: number, height: number): string {
  return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
}

function thickenSegment(a: Point, b: Point, halfWidth: number): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / length) * halfWidth;
  const ny = ((b.x - a.x) / length) * halfWidth;
  return [
    `M ${a.x + nx} ${a.y + ny}`,
    `L ${b.x + nx} ${b.y + ny}`,
    `L ${b.x - nx} ${b.y - ny}`,
    `L ${a.x - nx} ${a.y - ny}`,
    'Z',
  ].join(' ');
}

export function switchArtwork(sign = 1): { beds: string[]; rails: string[] } {
  const end = curveEnd(CURVE_RADIUS, CURVE_ANGLE, sign);
  const sweep = sign >= 0 ? 1 : 0;
  return {
    beds: [rectPath(0, -3, 16, 6), curveArtworkPath(CURVE_RADIUS, CURVE_ANGLE, 3, sign)],
    rails: [`M 0 0 H 16`, `M 0 0 A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 ${sweep} ${end.x} ${end.y}`],
  };
}

export function crossoverArtwork(): { beds: string[]; rails: string[] } {
  return {
    beds: [
      rectPath(-16, -3, 32, 6),
      rectPath(-16, 5, 32, 6),
      thickenSegment({ x: -16, y: 0 }, { x: 16, y: 8 }, 2.3),
      thickenSegment({ x: -16, y: 8 }, { x: 16, y: 0 }, 2.3),
    ],
    rails: ['M -16 0 H 16', 'M -16 8 H 16', 'M -16 0 L 16 8', 'M -16 8 L 16 0'],
  };
}

export function rectangle(width: number, height: number, originX = 0, originY = -height / 2): Point[] {
  return [
    { x: originX, y: originY },
    { x: originX + width, y: originY },
    { x: originX + width, y: originY + height },
    { x: originX, y: originY + height },
  ];
}

export function unionRectangles(rects: Point[][]): Point[] {
  const all = rects.flat();
  const bounds = boundsOf(all);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}
