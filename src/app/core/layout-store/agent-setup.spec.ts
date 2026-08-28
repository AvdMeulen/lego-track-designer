import { DEFAULT_PREFERENCES } from '../../shared/models/track';
import { SNAPSHOT_KIND } from '../export/snapshot';
import { AGENT_EVAL_FLOOR_PLAN, AGENT_EVAL_INVENTORY } from './agent-scene';
import { normalizeAgentInventory, parseAgentFloorPlan, resolveAgentSetup } from './agent-setup';

describe('agent setup', () => {
  it('keeps only catalog parts from a quantity map', () => {
    expect(
      normalizeAgentInventory({
        'straight-16': 58,
        'curve-22': 97,
        'unknown-part': 3,
        'flex-track': 0,
      }),
    ).toEqual([
      { partId: 'curve-22', quantity: 97 },
      { partId: 'straight-16', quantity: 58 },
    ]);
  });

  it('parses a compact L-room', () => {
    const plan = parseAgentFloorPlan({
      outer: [
        [-163.6, 93.8],
        [227.2, 93.8],
        [227.2, 264.5],
        [329.8, 264.5],
        [329.8, 419.9],
        [-163.6, 419.9],
      ],
      obstacles: [
        {
          id: 'obs-1',
          points: [
            [-4.8, 197.7],
            [120.2, 197.7],
            [120.2, 298],
            [-4.8, 298],
          ],
        },
      ],
    });
    expect(plan?.outer.points.length).toBe(6);
    expect(plan?.obstacles[0]?.id).toBe('obs-1');
    expect(plan?.obstacles[0]?.points[2]).toEqual({ x: 120.2, y: 298 });
  });

  it('loads the eval scene, then lets explicit inventory win', () => {
    const applied = resolveAgentSetup({
      scene: 'eval',
      inventory: { 'curve-22': 16 },
      parking: 2,
    });
    expect(applied.floorPlan?.obstacles.length).toBe(AGENT_EVAL_FLOOR_PLAN.obstacles.length);
    expect(applied.inventory).toEqual([{ partId: 'curve-22', quantity: 16 }]);
    expect(applied.parking).toBe(2);
  });

  it('takes room and collection from a snapshot', () => {
    const applied = resolveAgentSetup({
      snapshot: {
        kind: SNAPSHOT_KIND,
        version: 1,
        seed: 4,
        inventory: AGENT_EVAL_INVENTORY,
        floorPlan: AGENT_EVAL_FLOOR_PLAN,
        preferences: { ...DEFAULT_PREFERENCES, targetParkingSpots: 1 },
      },
    });
    expect(applied.inventory?.find((item) => item.partId === 'straight-16')?.quantity).toBe(58);
    expect(applied.floorPlan?.outer.points.length).toBe(6);
    expect(applied.parking).toBe(1);
  });
});
