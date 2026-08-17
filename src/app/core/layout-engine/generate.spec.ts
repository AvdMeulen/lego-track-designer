import { generateLayout } from './generate';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { openPorts } from './connections';
import { rectangleEnvelopePenalty } from './score';

const LARGE = [
  { partId: 'straight-16', quantity: 58 },
  { partId: 'curve-22', quantity: 97 },
  { partId: 'switch-left', quantity: 2 },
  { partId: 'switch-right', quantity: 2 },
  { partId: 'double-crossover', quantity: 1 },
];

function usedOf(layout: { unusedInventory: { partId: string; quantity: number }[] }, partId: string): number {
  return layout.unusedInventory.find((item) => item.partId === partId)?.quantity ?? 0;
}

function switchPortsUsed(
  layout: {
    parts: { instanceId: string; partId: string }[];
    connections: {
      fromInstanceId: string;
      fromPortId: string;
      toInstanceId: string;
      toPortId: string;
    }[];
  },
  instanceId: string,
): Set<string> {
  const used = new Set<string>();
  for (const connection of layout.connections) {
    if (connection.fromInstanceId === instanceId) {
      used.add(connection.fromPortId);
    }
    if (connection.toInstanceId === instanceId) {
      used.add(connection.toPortId);
    }
  }
  return used;
}

