import { Point, Port, TrackPart } from '../../shared/models/track';

export const CONNECT_TOLERANCE = 0.35;
export const HEADING_TOLERANCE = 4;
export const CURVE_RADIUS = 40;
export const CURVE_ANGLE = 22.5;
/** City switch through-route length (set 60238 / 53407). */
export const SWITCH_LENGTH = 32;
/** Outward S-bend of a City switch: arctan(3/4) from the 24-32-40 triangle. */
export const SWITCH_OUT_ANGLE = (Math.atan(0.75) * 180) / Math.PI;
export const SWITCH_RETURN_ANGLE = SWITCH_OUT_ANGLE - CURVE_ANGLE;
/** Assembled 7996-1: two 24×24 halves (60128) joined end to end. */
export const CROSSOVER_LENGTH = 48;
export const CROSSOVER_SPACING = 16;

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

type PortPlacement = {
  x: number;
  y: number;
  rotation: number;
  instanceId: string;
  flexPath?: Point[];
};

function flexWorldPorts(part: TrackPart, placement: PortPlacement): WorldPort[] | null {
  const path = placement.flexPath;
  if (!part.flex || !path || path.length < 2) {
    return null;
  }
  const start = path[0];
  const next = path[1];
  const end = path[path.length - 1];
  const prev = path[path.length - 2];
  return [
    {
      id: part.ports[0]?.id ?? 'a',
      instanceId: placement.instanceId,
      x: start.x,
      y: start.y,
      heading: normalizeHeading((Math.atan2(start.y - next.y, start.x - next.x) * 180) / Math.PI),
    },
    {
      id: part.ports[1]?.id ?? 'b',
      instanceId: placement.instanceId,
      x: end.x,
      y: end.y,
      heading: normalizeHeading((Math.atan2(end.y - prev.y, end.x - prev.x) * 180) / Math.PI),
    },
  ];
}

export function worldPort(part: TrackPart, placement: PortPlacement, portId: string): WorldPort {
  const flexed = flexWorldPorts(part, placement);
  const match = flexed?.find((port) => port.id === portId);
  if (match) {
    return match;
  }
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

export function worldPorts(part: TrackPart, placement: PortPlacement): WorldPort[] {
  return flexWorldPorts(part, placement) ?? part.ports.map((port) => worldPort(part, placement, port.id));
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

function rectPolygon(x: number, y: number, width: number, height: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function offsetPolyline(center: Point[], half: number): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < center.length; i += 1) {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(center.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    left.push({
      x: center[i].x + (-dy / len) * half,
      y: center[i].y + (dx / len) * half,
    });
    right.push({
      x: center[i].x - (-dy / len) * half,
      y: center[i].y - (dx / len) * half,
    });
  }
  return [...left, ...right.reverse()];
}

function arcCenterline(angle: number, sign: number, steps: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const rad = degToRad((angle * i) / steps);
    points.push({
      x: CURVE_RADIUS * Math.sin(rad),
      y: sign * CURVE_RADIUS * (1 - Math.cos(rad)),
    });
  }
  return points;
}

export function switchDivergeEnd(sign = 1): Point {
  const mid = curveEnd(CURVE_RADIUS, SWITCH_OUT_ANGLE, sign);
  const back = curveEnd(CURVE_RADIUS, SWITCH_RETURN_ANGLE, -sign);
  return addPoints(mid, rotatePoint(back, sign * SWITCH_OUT_ANGLE));
}

export function switchBranchFootprints(sign = 1): Point[][] {
  const mid = curveEnd(CURVE_RADIUS, SWITCH_OUT_ANGLE, sign);
  const first = curveSector(CURVE_RADIUS, SWITCH_OUT_ANGLE, 4, sign, 8);
  const second = curveSector(CURVE_RADIUS, SWITCH_RETURN_ANGLE, 4, -sign, 8).map((point) =>
    addPoints(mid, rotatePoint(point, sign * SWITCH_OUT_ANGLE)),
  );
  return [first, second];
}

/** Continuous 8-stud-wide S-branch: first-outer joins second-inner after the inflection. */
export function switchBranchOutline(sign = 1, half = 4, steps = 16): Point[] {
  const mid = curveEnd(CURVE_RADIUS, SWITCH_OUT_ANGLE, sign);
  const firstOuter: Point[] = [];
  const firstInner: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const rad = degToRad((SWITCH_OUT_ANGLE * i) / steps);
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const y = sign * CURVE_RADIUS * (1 - cos);
    firstOuter.push({
      x: (CURVE_RADIUS + half) * sin,
      y: y - sign * half * cos,
    });
    firstInner.push({
      x: (CURVE_RADIUS - half) * sin,
      y: y + sign * half * cos,
    });
  }
  const xform = (point: Point) => addPoints(mid, rotatePoint(point, sign * SWITCH_OUT_ANGLE));
  const secondSign = -sign;
  const secondOuter: Point[] = [];
  const secondInner: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const rad = degToRad((SWITCH_RETURN_ANGLE * i) / steps);
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const y = secondSign * CURVE_RADIUS * (1 - cos);
    secondOuter.push(
      xform({
        x: (CURVE_RADIUS + half) * sin,
        y: y - secondSign * half * cos,
      }),
    );
    secondInner.push(
      xform({
        x: (CURVE_RADIUS - half) * sin,
        y: y + secondSign * half * cos,
      }),
    );
  }
  return [
    ...firstOuter,
    ...secondInner.slice(1),
    ...secondOuter.slice().reverse(),
    ...firstInner.slice(0, -1).reverse(),
  ];
}

