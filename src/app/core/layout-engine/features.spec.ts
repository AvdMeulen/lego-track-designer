import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { openPorts } from './connections';
import { applyFeatures } from './features';
import { GenContext, rng } from './place';
import { organicRing } from './wander';

describe('applyFeatures passing loop', () => {
  it('joins two switch diverges on a six-straight run', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(1),
      deadline: Date.now() + 2000,
      seq: 1,
    };
    const ring = organicRing({ 'straight-16': 16, 'curve-22': 16 }, ctx);
    expect(ring).toBeTruthy();
    expect(openPorts(ring!, CITY_TRACKS_BY_ID).length).toBe(0);
    const result = applyFeatures(
      ring!,
      {
        'straight-16': 16,
        'curve-22': 32,
        'switch-left': 1,
        'switch-right': 1,
      },
      {
        parking: 0,
        dualRoutes: 1,
        keerlussen: 0,
        crossovers: 0,
        crossings: 0,
        switchCount: 2,
      },
      ctx,
    );
    const switches = result.filter((part) => part.partId.startsWith('switch-'));
    expect(switches.length).toBe(2);
    expect(openPorts(result, CITY_TRACKS_BY_ID).length).toBe(0);
  });

  it('places two passing loops on a large organic ring', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(1),
      deadline: Date.now() + 3000,
      seq: 1,
    };
    const ring = organicRing({ 'straight-16': 46, 'curve-22': 16 }, ctx);
    expect(ring).toBeTruthy();
    const result = applyFeatures(
      ring!,
      {
        'straight-16': 58,
        'curve-22': 97,
        'switch-left': 2,
        'switch-right': 2,
        'double-crossover': 1,
      },
      {
        parking: 0,
        dualRoutes: 2,
        keerlussen: 0,
        crossovers: 1,
        crossings: 0,
        switchCount: 4,
      },
      ctx,
    );
    expect(result.filter((part) => part.partId.startsWith('switch-')).length).toBe(4);
    expect(result.some((part) => part.partId === 'double-crossover')).toBeTrue();
    expect(openPorts(result, CITY_TRACKS_BY_ID).length).toBe(0);
    const detour = result.filter(
      (part) =>
        (part.instanceId.startsWith('rte') || part.instanceId.startsWith('par')) &&
        (part.partId === 'curve-22' || part.partId === 'straight-16'),
    );
    expect(detour.length).toBeGreaterThan(8);
  });
});