describe('generateLayout', () => {
  it('builds a circle from 16 curves without flex', () => {
    const layout = generateLayout([{ partId: 'curve-22', quantity: 16 }], { targetParkingSpots: 0 }, {
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
      { targetParkingSpots: 0 },
      { seed: 2, timeoutMs: 1500 },
    );
    expect(layout.parts.filter((part) => part.partId === 'flex-track').length).toBe(0);
    expect(layout.score.routeBonus).toBe(0);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBeGreaterThan(0);
    expect(layout.notes.join(' ')).toContain('note.fifteenCurves');
  });

  it('never uses more pieces than inventory', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 20 },
        { partId: 'straight-16', quantity: 10 },
      ],
      { targetParkingSpots: 0 },
      { seed: 3, timeoutMs: 1500 },
    );
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBeLessThanOrEqual(20);
    expect(layout.parts.filter((part) => part.partId === 'straight-16').length).toBeLessThanOrEqual(10);
  });

  it('uses 8 curves and 8 straights as a connected network', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 8 },
        { partId: 'straight-16', quantity: 8 },
      ],
      { targetParkingSpots: 0 },
      { seed: 3, timeoutMs: 1500 },
    );
    expect(layout.parts.length).toBeGreaterThanOrEqual(8);
    expect(layout.connections.length).toBeGreaterThan(0);
  });

  it('creates a parking siding from a switch when parking is requested', () => {
    const layout = generateLayout(
      [
        { partId: 'switch-left', quantity: 1 },
        { partId: 'straight-16', quantity: 8 },
        { partId: 'curve-22', quantity: 16 },
      ],
      { targetParkingSpots: 1 },
      { seed: 4, timeoutMs: 2000 },
    );
    expect(layout.parts.some((part) => part.partId === 'switch-left')).toBeTrue();
    expect(layout.parkingSpots.length).toBe(1);
    expect(layout.unfinishedPorts).toBe(0);
  });

  it('uses extra curves in a closed loop instead of leaving them unused', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 24 },
        { partId: 'straight-16', quantity: 24 },
      ],
      { targetParkingSpots: 0 },
      { seed: 1, timeoutMs: 2000 },
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBeGreaterThan(16);
    expect(usedOf(layout, 'straight-16')).toBe(0);
  });

  it('closes a loop when the straight count is not a multiple of four', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 17 },
        { partId: 'curve-22', quantity: 16 },
      ],
      { targetParkingSpots: 0 },
      { seed: 1, timeoutMs: 1500 },
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(openPorts(layout.parts, CITY_TRACKS_BY_ID).length).toBe(0);
  });

  it('connects through and diverge on a non-parking switch', () => {
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 32 },
        { partId: 'straight-16', quantity: 16 },
        { partId: 'switch-left', quantity: 1 },
        { partId: 'switch-right', quantity: 1 },
      ],
      { targetParkingSpots: 0 },
      { seed: 7, timeoutMs: 2500 },
    );
    const switches = layout.parts.filter((part) => part.partId.startsWith('switch-'));
    expect(switches.length).toBe(2);
    for (const sw of switches) {
      const used = switchPortsUsed(layout, sw.instanceId);
      expect(used.has('through')).toBeTrue();
      expect(used.has('diverge')).toBeTrue();
    }
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.score.routeBonus).toBeGreaterThan(0);
  });

  it('uses opposite-curve S-bends instead of only 90-degree corners', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 24 },
        { partId: 'curve-22', quantity: 40 },
      ],
      { targetParkingSpots: 0 },
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

  it('places a double crossover and closes its ports when possible', () => {
    const layout = generateLayout(
      [
        { partId: 'double-crossover', quantity: 1 },
        { partId: 'straight-16', quantity: 20 },
        { partId: 'curve-22', quantity: 32 },
      ],
      { targetParkingSpots: 0 },
      { seed: 6, timeoutMs: 2500 },
    );
    expect(layout.parts.some((part) => part.partId === 'double-crossover')).toBeTrue();
  });

  it('uses specials from a large City collection and stays off a four-sided box', () => {
    const layout = generateLayout(LARGE, { targetParkingSpots: 0 }, { seed: 1, timeoutMs: 3000 });
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.parts.some((part) => part.partId.startsWith('switch-'))).toBeTrue();
    expect(layout.parts.some((part) => part.partId === 'double-crossover')).toBeTrue();
    expect(usedOf(layout, 'switch-left') + usedOf(layout, 'switch-right')).toBe(0);
    expect(usedOf(layout, 'double-crossover')).toBe(0);
    expect(usedOf(layout, 'straight-16') + usedOf(layout, 'curve-22')).toBeLessThan(24);
    expect(rectangleEnvelopePenalty(layout.parts)).toBe(0);
  });

  it('matches parking count and leaves only parking ends unfinished', () => {
    const layout = generateLayout(LARGE, { targetParkingSpots: 1 }, { seed: 14, timeoutMs: 3000 });
    expect(layout.parkingSpots.length).toBe(1);
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.parkingSpots[0].clearLengthStuds).toBeLessThanOrEqual(16 * 10);
    const switches = layout.parts.filter((part) => part.partId.startsWith('switch-'));
    const parkingSwitch = layout.parkingSpots[0]?.switchInstanceId;
    for (const sw of switches) {
      const used = switchPortsUsed(layout, sw.instanceId);
      expect(used.has('through')).toBeTrue();
      if (sw.instanceId !== parkingSwitch) {
        expect(used.has('diverge')).toBeTrue();
      }
    }
  });

  it('does not dump leftover straights onto a parking runway', () => {
    const layout = generateLayout(LARGE, { targetParkingSpots: 1 }, { seed: 30, timeoutMs: 3000 });
    expect(layout.parkingSpots.length).toBe(1);
    expect(layout.parkingSpots[0].clearLengthStuds).toBeLessThanOrEqual(16 * 10);
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.parts.filter((part) => part.partId.startsWith('switch-')).length).toBeGreaterThanOrEqual(1);
  });

  it('builds more than one cycle when two route switches are available', () => {
    const layout = generateLayout(
      [
        { partId: 'straight-16', quantity: 30 },
        { partId: 'curve-22', quantity: 48 },
        { partId: 'switch-left', quantity: 1 },
        { partId: 'switch-right', quantity: 1 },
      ],
      { targetParkingSpots: 0 },
      { seed: 9, timeoutMs: 2500 },
    );
    const cycles = Math.max(0, layout.connections.length - layout.parts.length + 1);
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(cycles).toBeGreaterThanOrEqual(2);
  });
});
