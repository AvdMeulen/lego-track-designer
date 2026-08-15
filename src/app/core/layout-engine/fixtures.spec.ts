import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { openPorts } from './connections';
import { canCloseWithFlex } from './flex-closer';
import {
  circleFixture,
  crossingFixture,
  doubleCrossoverFixture,
  flexGapFixture,
  ovalFixture,
  parkingSidingFixture,
  pointToPointFixture,
  reversingLoopFixture,
  switchFixture,
  wyeFixture,
} from './fixtures';
import { worldPorts } from './geometry';

describe('fixtures', () => {
  it('closes a 16-curve circle', () => {
    const layout = circleFixture();
    expect(layout.parts.length).toBe(16);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.parts.some((part) => part.partId === 'flex-track')).toBeFalse();
  });

  it('closes an oval built from 16 curves and 8 straights', () => {
    const layout = ovalFixture();
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBe(16);
    expect(layout.parts.filter((part) => part.partId === 'straight-16').length).toBe(8);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
  });

  it('places a switch diverge on the City S-curve path', () => {
    const layout = switchFixture('left');
    const sw = layout.parts[0];
    const diverge = worldPorts(CITY_TRACKS_BY_ID['switch-left'], sw).find((port) => port.id === 'diverge');
    const curve = layout.parts.find((part) => part.partId === 'curve-22');
    expect(diverge && curve).toBeTruthy();
  });

  it('models a 90-degree crossing with four independent arms', () => {
    const layout = crossingFixture();
    const ports = worldPorts(CITY_TRACKS_BY_ID['crossing-90'], layout.parts[0]);
    expect(ports.length).toBe(4);
    expect(layout.parts.length).toBe(5);
  });

  it('models the double crossover on 16-stud parallels', () => {
    const layout = doubleCrossoverFixture();
    const ports = worldPorts(CITY_TRACKS_BY_ID['double-crossover'], layout.parts[0]);
    const left = ports.filter((port) => port.x < 0);
    expect(Math.abs(left[0].y - left[1].y)).toBe(16);
    const xs = [...new Set(ports.map((port) => port.x))].sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBe(48);
  });

  it('closes a near-miss gap with one flex piece', () => {
    const layout = flexGapFixture();
    expect(layout.parts.some((part) => part.partId === 'flex-track')).toBeTrue();
  });

  it('refuses flex when the gap is larger than one piece', () => {
    const flex = CITY_TRACKS_BY_ID['flex-track'];
    expect(
      canCloseWithFlex({ x: 0, y: 0, heading: 0 }, { x: 40, y: 0, heading: 180 }, flex),
    ).toBeFalse();
  });

  it('builds a parking siding of at least 16 studs', () => {
    const layout = parkingSidingFixture();
    expect(layout.parkingSpots.some((spot) => spot.clearLengthStuds >= 16)).toBeTrue();
    expect(layout.reverseOptions.some((option) => option.kind === 'dead-end')).toBeTrue();
  });

  it('builds a connected point-to-point run', () => {
    const layout = pointToPointFixture();
    expect(layout.parts.length).toBe(5);
    expect(layout.connections.length).toBe(4);
  });

  it('closes a balloon through a switch as a reversing loop', () => {
    const layout = reversingLoopFixture();
    expect(layout.score.routeBonus).toBeGreaterThan(0);
  });

  it('connects three switches for a wye', () => {
    expect(wyeFixture().parts.filter((part) => part.partId.startsWith('switch-')).length).toBe(3);
  });
});
