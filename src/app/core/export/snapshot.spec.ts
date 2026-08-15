import { DEFAULT_PREFERENCES } from '../../shared/models/track';
import { emptyLayout } from '../layout-engine/generate';
import { buildSnapshot, parseSnapshot, parseSnapshotText, SNAPSHOT_KIND } from './snapshot';

describe('designer snapshot', () => {
  const sample = buildSnapshot({
    seed: 4,
    preferences: { ...DEFAULT_PREFERENCES, targetParkingSpots: 1 },
    inventory: [
      { partId: 'curve-22', quantity: 16 },
      { partId: 'straight-16', quantity: 8 },
    ],
    layout: {
      ...emptyLayout(),
      parts: [{ instanceId: 'p1', partId: 'straight-16', label: 1, x: 0, y: 0, rotation: 0 }],
      unusedInventory: [{ partId: 'curve-22', quantity: 16 }],
      score: { ...emptyLayout().score, routeBonus: 1, piecesUsed: 1 },
      message: 'layout.roundedLoop',
    },
  });

  it('round-trips inventory, seed, and a compact summary', () => {
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(sample)));
    expect(parsed?.kind).toBe(SNAPSHOT_KIND);
    expect(parsed?.seed).toBe(4);
    expect(parsed?.inventory).toEqual([
      { partId: 'curve-22', quantity: 16 },
      { partId: 'straight-16', quantity: 8 },
    ]);
    expect(parsed?.summary.loop).toBeTrue();
    expect(parsed?.summary.used['straight-16']).toBe(1);
    expect(parsed?.summary.unused['curve-22']).toBe(16);
  });

  it('rejects unrelated JSON', () => {
    expect(parseSnapshot({ foo: 1 })).toBeNull();
    expect(parseSnapshotText('not json')).toBeNull();
  });

  it('imports inventory when the layout is missing', () => {
    const parsed = parseSnapshot({
      kind: SNAPSHOT_KIND,
      version: 1,
      seed: 2,
      inventory: [{ partId: 'switch-left', quantity: 2 }],
    });
    expect(parsed?.inventory).toEqual([{ partId: 'switch-left', quantity: 2 }]);
    expect(parsed?.layout.parts.length).toBe(0);
  });
});
