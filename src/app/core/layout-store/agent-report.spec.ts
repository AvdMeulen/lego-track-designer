import { DEFAULT_PREFERENCES } from '../../shared/models/track';
import { emptyLayout } from '../layout-engine/generate';
import { buildAgentReport, layoutEnvelope } from './agent-report';

describe('agent layout report', () => {
  it('summarizes a closed loop and bounding box', () => {
    const layout = {
      ...emptyLayout(),
      parts: [
        { instanceId: 'a', partId: 'straight-16', label: 1, x: 10, y: 20, rotation: 0 },
        { instanceId: 'b', partId: 'flex-track', label: 2, x: 40, y: 80, rotation: 0 },
        { instanceId: 'c', partId: 'switch-left', label: 3, x: 12, y: 22, rotation: 0 },
      ],
      unusedInventory: [{ partId: 'curve-22', quantity: 4 }],
      parkingSpots: [
        { id: 'park-1', endInstanceId: 'sid1', clearLengthStuds: 32 },
      ],
      unfinishedPorts: 1,
      notes: ['note.fewerParking'],
      score: { ...emptyLayout().score, total: -120, routeBonus: 2 },
      message: 'layout.organicLoop',
    };
    const report = buildAgentReport({
      seed: 90,
      status: 'ready',
      preferences: { ...DEFAULT_PREFERENCES, targetParkingSpots: 2 },
      layout,
    });
    expect(report.seed).toBe(90);
    expect(report.loop).toBeTrue();
    expect(report.cycles).toBe(2);
    expect(report.parkingFound).toBe(1);
    expect(report.parkingTarget).toBe(2);
    expect(report.flex).toBe(1);
    expect(report.switches).toBe(1);
    expect(report.unused['curve-22']).toBe(4);
    expect(report.collection).toEqual({});
    expect(report.room.vertices).toBe(0);
    expect(report.envelope).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 80 });
  });

  it('uses flex path points for the envelope', () => {
    expect(
      layoutEnvelope([
        {
          instanceId: 'f',
          partId: 'flex-track',
          label: 1,
          x: 0,
          y: 0,
          rotation: 0,
          flexPath: [
            { x: -4.2, y: 10 },
            { x: 18.8, y: 40.4 },
          ],
        },
      ]),
    ).toEqual({ minX: -4.2, minY: 10, maxX: 18.8, maxY: 40.4 });
  });
});