function pointsToPath(points: Point[]): string {
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z`;
}

/** Constant-width S from (0,0) heading 0 to (48, ±16) heading 0: switch branch plus completing curve. */
export function crossoverBranchOutline(sign = 1, half = 4, steps = 16): Point[] {
  const first = arcCenterline(SWITCH_OUT_ANGLE, sign, steps);
  const mid = first[first.length - 1];
  const second = arcCenterline(SWITCH_RETURN_ANGLE, -sign, steps)
    .slice(1)
    .map((point) => addPoints(mid, rotatePoint(point, sign * SWITCH_OUT_ANGLE)));
  const diverge = switchDivergeEnd(sign);
  const far = curveEnd(CURVE_RADIUS, CURVE_ANGLE, sign);
  const pose = { x: diverge.x + far.x, y: diverge.y + far.y, rotation: 180 };
  const third: Point[] = [];
  for (let i = steps - 1; i >= 0; i -= 1) {
    const rad = degToRad((CURVE_ANGLE * i) / steps);
    third.push(
      transformPolygon(
        [
          {
            x: CURVE_RADIUS * Math.sin(rad),
            y: sign * CURVE_RADIUS * (1 - Math.cos(rad)),
          },
        ],
        pose,
      )[0],
    );
  }
  return offsetPolyline([...first, ...second, ...third], half);
}

export type TrackArtwork = { beds: string[]; rails: string[]; outline?: string };

/** Outer silhouette of through-bed ∪ S-branch, so the canvas can stroke one path. */
export function switchUnionOutline(sign = 1, half = 4, steps = 16): Point[] {
  const branch = switchBranchOutline(sign, half, steps);
  const yInner = sign * half;
  const yOuter = -sign * half;
  const firstCount = steps + 1;
  let leave = 1;
  for (let i = 1; i < firstCount; i += 1) {
    const crossed = sign > 0 ? branch[i].y > half : branch[i].y < -half;
    if (crossed) {
      leave = i;
      break;
    }
  }
  const prev = branch[leave - 1];
  const next = branch[leave];
  const t = (yInner - prev.y) / (next.y - prev.y || 1);
  const split = { x: prev.x + (next.x - prev.x) * t, y: yInner };
  return [
    { x: 0, y: yOuter },
    { x: SWITCH_LENGTH, y: yOuter },
    { x: SWITCH_LENGTH, y: yInner },
    split,
    ...branch.slice(leave),
  ];
}

export function switchArtwork(sign = 1): TrackArtwork {
  const half = 4;
  const steps = 32;
  return {
    beds: [rectPath(0, -half, SWITCH_LENGTH, half * 2), pointsToPath(switchBranchOutline(sign, half, steps))],
    rails: [],
    outline: pointsToPath(switchUnionOutline(sign, half, steps)),
  };
}

export function crossingArtwork(): TrackArtwork {
  return {
    beds: [rectPath(-8, -4, 16, 8), rectPath(-4, -8, 8, 16)],
    rails: [],
    outline: pointsToPath([
      { x: -4, y: -8 },
      { x: 4, y: -8 },
      { x: 4, y: -4 },
      { x: 8, y: -4 },
      { x: 8, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 8 },
      { x: -4, y: 8 },
      { x: -4, y: 4 },
      { x: -8, y: 4 },
      { x: -8, y: -4 },
      { x: -4, y: -4 },
    ]),
  };
}

export function crossoverArtwork(): TrackArtwork {
  const half = CROSSOVER_LENGTH / 2;
  const lane = CROSSOVER_SPACING;
  const shift = (point: Point, y: number) => addPoints(point, { x: -half, y });
  const up = crossoverBranchOutline(1, 4, 32).map((point) => shift(point, 0));
  const down = crossoverBranchOutline(-1, 4, 32).map((point) => shift(point, lane));
  const lower = rectPolygon(-half, -4, CROSSOVER_LENGTH, 8);
  const upper = rectPolygon(-half, lane - 4, CROSSOVER_LENGTH, 8);
  return {
    beds: [pointsToPath(lower), pointsToPath(upper), pointsToPath(up), pointsToPath(down)],
    rails: [],
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
