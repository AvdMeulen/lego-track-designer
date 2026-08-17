import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { openPorts } from './connections';
import { worldPorts } from './geometry';
import { GenContext, nextId, rng } from './place';
import { ovalJoin, organicRing } from './wander';

describe('ovalJoin', () => {
  it('closes a switch through-route with the reversing-loop balloon', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(1),
      deadline: Date.now() + 2000,
      seq: 1,
    };
    const seeded = {
      instanceId: nextId(ctx, 'sw'),
      partId: 'switch-left',
      label: 1,
      x: 0,
      y: 0,
      rotation: 0,
    };
    const through = worldPorts(CITY_TRACKS_BY_ID['switch-left'], seeded).find((port) => port.id === 'through');
    const stem = worldPorts(CITY_TRACKS_BY_ID['switch-left'], seeded).find((port) => port.id === 'stem');
    expect(through && stem).toBeTruthy();
    const joined = ovalJoin(
      [seeded],
      through!,
      stem!,
      { 'curve-22': 16, 'straight-16': 8 },
      ctx,
      'sw',
    );
    expect(joined).toBeTruthy();
    expect(openPorts(joined!, CITY_TRACKS_BY_ID).some((port) => port.id === 'through')).toBeFalse();
    expect(openPorts(joined!, CITY_TRACKS_BY_ID).some((port) => port.id === 'stem')).toBeFalse();
  });

  it('builds a closed ring that spends a large City collection', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(1),
      deadline: Date.now() + 2000,
      seq: 1,
    };
    const ring = organicRing({ 'straight-16': 50, 'curve-22': 81 }, ctx);
    expect(ring).toBeTruthy();
    expect(openPorts(ring!, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(ring!.length).toBeGreaterThan(40);
  });
});
