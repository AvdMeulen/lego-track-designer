import {
  cmToStuds,
  defaultFloorPlan,
  formatLengthCm,
  parseFloorPlan,
  parsePersistedFloorPlans,
  studsToCm,
} from '../../shared/models/floor-plan';
import {
  hitTestFloor,
  insertVertex,
  placementHitsRoom,
  pointInPolygon,
  removeVertex,
  seedInsideFloor,
  wallWaypoints,
} from './space';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';

describe('floor plan units', () => {
  it('converts centimetres and studs', () => {
    expect(cmToStuds(0.8)).toBeCloseTo(1);
    expect(studsToCm(16)).toBeCloseTo(12.8);
    expect(formatLengthCm(16)).toBe('12.8 cm');
    expect(formatLengthCm(cmToStuds(400))).toBe('400 cm');
  });
});

describe('floor plan parse', () => {
  it('round-trips a default room', () => {
    const parsed = parseFloorPlan(JSON.parse(JSON.stringify(defaultFloorPlan())));
    expect(parsed?.outer.points.length).toBe(4);
    expect(parsed?.obstacles.length).toBe(0);
  });

  it('rejects a two-point obstacle', () => {
    const parsed = parseFloorPlan({
      id: 'r',
      name: 'Room',
      outer: defaultFloorPlan().outer,
      obstacles: [{ id: 'obs-1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    });
    expect(parsed?.obstacles.length).toBe(0);
  });

  it('reads a persisted list', () => {
    const saved = parsePersistedFloorPlans({
      activeId: 'room-default',
      plans: [defaultFloorPlan()],
    });
    expect(saved?.activeId).toBe('room-default');
    expect(saved?.plans.length).toBe(1);
  });
});

describe('floor space', () => {
  const room = defaultFloorPlan();

  it('keeps points inside the outer wall', () => {
    expect(pointInPolygon({ x: 10, y: 10 }, room.outer.points)).toBeTrue();
    expect(pointInPolygon({ x: -4, y: 10 }, room.outer.points)).toBeFalse();
  });

  it('inserts a vertex on an edge', () => {
    const next = insertVertex(room.outer, 0, { x: cmToStuds(200), y: 0 });
    expect(next.points.length).toBe(5);
  });

  it('refuses to drop the outer wall below three points', () => {
    const triangle = {
      ...room.outer,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 0, y: 40 },
      ],
    };
    expect(removeVertex(triangle, 0)).toBeNull();
  });

  it('rejects a straight that sits outside the room', () => {
    const hits = placementHitsRoom(
      { instanceId: 'p1', partId: 'straight-16', label: 1, x: -80, y: 0, rotation: 0 },
      CITY_TRACKS_BY_ID,
      room,
    );
    expect(hits).toBeTrue();
  });

  it('accepts a straight against the inside of a wall', () => {
    const hits = placementHitsRoom(
      { instanceId: 'p1', partId: 'straight-16', label: 1, x: 20, y: 8, rotation: 0 },
      CITY_TRACKS_BY_ID,
      room,
    );
    expect(hits).toBeFalse();
  });

  it('hits a vertex before an edge', () => {
    const hit = hitTestFloor(room, { x: 0, y: 0 });
    expect(hit?.kind).toBe('vertex');
  });

  it('seeds inside an L along a wall, not in the bounding-box corner', () => {
    const plan = {
      ...defaultFloorPlan(),
      outer: {
        id: 'outer',
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 80 },
          { x: 320, y: 80 },
          { x: 320, y: 200 },
          { x: 0, y: 200 },
        ],
      },
    };
    const seed = seedInsideFloor(plan);
    expect(pointInPolygon(seed, plan.outer.points, false)).toBeTrue();
    expect(seed.x).toBeGreaterThan(10);
    expect(seed.y).toBeGreaterThan(10);
    const waypoints = wallWaypoints(plan);
    expect(waypoints.some((point) => point.x > 220)).toBeTrue();
    expect(waypoints.some((point) => point.y < 40)).toBeTrue();
  });
});
