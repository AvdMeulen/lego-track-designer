import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { GenContext, rng } from './place';
import { planTopology } from './topology';
import { growStockTree } from './tree';

describe('growStockTree', () => {
  it('spends a curve-heavy collection as more curves than straights', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(4),
      deadline: Date.now() + 2500,
      seq: 1,
    };
    const inventory = {
      'straight-16': 20,
      'curve-22': 48,
      'switch-left': 1,
      'switch-right': 1,
    };
    const grown = growStockTree(inventory, planTopology(inventory, { targetParkingSpots: 0 }), ctx);
    expect(grown).toBeTruthy();
    const curves = grown!.filter((part) => part.partId === 'curve-22').length;
    const straights = grown!.filter((part) => part.partId === 'straight-16').length;
    expect(curves).toBeGreaterThan(straights);
  });

  it('plants a switch and grows a branch from the diverge', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(8),
      deadline: Date.now() + 2500,
      seq: 1,
    };
    const inventory = {
      'straight-16': 30,
      'curve-22': 48,
      'switch-left': 1,
      'switch-right': 1,
    };
    const grown = growStockTree(inventory, planTopology(inventory, { targetParkingSpots: 0 }), ctx);
    expect(grown).toBeTruthy();
    expect(grown!.some((part) => part.partId.startsWith('switch-'))).toBeTrue();
    expect(grown!.some((part) => part.instanceId.startsWith('br'))).toBeTrue();
  });

  it('grows a curve-only path from a small stack', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(1),
      deadline: Date.now() + 2000,
      seq: 1,
    };
    const inventory = { 'curve-22': 16 };
    const grown = growStockTree(inventory, planTopology(inventory, { targetParkingSpots: 0 }), ctx);
    expect(grown).toBeTruthy();
    expect(grown!.filter((part) => part.partId === 'curve-22').length).toBeGreaterThanOrEqual(12);
  });

  it('rejoins branches on a large City mix instead of leaving most pieces unused', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(3),
      deadline: Date.now() + 2500,
      seq: 1,
    };
    const inventory = {
      'straight-16': 58,
      'curve-22': 97,
      'switch-left': 2,
      'switch-right': 2,
      'double-crossover': 1,
    };
    const grown = growStockTree(inventory, planTopology(inventory, { targetParkingSpots: 0 }), ctx);
    expect(grown).toBeTruthy();
    expect(grown!.some((part) => part.partId.startsWith('switch-'))).toBeTrue();
    expect(grown!.some((part) => part.instanceId.startsWith('br'))).toBeTrue();
    const used = grown!.filter((part) => part.partId === 'straight-16' || part.partId === 'curve-22').length;
    expect(used).toBeGreaterThan(70);
  });
});
