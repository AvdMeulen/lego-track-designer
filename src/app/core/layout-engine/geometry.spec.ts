import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import {
  attachPart,
  crossoverArtwork,
  CURVE_ANGLE,
  CURVE_RADIUS,
  CROSSOVER_LENGTH,
  CROSSOVER_SPACING,
  SWITCH_LENGTH,
  crossingArtwork,
  crossoverBranchOutline,
  curveSector,
  distance,
  flexArtwork,
  flexBedPolygon,
  flexCenterline,
  flexChainTravels,
  flexRun,
  flexRunArtwork,
  flexRunSlices,
  headingDelta,
  polygonCenter,
  portsConnect,
  switchArtwork,
  switchBranchOutline,
  switchDivergeEnd,
  switchUnionOutline,
  worldPort,
} from './geometry';

describe('geometry', () => {
  it('connects ports that face each other', () => {
    expect(portsConnect({ x: 0, y: 0, heading: 0 }, { x: 0, y: 0, heading: 180 })).toBeTrue();
    expect(portsConnect({ x: 0, y: 0, heading: 0 }, { x: 2, y: 0, heading: 180 })).toBeFalse();
  });

  it('places a curve so the start port matches a target', () => {
    const curve = CITY_TRACKS_BY_ID['curve-22'];
    const pose = attachPart(curve, 'a', { x: 10, y: 4, heading: 90 });
    const port = worldPort(curve, { ...pose, instanceId: 'c1' }, 'a');
    expect(Math.abs(port.x - 10)).toBeLessThan(0.01);
    expect(Math.abs(port.y - 4)).toBeLessThan(0.01);
    expect(headingDelta(port.heading, 270)).toBeLessThan(0.01);
  });

  it('keeps the standard curve at 22.5 degrees', () => {
    expect(CURVE_ANGLE).toBe(22.5);
    const curve = CITY_TRACKS_BY_ID['curve-22'];
    expect(curve.ports[1].heading).toBe(22.5);
  });

  it('builds a constant-width curve sector instead of a funnel', () => {
    const sector = curveSector(CURVE_RADIUS, CURVE_ANGLE, 4, 1, 8);
    const center = { x: 0, y: CURVE_RADIUS };
    const startOuter = sector[0];
    const startInner = sector[sector.length - 1];
    expect(sector.length).toBeGreaterThan(8);
    expect(Math.abs(startOuter.y + 4)).toBeLessThan(0.01);
    expect(Math.abs(startInner.y - 4)).toBeLessThan(0.01);
    for (const point of sector.slice(0, 6)) {
      expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeCloseTo(CURVE_RADIUS + 4, 5);
    }
    for (const point of sector.slice(-6)) {
      expect(Math.hypot(point.x - center.x, point.y - center.y)).toBeCloseTo(CURVE_RADIUS - 4, 5);
    }
  });

  it('draws a switch as one 8-stud-wide through bed and one S-curve branch', () => {
    const art = switchArtwork(1);
    expect(art.beds.length).toBe(2);
    expect(art.rails.length).toBe(0);
    expect(art.outline).toContain('M 0 ');
    expect(art.beds[0]).toContain(`h ${SWITCH_LENGTH}`);
    expect(art.beds[0]).toContain('v 8');
  });

  it('outlines a switch as the union of the through bed and S-branch', () => {
    const outline = switchUnionOutline(1);
    expect(outline[0].x).toBeCloseTo(0, 5);
    expect(outline[0].y).toBeCloseTo(-4, 5);
    expect(outline.some((point) => Math.abs(point.x - SWITCH_LENGTH) < 0.01 && Math.abs(point.y + 4) < 0.01)).toBeTrue();
    expect(outline.some((point) => Math.abs(point.x - SWITCH_LENGTH) < 0.01 && Math.abs(point.y - 4) < 0.01)).toBeTrue();
    const last = outline[outline.length - 1];
    expect(last.x).toBeCloseTo(0, 1);
    expect(last.y).toBeCloseTo(4, 1);
    expect(Math.max(...outline.map((point) => point.y))).toBeGreaterThan(12);

    const diverge = switchDivergeEnd(1);
    const nearest = Math.min(...outline.map((point) => Math.hypot(point.x - diverge.x, point.y - diverge.y)));
    expect(nearest).toBeLessThan(4.2);

    const right = switchUnionOutline(-1);
    expect(right[0].y).toBeCloseTo(4, 5);
    expect(Math.min(...right.map((point) => point.y))).toBeLessThan(switchDivergeEnd(-1).y);
  });

  it('keeps the switch branch a constant-width S that reaches the diverge port', () => {
    const diverge = switchDivergeEnd(1);
    const outline = switchBranchOutline(1);
    const nearest = Math.min(...outline.map((point) => Math.hypot(point.x - diverge.x, point.y - diverge.y)));
    const maxY = Math.max(...outline.map((point) => point.y));
    expect(nearest).toBeLessThan(4.2);
    expect(maxY).toBeGreaterThan(diverge.y);
    expect(outline.some((point) => Math.hypot(point.x, point.y - 4) < 0.2)).toBeTrue();
    expect(outline.some((point) => Math.hypot(point.x, point.y + 4) < 0.2)).toBeTrue();

    const right = switchBranchOutline(-1);
    expect(Math.min(...right.map((point) => point.y))).toBeLessThan(switchDivergeEnd(-1).y);
  });

  it('completes a City switch to a 16-stud parallel with one curve and one straight', () => {
    const sw = CITY_TRACKS_BY_ID['switch-left'];
    const placed = { instanceId: 's1', x: 0, y: 0, rotation: 0 };
    const through = worldPort(sw, placed, 'through');
    const diverge = worldPort(sw, placed, 'diverge');
    expect(through.x).toBe(SWITCH_LENGTH);
    expect(diverge.heading).toBeCloseTo(CURVE_ANGLE, 5);
    expect(switchDivergeEnd(1).x).toBeCloseTo(32.68, 1);
    expect(switchDivergeEnd(1).y).toBeCloseTo(12.97, 1);

    const straightPose = attachPart(CITY_TRACKS_BY_ID['straight-16'], 'a', through);
    const curvePose = attachPart(CITY_TRACKS_BY_ID['curve-22'], 'b', diverge);
    const straightEnd = worldPort(CITY_TRACKS_BY_ID['straight-16'], { ...straightPose, instanceId: 'st' }, 'b');
    const curveEndPort = worldPort(CITY_TRACKS_BY_ID['curve-22'], { ...curvePose, instanceId: 'c' }, 'a');
    expect(straightEnd.x).toBeCloseTo(48, 1);
    expect(straightEnd.y).toBeCloseTo(0, 1);
    expect(curveEndPort.x).toBeCloseTo(48, 1);
    expect(curveEndPort.y).toBeCloseTo(16, 1);
    expect(headingDelta(straightEnd.heading, curveEndPort.heading)).toBeLessThan(1);
  });

  it('draws a crossover as two 8-stud parallels and two S-curve crossings', () => {
    const art = crossoverArtwork();
    expect(art.beds.length).toBe(4);
    expect(art.rails.length).toBe(0);
  });

  it('builds a crossover branch from a switch S plus a completing curve', () => {
    const outline = crossoverBranchOutline(1);
    const end = { x: CROSSOVER_LENGTH, y: CROSSOVER_SPACING };
    const nearestEnd = Math.min(...outline.map((point) => Math.hypot(point.x - end.x, point.y - end.y)));
    expect(nearestEnd).toBeLessThan(4.2);
    expect(outline.some((point) => Math.hypot(point.x, point.y - 4) < 0.3)).toBeTrue();
    expect(outline.some((point) => Math.hypot(point.x, point.y + 4) < 0.3)).toBeTrue();
    expect(outline.some((point) => point.y > 6 && point.y < 10 && point.x > 12 && point.x < 36)).toBeTrue();

    const right = crossoverBranchOutline(-1);
    const rightEnd = { x: CROSSOVER_LENGTH, y: -CROSSOVER_SPACING };
    const nearestRight = Math.min(...right.map((point) => Math.hypot(point.x - rightEnd.x, point.y - rightEnd.y)));
    expect(nearestRight).toBeLessThan(4.2);
  });

  it('draws a 90° crossing as an 8-stud-wide plus with one outline', () => {
    const art = crossingArtwork();
    expect(art.beds.length).toBe(2);
    expect(art.outline).toContain('M -4 -8');
    expect(art.outline).toContain('L 8 -4');
  });

  it('centers a straight label in the middle of the piece', () => {
    const center = polygonCenter(CITY_TRACKS_BY_ID['straight-16'].footprint);
    expect(center.x).toBeCloseTo(8, 5);
    expect(center.y).toBeCloseTo(0, 5);
  });

  it('draws an 8-stud-wide flex bed whose caps face the neighbor headings', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 8, y: 3 },
      { x: 16, y: 0 },
    ];
    const polygon = flexBedPolygon(path, 4, 0, 0);
    const startCap = [...polygon].sort((a, b) => distance(a, path[0]) - distance(b, path[0])).slice(0, 2);
    const endCap = [...polygon].sort((a, b) => distance(a, path[2]) - distance(b, path[2])).slice(0, 2);
    expect(distance(startCap[0], startCap[1])).toBeCloseTo(8, 5);
    expect(distance(endCap[0], endCap[1])).toBeCloseTo(8, 5);
    expect((startCap[0].y + startCap[1].y) / 2).toBeCloseTo(0, 5);
    expect((endCap[0].y + endCap[1].y) / 2).toBeCloseTo(0, 5);
  });

  it('leaves a flex centerline along the rigid neighbor heading', () => {
    const start = { x: 187.09575401358748, y: 364.1593137367624 };
    const end = { x: 199.44219915844212, y: 361.57293718983516 };
    const center = flexCenterline([start, end], 337.5, 337.5);
    const first = headingDelta(
      337.5,
      (Math.atan2(center[1].y - center[0].y, center[1].x - center[0].x) * 180) / Math.PI,
    );
    const last = headingDelta(
      337.5,
      (Math.atan2(center[center.length - 1].y - center[center.length - 2].y, center[center.length - 1].x - center[center.length - 2].x) *
        180) /
        Math.PI,
    );
    expect(first).toBeLessThan(2);
    expect(last).toBeLessThan(2);
  });

  it('walks through a flex chain to the rigid neighbor headings', () => {
    const straight = CITY_TRACKS_BY_ID['straight-16'];
    const curve = CITY_TRACKS_BY_ID['curve-22'];
    const flex = CITY_TRACKS_BY_ID['flex-track'];
    const byId = (id: string) =>
      id === 'straight-16' ? straight : id === 'curve-22' ? curve : flex;
    const parts = [
      { instanceId: 's', partId: 'straight-16', label: 1, x: 0, y: 0, rotation: 337.5 },
      {
        instanceId: 'flex-a',
        partId: 'flex-track',
        label: 2,
        x: 16,
        y: 0,
        rotation: 0,
        flexPath: [
          { x: 16, y: 0 },
          { x: 24, y: 1 },
          { x: 32, y: 0 },
        ],
      },
      {
        instanceId: 'flex-b',
        partId: 'flex-track',
        label: 3,
        x: 32,
        y: 0,
        rotation: 0,
        flexPath: [
          { x: 32, y: 0 },
          { x: 40, y: 1 },
          { x: 48, y: 0 },
        ],
      },
      { instanceId: 'c', partId: 'curve-22', label: 4, x: 48, y: 0, rotation: 337.5 },
    ];
    const connections = [
      { fromInstanceId: 's', fromPortId: 'b', toInstanceId: 'flex-a', toPortId: 'a' },
      { fromInstanceId: 'flex-a', fromPortId: 'b', toInstanceId: 'flex-b', toPortId: 'a' },
      { fromInstanceId: 'flex-b', fromPortId: 'b', toInstanceId: 'c', toPortId: 'a' },
    ];
    const [start, end] = flexChainTravels(parts[1], connections, parts, byId);
    expect(start).toBeCloseTo(337.5, 5);
    expect(end).toBeCloseTo(337.5, 5);
    const run = flexRun(parts[1], connections, parts, byId);
    const port = worldPort(straight, parts[0], 'b');
    expect(run.startPoint?.x).toBeCloseTo(port.x, 5);
    expect(run.startPoint?.y).toBeCloseTo(port.y, 5);
    const art = flexArtwork(parts[1].flexPath!, start, end);
    expect(art.beds.length).toBe(1);
    expect(art.rails.length).toBe(0);
    expect(art.outline).toBeUndefined();
    const runArt = flexRunArtwork(run.paths, run.startTravel, run.endTravel, run.startPoint, run.endPoint);
    expect(runArt.fill).toContain('Z');
    expect(runArt.bed.length).toBeGreaterThan(8);
    expect(runArt.seams.length).toBe(1);
    const slices = flexRunSlices(run.paths, start, end, run.startPoint, run.endPoint);
    expect(slices.length).toBe(2);
    const joint = slices[0][slices[0].length - 1];
    expect(distance(joint, slices[1][0])).toBeLessThan(0.05);
  });
});
