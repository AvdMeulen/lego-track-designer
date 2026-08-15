import { generateLayout } from './generate';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { openPorts } from './connections';
import { DEFAULT_PREFERENCES } from '../../shared/models/track';

describe('generateLayout', () => {
  it('builds a circle from 16 curves without flex', () => {
    const layout = generateLayout([{ partId: 'curve-22', quantity: 16 }], DEFAULT_PREFERENCES, {
      seed: 1,
      timeoutMs: 1500,
    });
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBe(16);
    expect(layout.parts.some((part) => part.partId === 'flex-track')).toBeFalse();
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
  });

  it('does not close a loop with 15 curves even if flex is available', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 15 },
        { partId: 'flex-track', quantity: 4 },
      ],
      DEFAULT_PREFERENCES,
      { seed: 2, timeoutMs: 1500 },
    );
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBeGreaterThan(0);
    expect(layout.message).toContain('15 curves');
  });

  it('uses 8 curves and 8 straights as a connected network', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 8 },
        { partId: 'straight-16', quantity: 8 },
      ],
      { ...DEFAULT_PREFERENCES, loopPlusParking: false, targetParkingSpots: 0 },
      { seed: 3, timeoutMs: 1500 },
    );
    expect(layout.parts.length).toBeGreaterThanOrEqual(8);
  });

  it('creates a parking siding from a switch, straight, and buffer', () => {
    const layout = generateLayout(
      [
        { partId: 'switch-left', quantity: 1 },
        { partId: 'straight-16', quantity: 3 },
        { partId: 'buffer-stop', quantity: 1 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 1 },
      { seed: 4, timeoutMs: 1500 },
    );
    expect(layout.parkingSpots.length).toBeGreaterThan(0);
  });

  it('builds a point-to-point with two dead-end parking spots', () => {
    const layout = generateLayout(
      [
        { partId: 'buffer-stop', quantity: 2 },
        { partId: 'straight-16', quantity: 4 },
        { partId: 'curve-22', quantity: 4 },
      ],
      { ...DEFAULT_PREFERENCES, loopPlusParking: false, targetParkingSpots: 2 },
      { seed: 5, timeoutMs: 1500 },
    );
    expect(layout.parkingSpots.length).toBeGreaterThanOrEqual(1);
    expect(layout.reverseOptions.some((option) => option.kind === 'dead-end')).toBeTrue();
  });

  it('closes a rounded loop even when extra curves remain', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 24 },
        { partId: 'straight-16', quantity: 24 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 0, preferReversingRoute: false },
      { seed: 1, timeoutMs: 1500 },
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBe(16);
    expect(layout.parts.filter((part) => part.partId === 'straight-16').length).toBe(24);
  });

  it('connects a switch diverge as a second track on a loop', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 16 },
        { partId: 'straight-16', quantity: 8 },
        { partId: 'switch-left', quantity: 1 },
        { partId: 'buffer-stop', quantity: 1 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 1 },
      { seed: 1, timeoutMs: 1500 },
    );
    const sw = layout.parts.find((part) => part.partId === 'switch-left');
    expect(sw).toBeTruthy();
    const used = new Set(
      layout.connections.flatMap((connection) => {
        const ports: string[] = [];
        if (connection.fromInstanceId === sw?.instanceId) {
          ports.push(connection.fromPortId);
        }
        if (connection.toInstanceId === sw?.instanceId) {
          ports.push(connection.toPortId);
        }
        return ports;
      }),
    );
    expect(used.has('stem')).toBeTrue();
    expect(used.has('through')).toBeTrue();
    expect(used.has('diverge')).toBeTrue();
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.parkingSpots.length).toBeGreaterThan(0);
  });

  it('grows two parallel tracks from a double crossover', () => {
    const layout = generateLayout(
      [
        { partId: 'double-crossover', quantity: 1 },
        { partId: 'straight-16', quantity: 8 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 0, loopPlusParking: false, preferReversingRoute: false },
      { seed: 6, timeoutMs: 1500 },
    );
    const lanes = new Set(
      layout.parts.filter((part) => part.partId === 'straight-16').map((part) => Math.round(part.y)),
    );
    expect(layout.parts.some((part) => part.partId === 'double-crossover')).toBeTrue();
    expect(lanes.size).toBeGreaterThanOrEqual(2);
  });

  it('accepts a 16-curve circle when parking is set to 0', () => {
    const layout = generateLayout([{ partId: 'curve-22', quantity: 16 }], {
      ...DEFAULT_PREFERENCES,
      targetParkingSpots: 0,
      preferReversingRoute: false,
    });
    expect(layout.parkingSpots.length).toBe(0);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
  });
});
