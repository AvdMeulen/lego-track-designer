import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { attachPart, CURVE_ANGLE, CURVE_RADIUS, curveSector, headingDelta, portsConnect, worldPort } from './geometry';

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
});
