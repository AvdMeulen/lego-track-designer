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
});
