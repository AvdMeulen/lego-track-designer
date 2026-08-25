import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { defaultFloorPlan } from '../../shared/models/floor-plan';
import { placementHitsRoom, wallWaypoints } from '../floor-plan/space';
import { openPorts } from './connections';
import { rng } from './place';
import { closeOpenHeads } from './explore';
import { addInnerLoops, insetVertices, isRectilinear, tracePerimeter } from './perimeter';

const LARGE = {
  'straight-16': 58,
  'curve-22': 97,
  'switch-left': 2,
  'switch-right': 2,
  'double-crossover': 1,
};

const USER_L = {
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

describe('tracePerimeter', () => {
  it('has inset waypoints around the L', () => {
    const waypoints = wallWaypoints(USER_L, 16, 24);
    expect(waypoints.length).toBeGreaterThan(8);
    expect(waypoints.some((point) => point.x > 220)).toBeTrue();
    const seed = {
      instanceId: 't1',
      partId: 'straight-16',
      label: 1,
      x: 80,
      y: 360,
      rotation: 0,
    };
    expect(placementHitsRoom(seed, CITY_TRACKS_BY_ID, USER_L)).toBeFalse();
    expect(isRectilinear(USER_L.outer.points)).toBeTrue();
    const inset = insetVertices(USER_L.outer.points, 16);
    expect(inset.length).toBe(6);
    expect(inset.every((point) => point.y > 128 && point.y < 420)).toBeTrue();
    let longest = 0;
    let mid = inset[0];
    for (let index = 0; index < inset.length; index += 1) {
      const a = inset[index];
      const b = inset[(index + 1) % inset.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length > longest) {
        longest = length;
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
    expect(
      placementHitsRoom(
        { instanceId: 'mid', partId: 'straight-16', label: 1, x: mid.x, y: mid.y, rotation: 0 },
        CITY_TRACKS_BY_ID,
        USER_L,
      ),
    )
      .withContext(`mid=${mid.x.toFixed(1)},${mid.y.toFixed(1)}`)
      .toBeFalse();
  });

  it('walks both arms of an L-shaped room and closes the ring', () => {
    const parts = tracePerimeter(LARGE, {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(66),
      deadline: Date.now() + 2500,
      seq: 0,
      floorPlan: USER_L,
    });
    const xs = parts.map((part) => part.x);
    expect(parts.length).toBeGreaterThan(24);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(180);
    expect(parts.some((part) => part.x > 220)).toBeTrue();
    expect(openPorts(parts, CITY_TRACKS_BY_ID).length).toBeLessThanOrEqual(2);
    for (const part of parts) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, USER_L)).toBeFalse();
    }
  });
});

describe('addInnerLoops', () => {
  it('walks leftover track around a furniture obstacle', () => {
    const plan = {
      ...USER_L,
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
    const ctx = {
      catalog: CITY_TRACKS_BY_ID,
      random: rng(68),
      deadline: Date.now() + 2500,
      seq: 0,
      floorPlan: plan,
    };
    const outer = closeOpenHeads(tracePerimeter(LARGE, ctx), LARGE, { ...ctx, deadline: Date.now() + 2000 }, 0);
    expect(outer.length).toBeGreaterThan(24);
    const filled = addInnerLoops(outer, LARGE, { ...ctx, seq: 200, deadline: Date.now() + 4000 }, 0);
    expect(filled.length).toBeGreaterThan(outer.length + 10);
    expect(openPorts(filled, CITY_TRACKS_BY_ID).length).toBeLessThanOrEqual(
      Math.max(2, openPorts(outer, CITY_TRACKS_BY_ID).length),
    );
    expect(filled.some((part) => part.instanceId.startsWith('in'))).toBeTrue();
    for (const part of filled) {
      expect(placementHitsRoom(part, CITY_TRACKS_BY_ID, plan)).toBeFalse();
    }
  });
});
