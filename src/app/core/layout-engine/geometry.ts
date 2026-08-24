import { Connection, PlacedPart, Point, Port, TrackPart } from '../../shared/models/track';

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

function travelVector(deg: number): Point {
  const rad = degToRad(deg);
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

function tangentAt(
  center: Point[],
  index: number,
  startTravelDeg?: number,
  endTravelDeg?: number,
): Point {
  if (index === 0 && startTravelDeg != null) {
    return travelVector(startTravelDeg);
  }
  if (index === center.length - 1 && endTravelDeg != null) {
    return travelVector(endTravelDeg);
  }
  const prev = center[Math.max(0, index - 1)];
  const next = center[Math.min(center.length - 1, index + 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function offsetPoint(
  center: Point[],
  index: number,
  half: number,
  startTravelDeg?: number,
  endTravelDeg?: number,
): Point {
  const travel = tangentAt(center, index, startTravelDeg, endTravelDeg);
  return {
    x: center[index].x + -travel.y * half,
    y: center[index].y + travel.x * half,
  };
}

function offsetSide(
  center: Point[],
  half: number,
  startTravelDeg?: number,
  endTravelDeg?: number,
): Point[] {
  return center.map((_, index) => offsetPoint(center, index, half, startTravelDeg, endTravelDeg));
}

function offsetPolyline(
  center: Point[],
  half: number,
  startTravelDeg?: number,
  endTravelDeg?: number,
): Point[] {
  return [
    ...offsetSide(center, half, startTravelDeg, endTravelDeg),
    ...offsetSide(center, -half, startTravelDeg, endTravelDeg).reverse(),
  ];
}

function headingBetween(from: Point, to: Point): number {
  return normalizeHeading((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return points;
}

/** Smooth centerline that leaves and arrives along the neighbor headings. */
export function flexCenterline(
  path: Point[],
  startTravelDeg?: number,
  endTravelDeg?: number,
  steps = 24,
): Point[] {
  if (path.length < 2) {
    return path;
  }
  const start = path[0];
  const end = path[path.length - 1];
  const startTravel = startTravelDeg ?? headingBetween(start, path[1]);
  const endTravel = endTravelDeg ?? headingBetween(path[path.length - 2], end);
  const chord = distance(start, end);
  const handle = Math.max(2.2, chord / 3);
  const head = travelVector(startTravel);
  const tail = travelVector(endTravel);
  return sampleCubic(
    start,
    { x: start.x + head.x * handle, y: start.y + head.y * handle },
    { x: end.x - tail.x * handle, y: end.y - tail.y * handle },
    end,
    steps,
  );
}

/** Short aligned stubs so the end caps sit flush on the neighbor faces. */
function padFlexEnds(path: Point[], startTravelDeg?: number, endTravelDeg?: number, stub = 1.1): Point[] {
  if (path.length < 2) {
    return path;
  }
  const padded = [...path];
  if (startTravelDeg != null) {
    const travel = travelVector(startTravelDeg);
    padded.splice(1, 0, {
      x: path[0].x + travel.x * stub,
      y: path[0].y + travel.y * stub,
    });
  }
  if (endTravelDeg != null) {
    const travel = travelVector(endTravelDeg);
    const end = path[path.length - 1];
    padded.splice(padded.length - 1, 0, {
      x: end.x - travel.x * stub,
      y: end.y - travel.y * stub,
    });
  }
  return padded;
}

function flexPreparedPath(
  path: Point[],
  startTravelDeg?: number,
  endTravelDeg?: number,
): Point[] {
  return padFlexEnds(flexCenterline(path, startTravelDeg, endTravelDeg), startTravelDeg, endTravelDeg);
}

function polylineLength(points: Point[]): number {
  return points.reduce((sum, point, index) => (index === 0 ? 0 : sum + distance(points[index - 1], point)), 0);
}

function pointAlongPolyline(points: Point[], at: number): { point: Point; index: number } {
  let traveled = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const seg = distance(points[i], points[i + 1]);
    if (traveled + seg >= at || i === points.length - 2) {
      const t = seg === 0 ? 0 : Math.min(1, (at - traveled) / seg);
      return {
        point: {
          x: points[i].x + (points[i + 1].x - points[i].x) * t,
          y: points[i].y + (points[i + 1].y - points[i].y) * t,
        },
        index: i,
      };
    }
    traveled += seg;
  }
  return { point: points[points.length - 1], index: points.length - 2 };
}

function slicePolyline(points: Point[], from: number, to: number): Point[] {
  const start = pointAlongPolyline(points, from);
  const end = pointAlongPolyline(points, to);
  const middle = points.slice(start.index + 1, end.index + 1);
  return [start.point, ...middle, end.point];
}

function flexRunEnds(
  paths: Point[][],
  startPoint?: Point,
  endPoint?: Point,
): { start: Point; end: Point } {
  const last = paths[paths.length - 1] ?? [];
  return {
    start: startPoint ?? paths[0]?.[0] ?? { x: 0, y: 0 },
    end: endPoint ?? last[last.length - 1] ?? { x: 0, y: 0 },
  };
}

/** One smooth centerline for a flex run, split so pieces meet with the same tangent. */
export function flexRunSlices(
  paths: Point[][],
  startTravelDeg?: number,
  endTravelDeg?: number,
  startPoint?: Point,
  endPoint?: Point,
): Point[][] {
  if (paths.length === 0) {
    return [];
  }
  const { start, end } = flexRunEnds(paths, startPoint, endPoint);
  if (paths.length === 1) {
    return [flexPreparedPath([start, ...(paths[0].slice(1, -1)), end], startTravelDeg, endTravelDeg)];
  }
  const full = flexCenterline([start, end], startTravelDeg, endTravelDeg, 24 * paths.length);
  const total = polylineLength(full);
  return paths.map((_, index) => {
    const slice = slicePolyline(full, (total * index) / paths.length, (total * (index + 1)) / paths.length);
    return padFlexEnds(
      slice,
      index === 0 ? startTravelDeg : undefined,
      index === paths.length - 1 ? endTravelDeg : undefined,
    );
  });
}

export function flexSliceModel(
  center: Point[],
  startTravelDeg?: number,
  endTravelDeg?: number,
): { polygon: Point[]; artwork: TrackArtwork } {
  const bed = offsetPolyline(center, 4, startTravelDeg, endTravelDeg);
  return {
    polygon: bed,
    artwork: {
      beds: [pointsToPath(bed)],
      rails: [],
    },
  };
}

/** Fills per flex piece plus one closed outline around the whole run. */
export function flexRunArtwork(
  paths: Point[][],
  startTravelDeg?: number,
  endTravelDeg?: number,
  startPoint?: Point,
  endPoint?: Point,
): { slices: Point[][]; polygons: Point[][]; fills: string[]; outline: string } {
  const slices = flexRunSlices(paths, startTravelDeg, endTravelDeg, startPoint, endPoint);
  const { start, end } = flexRunEnds(paths, startPoint, endPoint);
  const outlineBed = offsetPolyline(
    flexPreparedPath([start, end], startTravelDeg, endTravelDeg),
    4,
    startTravelDeg,
    endTravelDeg,
  );
  const polygons = slices.map((slice, index) =>
    offsetPolyline(
      slice,
      4,
      index === 0 ? startTravelDeg : undefined,
      index === slices.length - 1 ? endTravelDeg : undefined,
    ),
  );
  return {
    slices,
    polygons,
    fills: polygons.map((polygon) => pointsToPath(polygon)),
    outline: pointsToPath(outlineBed),
  };
}

/** 8-stud-wide bed along a flex centerline, end caps aligned to travel headings. */
export function flexBedPolygon(
  path: Point[],
  half = 4,
  startTravelDeg?: number,
  endTravelDeg?: number,
): Point[] {
  return offsetPolyline(flexPreparedPath(path, startTravelDeg, endTravelDeg), half, startTravelDeg, endTravelDeg);
}

export function flexArtwork(
  path: Point[],
  startTravelDeg?: number,
  endTravelDeg?: number,
): TrackArtwork {
  return flexSliceModel(flexPreparedPath(path, startTravelDeg, endTravelDeg), startTravelDeg, endTravelDeg).artwork;
}

function connectionAt(
  instanceId: string,
  portId: string,
  connections: Connection[],
): Connection | undefined {
  return connections.find(
    (connection) =>
      (connection.fromInstanceId === instanceId && connection.fromPortId === portId) ||
      (connection.toInstanceId === instanceId && connection.toPortId === portId),
  );
}

function isFlexPart(part: PlacedPart, byId: (id: string) => TrackPart): boolean {
  return !!part.flexPath?.length || !!byId(part.partId).flex;
}

function collectFlexNeighbors(
  part: PlacedPart,
  portId: string,
  connections: Connection[],
  parts: PlacedPart[],
  byId: (id: string) => TrackPart,
): PlacedPart[] {
  const found: PlacedPart[] = [];
  let instanceId = part.instanceId;
  let currentPort = portId;
  const seen = new Set<string>([part.instanceId]);
  for (let step = 0; step < 16; step += 1) {
    const hit = connectionAt(instanceId, currentPort, connections);
    if (!hit) {
      break;
    }
    const otherId = hit.fromInstanceId === instanceId ? hit.toInstanceId : hit.fromInstanceId;
    const otherPortId = hit.fromInstanceId === instanceId ? hit.toPortId : hit.fromPortId;
    const other = parts.find((item) => item.instanceId === otherId);
    if (!other || seen.has(other.instanceId) || !isFlexPart(other, byId)) {
      break;
    }
    seen.add(other.instanceId);
    found.push(other);
    instanceId = other.instanceId;
    currentPort = otherPortId === 'a' ? 'b' : 'a';
  }
  return found;
}

export function flexRun(
  part: PlacedPart,
  connections: Connection[],
  parts: PlacedPart[],
  byId: (id: string) => TrackPart,
): {
  paths: Point[][];
  index: number;
  startTravel?: number;
  endTravel?: number;
  startPoint?: Point;
  endPoint?: Point;
} {
  const before = collectFlexNeighbors(part, 'a', connections, parts, byId);
  const after = collectFlexNeighbors(part, 'b', connections, parts, byId);
  const run = [...before.reverse(), part, ...after];
  const paths = run.map((item) => item.flexPath ?? []);
  const start = walkRigidNeighbor(run[0], 'a', connections, parts, byId);
  const end = walkRigidNeighbor(run[run.length - 1], 'b', connections, parts, byId);
  return {
    paths,
    index: before.length,
    startTravel: start?.heading,
    endTravel: end ? normalizeHeading(end.heading + 180) : undefined,
    startPoint: start ? { x: start.x, y: start.y } : undefined,
    endPoint: end ? { x: end.x, y: end.y } : undefined,
  };
}

/** Travel along a flex piece at each end, walking through flex-to-flex joins to the rigid neighbor. */
export function flexChainTravels(
  part: PlacedPart,
  connections: Connection[],
  parts: PlacedPart[],
  byId: (id: string) => TrackPart,
): [number | undefined, number | undefined] {
  const run = flexRun(part, connections, parts, byId);
  return [run.startTravel, run.endTravel];
}

function walkRigidNeighbor(
  part: PlacedPart,
  portId: string,
  connections: Connection[],
  parts: PlacedPart[],
  byId: (id: string) => TrackPart,
): WorldPort | undefined {
  let instanceId = part.instanceId;
  let currentPort = portId;
  const seen = new Set<string>();
  for (let step = 0; step < 16; step += 1) {
    const key = `${instanceId}:${currentPort}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    const hit = connectionAt(instanceId, currentPort, connections);
    if (!hit) {
      return undefined;
    }
    const otherId = hit.fromInstanceId === instanceId ? hit.toInstanceId : hit.fromInstanceId;
    const otherPortId = hit.fromInstanceId === instanceId ? hit.toPortId : hit.fromPortId;
    const other = parts.find((item) => item.instanceId === otherId);
    if (!other) {
      return undefined;
    }
    const spec = byId(other.partId);
    if (other.flexPath?.length || spec.flex) {
      instanceId = other.instanceId;
      currentPort = otherPortId === 'a' ? 'b' : 'a';
      continue;
    }
    return worldPort(spec, other, otherPortId);
  }
  return undefined;
}

function walkRigidTravel(
  part: PlacedPart,
  portId: string,
  connections: Connection[],
  parts: PlacedPart[],
  byId: (id: string) => TrackPart,
  towardEnd: boolean,
): number | undefined {
  const neighbor = walkRigidNeighbor(part, portId, connections, parts, byId);
  if (!neighbor) {
    return undefined;
  }
  return towardEnd ? normalizeHeading(neighbor.heading + 180) : neighbor.heading;
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
