import { generateLayout, generateLayoutAsync } from './generate';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { placementHitsRoom } from '../floor-plan/space';
import { cmToStuds, defaultFloorPlan } from '../../shared/models/floor-plan';
import { openPorts } from './connections';
import { headingDelta } from './geometry';
import { rectangleEnvelopePenalty, shortSwitchBypassPenalty } from './score';

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
    const layout = generateLayout(LARGE, { targetParkingSpots: 0 }, { seed: 1, timeoutMs: 4000 });
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.parts.some((part) => part.partId.startsWith('switch-'))).toBeTrue();
    expect(layout.parts.some((part) => part.partId === 'double-crossover')).toBeTrue();
    expect(usedOf(layout, 'switch-left') + usedOf(layout, 'switch-right')).toBe(0);
    expect(usedOf(layout, 'double-crossover')).toBe(0);
    expect(usedOf(layout, 'straight-16') + usedOf(layout, 'curve-22')).toBeLessThan(60);
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
    const layout = generateLayout(LARGE, { targetParkingSpots: 1 }, { seed: 30, timeoutMs: 3500 });
    expect(layout.parkingSpots.length).toBe(1);
    expect(layout.parkingSpots[0].clearLengthStuds).toBeLessThanOrEqual(16 * 10);
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.parts.filter((part) => part.partId.startsWith('switch-')).length).toBeGreaterThanOrEqual(1);
    expect(usedOf(layout, 'straight-16') + usedOf(layout, 'curve-22')).toBeLessThan(60);
  });

  it('grows a large City collection as a wander, tree, or wavy loop, not a four-sided diamond', () => {
    const layout = generateLayout(LARGE, { targetParkingSpots: 0 }, { seed: 50, timeoutMs: 4000 });
    const grown = layout.parts.filter((part) =>
      ['w', 't', 'br'].some((prefix) => part.instanceId.startsWith(prefix)),
    ).length;
    const straights = layout.parts.filter(
      (part) => part.partId === 'straight-16' && !part.instanceId.startsWith('sid'),
    );
    const axes = new Set(
      straights.map((part) => Math.round(((((part.rotation % 180) + 180) % 180) / 22.5) % 8)),
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.unfinishedPorts).toBe(0);
    expect(grown > 24 || axes.size >= 3).toBeTrue();
  });

  it('draws a curve-heavy collection as a wandering line, not two runways', () => {
    const layout = generateLayout(LARGE, { targetParkingSpots: 1 }, { seed: 38, timeoutMs: 3500 });
    const curves = layout.parts.filter((part) => part.partId === 'curve-22').length;
    const straights = layout.parts.filter((part) => part.partId === 'straight-16').length;
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(curves).toBeGreaterThan(straights);
    expect(usedOf(layout, 'curve-22')).toBeLessThan(45);
  });

  it('grows feature circuits as mixed shapes, including inward', () => {
    const layout = generateLayout(LARGE, { targetParkingSpots: 0 }, { seed: 42, timeoutMs: 4000 });
    const feature = layout.parts.filter(
      (part) =>
        (part.instanceId.startsWith('rte') ||
          part.instanceId.startsWith('xo') ||
          part.instanceId.startsWith('par') ||
          part.instanceId.startsWith('br')) &&
        (part.partId === 'curve-22' || part.partId === 'straight-16'),
    );
    const core = layout.parts.filter(
      (part) =>
        part.instanceId.startsWith('p') ||
        part.instanceId.startsWith('w') ||
        part.instanceId.startsWith('t'),
    );
    const center = {
      x: core.reduce((sum, part) => sum + part.x, 0) / Math.max(1, core.length),
      y: core.reduce((sum, part) => sum + part.y, 0) / Math.max(1, core.length),
    };
    const switches = layout.parts.filter((part) => part.partId.startsWith('switch-'));
    const switchRadius =
      switches.reduce((sum, part) => sum + Math.hypot(part.x - center.x, part.y - center.y), 0) /
      Math.max(1, switches.length);
    const inward = feature.some(
      (part) => Math.hypot(part.x - center.x, part.y - center.y) < switchRadius - 10,
    );
    let sBend = false;
    const curveIds = new Set(
      feature.filter((part) => part.partId === 'curve-22').map((part) => part.instanceId),
    );
    for (const connection of layout.connections) {
      if (!curveIds.has(connection.fromInstanceId) || !curveIds.has(connection.toInstanceId)) {
        continue;
      }
      const fromTurn = connection.fromPortId === 'a' ? 1 : -1;
      const toTurn = connection.toPortId === 'b' ? 1 : -1;
      if (fromTurn * toTurn < 0) {
        sBend = true;
      }
    }
    const featureStraights = feature.filter((part) => part.partId === 'straight-16');
    const nonCardinal = featureStraights.some(
      (part) => ![0, 90, 180, 270].some((heading) => headingDelta(part.rotation, heading) < 8),
    );
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.parts.filter((part) => part.partId.startsWith('switch-')).length).toBe(4);
    expect(layout.parts.some((part) => part.partId === 'double-crossover')).toBeTrue();
    expect(feature.length).toBeGreaterThan(8);
    expect(sBend || inward || nonCardinal).toBeTrue();
    expect(shortSwitchBypassPenalty(layout)).toBe(0);
  });

  it('keeps leftover track on the circuit instead of two tiny ovals', () => {
    const layout = generateLayout(LARGE, { targetParkingSpots: 1 }, { seed: 31, timeoutMs: 3500 });
    expect(layout.parkingSpots.length).toBe(1);
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.parts.length).toBeGreaterThan(80);
    expect(usedOf(layout, 'straight-16') + usedOf(layout, 'curve-22')).toBeLessThan(75);
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

  it('changes the layout when asked for another seed', () => {
    const items = [
      { partId: 'straight-16', quantity: 24 },
      { partId: 'curve-22', quantity: 40 },
    ];
    const first = generateLayout(items, { targetParkingSpots: 0 }, { seed: 1, timeoutMs: 1500 });
    const second = generateLayout(items, { targetParkingSpots: 0 }, {
      seed: 2,
      timeoutMs: 1500,
      previous: first.parts,
    });
    const pose = (parts: { partId: string; x: number; y: number; rotation: number }[]) =>
      parts
        .map((part) => `${part.partId}:${Math.round(part.x)}:${Math.round(part.y)}:${Math.round(part.rotation)}`)
        .sort()
        .join('|');
    expect(first.parts.length).toBeGreaterThan(16);
    expect(second.parts.length).toBeGreaterThan(16);
    expect(pose(second.parts)).not.toBe(pose(first.parts));
  });

  it('emits pipeline phases during an async run', async () => {
    const phases: string[] = [];
    const layout = await generateLayoutAsync(
      [{ partId: 'curve-22', quantity: 16 }],
      { targetParkingSpots: 0 },
      {
        seed: 1,
        timeoutMs: 1500,
        onPhase: (snapshot) => {
          phases.push(snapshot.phase);
          expect(snapshot.layout.parts.length).toBeGreaterThan(0);
        },
      },
    );
    expect(phases[0]).toBe('core');
    expect(phases).toContain('candidate');
    expect(phases[phases.length - 1]).toBe('done');
    expect(layout.parts.filter((part) => part.partId === 'curve-22').length).toBe(16);
  });

  it('keeps generated track inside a rectangular room', () => {
    const room = defaultFloorPlan();
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 16 },
        { partId: 'straight-16', quantity: 8 },
      ],
      { targetParkingSpots: 0 },
      { seed: 1, timeoutMs: 2000, floorPlan: room },
    );
    expect(layout.parts.length).toBeGreaterThan(0);
    for (const part of layout.parts) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, room)).toBeFalse();
    }
  });

  it('does not run track through a furniture obstacle', () => {
    const room = defaultFloorPlan();
    const plan = {
      ...room,
      obstacles: [
        {
          id: 'obs-1',
          points: [
            { x: cmToStuds(140), y: cmToStuds(90) },
            { x: cmToStuds(260), y: cmToStuds(90) },
            { x: cmToStuds(260), y: cmToStuds(210) },
            { x: cmToStuds(140), y: cmToStuds(210) },
          ],
        },
      ],
    };
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 24 },
        { partId: 'straight-16', quantity: 16 },
      ],
      { targetParkingSpots: 0 },
      { seed: 3, timeoutMs: 2500, floorPlan: plan },
    );
    expect(layout.parts.length).toBeGreaterThan(0);
    for (const part of layout.parts) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, plan)).toBeFalse();
    }
  });

  it('stays inside an L-shaped outer wall', () => {
    const width = cmToStuds(400);
    const height = cmToStuds(300);
    const plan = {
      ...defaultFloorPlan(),
      outer: {
        id: 'outer',
        points: [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height / 2 },
          { x: width / 2, y: height / 2 },
          { x: width / 2, y: height },
          { x: 0, y: height },
        ],
      },
    };
    const layout = generateLayout(
      [
        { partId: 'curve-22', quantity: 20 },
        { partId: 'straight-16', quantity: 12 },
      ],
      { targetParkingSpots: 0 },
      { seed: 2, timeoutMs: 2500, floorPlan: plan },
    );
    expect(layout.parts.length).toBeGreaterThan(0);
    for (const part of layout.parts) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, plan)).toBeFalse();
    }
  });

  it('fills both arms of an L-shaped room instead of a tiny oval', () => {
    const plan = {
      ...defaultFloorPlan(),
      outer: {
        id: 'outer',
        points: [
          { x: -28.6, y: 218.7 },
          { x: 227.2, y: 218.7 },
          { x: 227.2, y: 304 },
          { x: 329.8, y: 304 },
          { x: 329.8, y: 419.9 },
          { x: -28.6, y: 419.9 },
        ],
      },
    };
    const layout = generateLayout(LARGE, { targetParkingSpots: 0 }, {
      seed: 61,
      timeoutMs: 4000,
      floorPlan: plan,
    });
    const xs = layout.parts.map((part) => part.x);
    expect(layout.parts.length).toBeGreaterThan(28);
    expect(layout.parkingSpots.length).toBe(0);
    expect(layout.unfinishedPorts).toBeLessThanOrEqual(2);
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
    expect(layout.parts.some((part) => part.x > 220) || layout.parts.some((part) => part.y < 300)).toBeTrue();
    expect(usedOf(layout, 'straight-16') + usedOf(layout, 'curve-22')).toBeLessThan(125);
    for (const part of layout.parts) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, plan)).toBeFalse();
    }
  });

  it('closes an L-room circuit instead of leaving switch stubs open', () => {
    const plan = {
      ...defaultFloorPlan(),
      outer: {
        id: 'outer',
        points: [
          { x: -76.15, y: 128.99 },
          { x: 227.21, y: 128.99 },
          { x: 227.21, y: 264.52 },
          { x: 329.79, y: 264.52 },
          { x: 329.79, y: 419.94 },
          { x: -76.15, y: 419.94 },
        ],
      },
    };
    const layout = generateLayout([...LARGE, { partId: 'flex-track', quantity: 4 }], { targetParkingSpots: 0 }, {
      seed: 66,
      timeoutMs: 4000,
      floorPlan: plan,
    });
    const xs = layout.parts.map((part) => part.x);
    expect(layout.parkingSpots.length).toBe(0);
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.parts.some((part) => part.partId === 'flex-track')).toBeTrue();
    expect(layout.score.routeBonus).toBeGreaterThan(0);
    expect(layout.parts.length).toBeGreaterThan(40);
    expect(usedOf(layout, 'straight-16') + usedOf(layout, 'curve-22')).toBeLessThan(90);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(180);
    expect(layout.parts.some((part) => part.x > 220)).toBeTrue();
    for (const part of layout.parts) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, plan)).toBeFalse();
    }
  });

  it('does not label a passing pair in an L-room as a keerlus', () => {
    const plan = {
      ...defaultFloorPlan(),
      outer: {
        id: 'outer',
        points: [
          { x: -163.6, y: 93.8 },
          { x: 227.2, y: 93.8 },
          { x: 227.2, y: 264.5 },
          { x: 329.8, y: 264.5 },
          { x: 329.8, y: 419.9 },
          { x: -163.6, y: 419.9 },
        ],
      },
      obstacles: [
        {
          id: 'obs-1',
          points: [
            { x: -4.8, y: 197.7 },
            { x: 120.2, y: 197.7 },
            { x: 120.2, y: 298.0 },
            { x: -4.8, y: 298.0 },
          ],
        },
      ],
    };
    const layout = generateLayout([...LARGE, { partId: 'flex-track', quantity: 12 }], { targetParkingSpots: 0 }, {
      seed: 68,
      timeoutMs: 5500,
      floorPlan: plan,
    });
    expect(layout.unfinishedPorts).toBe(0);
    expect(layout.parkingSpots.length).toBe(0);
    expect(layout.reverseOptions.some((option) => option.kind === 'reversing-loop')).toBeFalse();
    expect(layout.marks.some((mark) => mark.kind === 'reverse')).toBeFalse();
    expect(usedOf(layout, 'straight-16') + usedOf(layout, 'curve-22')).toBeLessThan(40);
    for (const part of layout.parts) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, plan)).toBeFalse();
    }
  });
});
