import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { connectedGroupCount, openPorts } from './connections';
import { worldPorts } from './geometry';
import { GenContext, nextId, rng } from './place';
import { ovalJoin, organicRing, wanderJoin, fillEmptySpace, spliceParallelRun } from './wander';

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

  it('builds a wavy eight-corner loop instead of a two-axis diamond', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(50),
      deadline: Date.now() + 2000,
      seq: 1,
    };
    const ring = organicRing({ 'straight-16': 50, 'curve-22': 81 }, ctx);
    expect(ring).toBeTruthy();
    const straights = ring!.filter((part) => part.partId === 'straight-16');
    const axes = new Set(
      straights.map((part) => Math.round(((((part.rotation % 180) + 180) % 180) / 22.5) % 8)),
    );
    expect(axes.size).toBeGreaterThanOrEqual(3);
  });
});

describe('wanderJoin', () => {
  it('closes two open heads with a mixed inward path', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(3),
      deadline: Date.now() + 2000,
      seq: 1,
    };
    const ring = organicRing({ 'straight-16': 16, 'curve-22': 16 }, ctx);
    expect(ring).toBeTruthy();
    const ports = openPorts(ring!, CITY_TRACKS_BY_ID);
    expect(ports.length).toBe(0);
    const without = ring!.slice(0, -1);
    const heads = openPorts(without, CITY_TRACKS_BY_ID);
    expect(heads.length).toBe(2);
    const joined = wanderJoin(
      without,
      heads[0],
      heads[1],
      { 'straight-16': 24, 'curve-22': 40 },
      ctx,
      'rte',
      'inward',
    );
    expect(joined).toBeTruthy();
    expect(openPorts(joined!, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(joined!.length).toBeGreaterThan(without.length);
  });
});

describe('fillEmptySpace', () => {
  it('spends leftover pieces as an inward detour on a closed oval', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(4),
      deadline: Date.now() + 4000,
      seq: 1,
    };
    const ring = organicRing({ 'straight-16': 24, 'curve-22': 16 }, ctx);
    expect(ring).toBeTruthy();
    const center = {
      x: ring!.reduce((sum, part) => sum + part.x, 0) / ring!.length,
      y: ring!.reduce((sum, part) => sum + part.y, 0) / ring!.length,
    };
    const filled = fillEmptySpace(
      ring!,
      { 'straight-16': 50, 'curve-22': 80 },
      { ...ctx, deadline: Date.now() + 2500 },
      4,
      0,
      center,
    );
    expect(openPorts(filled, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(filled.length).toBeGreaterThanOrEqual(ring!.length);
  });
});

describe('spliceParallelRun', () => {
  it('keeps leftover fill on the same circuit', () => {
    const ctx: GenContext = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(4),
      deadline: Date.now() + 4000,
      seq: 1,
    };
    const ring = organicRing({ 'straight-16': 24, 'curve-22': 16 }, ctx);
    expect(ring).toBeTruthy();
    const filled = spliceParallelRun(
      ring!,
      { 'straight-16': 50, 'curve-22': 80 },
      { ...ctx, deadline: Date.now() + 2500 },
      0,
    );
    expect(openPorts(filled, CITY_TRACKS_BY_ID).length).toBe(0);
    expect(connectedGroupCount(filled, CITY_TRACKS_BY_ID)).toBe(1);
    expect(filled.length).toBeGreaterThanOrEqual(ring!.length);
    expect(filled.every((part) => !part.instanceId.startsWith('in'))).toBeTrue();
  });
});
