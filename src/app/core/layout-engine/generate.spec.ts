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
    expect(layout.parts.filter((part) => part.partId === 'flex-track').length).toBe(0);
    expect(layout.score.routeBonus).toBe(0);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBeGreaterThan(0);
    expect(layout.notes.join(' ')).toContain('note.fifteenCurves');
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

  it('creates a parking siding from a switch and a straight', () => {
    const layout = generateLayout(
      [
        { partId: 'switch-left', quantity: 1 },
        { partId: 'straight-16', quantity: 3 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 1 },
      { seed: 4, timeoutMs: 1500 },
    );
    expect(layout.parkingSpots.length).toBeGreaterThan(0);
  });

  it('builds a connected point-to-point route', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 4 },
        { partId: 'curve-22', quantity: 4 },
      ],
      { ...DEFAULT_PREFERENCES, loopPlusParking: false, targetParkingSpots: 0 },
      { seed: 5, timeoutMs: 1500 },
    );
    expect(layout.parts.length).toBeGreaterThanOrEqual(4);
    expect(layout.connections.length).toBeGreaterThan(0);
  });

  it('uses extra curves in a closed loop instead of leaving them unused', () => {
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
    const curves = layout.parts.filter((part) => part.partId === 'curve-22').length;
    const straights = layout.parts.filter((part) => part.partId === 'straight-16').length;
    expect(curves).toBeGreaterThan(16);
    expect(straights).toBe(24);
    expect(layout.unusedInventory.find((item) => item.partId === 'straight-16')).toBeFalsy();
  });

  it('builds a long straight parking siding from a switch', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 16 },
        { partId: 'straight-16', quantity: 16 },
        { partId: 'switch-left', quantity: 1 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 1, preferReversingRoute: false },
      { seed: 1, timeoutMs: 1500 },
    );
    expect(layout.parkingSpots.length).toBeGreaterThan(0);
    expect(Math.max(...layout.parkingSpots.map((spot) => spot.clearLengthStuds))).toBeGreaterThanOrEqual(80);
  });

  it('connects a switch diverge as a second track on a loop', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 16 },
        { partId: 'straight-16', quantity: 8 },
        { partId: 'switch-left', quantity: 1 },
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

  it('still closes after wandering instead of staying rectangular', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 20 },
        { partId: 'curve-22', quantity: 32 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 0, preferReversingRoute: false },
      { seed: 11, timeoutMs: 2000 },
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBeGreaterThan(16);
  });

  it('closes a loop when the straight count is not a multiple of four', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 17 },
        { partId: 'curve-22', quantity: 16 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 0, preferReversingRoute: false },
      { seed: 1, timeoutMs: 1500 },
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBe(16);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
  });

  it('builds a closed loop from a large City collection', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 58 },
        { partId: 'curve-22', quantity: 97 },
        { partId: 'switch-left', quantity: 2 },
        { partId: 'switch-right', quantity: 2 },
        { partId: 'double-crossover', quantity: 1 },
      ],
      DEFAULT_PREFERENCES,
      { seed: 1, timeoutMs: 2500 },
    );
    const curves = layout.parts.filter((part) => part.partId === 'curve-22').length;
    const straights = layout.parts.filter((part) => part.partId === 'straight-16').length;
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(curves).toBeGreaterThan(16);
    expect(straights).toBeGreaterThan(20);
    expect(layout.parts.some((part) => part.partId.startsWith('switch-'))).toBeTrue();
  });

  it('keeps switches apart and only leaves parking ends', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 58 },
        { partId: 'curve-22', quantity: 97 },
        { partId: 'switch-left', quantity: 2 },
        { partId: 'switch-right', quantity: 2 },
        { partId: 'double-crossover', quantity: 1 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 1, preferReversingRoute: true },
      { seed: 14, timeoutMs: 2500 },
    );
    const switchIds = new Set(
      layout.parts.filter((part) => part.partId.startsWith('switch-')).map((part) => part.instanceId),
    );
    const adjacent = layout.connections.some(
      (connection) => switchIds.has(connection.fromInstanceId) && switchIds.has(connection.toInstanceId),
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(adjacent).toBeFalse();
    expect(layout.unfinishedPorts).toBeLessThanOrEqual(4);
    expect(layout.parkingSpots.length).toBeLessThanOrEqual(4);
    expect(Math.max(0, ...layout.parkingSpots.map((spot) => spot.clearLengthStuds))).toBeLessThanOrEqual(96);
  });

  it('does not grow a long diagonal dead-end from a switch', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 58 },
        { partId: 'curve-22', quantity: 97 },
        { partId: 'switch-left', quantity: 2 },
        { partId: 'switch-right', quantity: 2 },
        { partId: 'double-crossover', quantity: 1 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 1, preferReversingRoute: true },
      { seed: 15, timeoutMs: 2500 },
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(Math.max(0, ...layout.parkingSpots.map((spot) => spot.clearLengthStuds))).toBeLessThanOrEqual(96);
    const switchIds = layout.parts.filter((part) => part.partId.startsWith('switch-')).map((part) => part.instanceId);
    const closedDiverges = switchIds.filter((id) =>
      layout.connections.some(
        (connection) =>
          (connection.fromInstanceId === id && connection.fromPortId === 'diverge') ||
          (connection.toInstanceId === id && connection.toPortId === 'diverge'),
      ),
    );
    expect(closedDiverges.length).toBeGreaterThanOrEqual(1);
  });

  it('rejoins switch pairs instead of turning every switch into parking', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 58 },
        { partId: 'curve-22', quantity: 97 },
        { partId: 'switch-left', quantity: 2 },
        { partId: 'switch-right', quantity: 2 },
        { partId: 'double-crossover', quantity: 1 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 1, preferReversingRoute: true, preferMorePieces: true },
      { seed: 17, timeoutMs: 2500 },
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.parkingSpots.length).toBeLessThanOrEqual(2);
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBeGreaterThan(70);
    const unusedCurves = layout.unusedInventory.find((item) => item.partId === 'curve-22')?.quantity ?? 0;
    expect(unusedCurves).toBeLessThan(25);
    const switchIds = layout.parts
      .filter((part) => part.partId.startsWith('switch-'))
      .map((part) => part.instanceId);
    const closedDiverges = switchIds.filter((id) =>
      layout.connections.some(
        (connection) =>
          (connection.fromInstanceId === id && connection.fromPortId === 'diverge') ||
          (connection.toInstanceId === id && connection.toPortId === 'diverge'),
      ),
    );
    expect(closedDiverges.length - layout.parkingSpots.length).toBeGreaterThanOrEqual(1);
  });

  it('uses opposite-curve S-bends instead of only 90-degree corners', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 24 },
        { partId: 'curve-22', quantity: 40 },
      ],
      { ...DEFAULT_PREFERENCES, targetParkingSpots: 0, preferReversingRoute: false },
      { seed: 11, timeoutMs: 2000 },
    );
    const turns: number[] = [];
    for (const connection of layout.connections) {
      const from = layout.parts.find((part) => part.instanceId === connection.fromInstanceId);
      const to = layout.parts.find((part) => part.instanceId === connection.toInstanceId);
      if (from?.partId !== 'curve-22' || to?.partId !== 'curve-22') {
        continue;
      }
      const fromTurn = connection.fromPortId === 'a' ? 1 : -1;
      const toTurn = connection.toPortId === 'b' ? 1 : -1;
      turns.push(fromTurn * toTurn);
    }
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(turns.some((turn) => turn < 0)).toBeTrue();
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
