import { Point } from './track';

export const FLOOR_PLAN_STORAGE_KEY = 'lego-track-designer.floorplan.v1';
export const MM_PER_STUD = 8;
export const CM_PER_STUD = 0.8;

export interface FloorShape {
  id: string;
  points: Point[];
}

export interface FloorPlan {
  id: string;
  name: string;
  outer: FloorShape;
  obstacles: FloorShape[];
}

export interface PersistedFloorPlans {
  activeId: string;
  plans: FloorPlan[];
}

export function cmToStuds(cm: number): number {
  return cm / CM_PER_STUD;
}

export function studsToCm(studs: number): number {
  return studs * CM_PER_STUD;
}

export function formatLengthCm(studs: number): string {
  const cm = studsToCm(Math.abs(studs));
  const rounded = Math.round(cm * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} cm` : `${rounded.toFixed(1)} cm`;
}

export function defaultFloorPlan(): FloorPlan {
  const width = cmToStuds(400);
  const height = cmToStuds(300);
  return {
    id: 'room-default',
    name: 'Room',
    outer: {
      id: 'outer',
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
    },
    obstacles: [],
  };
}

export function cloneFloorPlan(plan: FloorPlan): FloorPlan {
  return {
    id: plan.id,
    name: plan.name,
    outer: cloneShape(plan.outer),
    obstacles: plan.obstacles.map(cloneShape),
  };
}

export function cloneShape(shape: FloorShape): FloorShape {
  return {
    id: shape.id,
    points: shape.points.map((point) => ({ x: point.x, y: point.y })),
  };
}

export function allFloorShapes(plan: FloorPlan): FloorShape[] {
  return [plan.outer, ...plan.obstacles];
}

export function parseFloorPlan(raw: unknown): FloorPlan | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<FloorPlan>;
  const outer = parseShape(value.outer);
  if (!outer || outer.points.length < 3) {
    return null;
  }
  const obstacles = Array.isArray(value.obstacles)
    ? value.obstacles.map(parseShape).filter((shape): shape is FloorShape => !!shape && shape.points.length >= 3)
    : [];
  return {
    id: typeof value.id === 'string' && value.id ? value.id : 'room-default',
    name: typeof value.name === 'string' && value.name ? value.name : 'Room',
    outer: { ...outer, id: 'outer' },
    obstacles,
  };
}

export function parsePersistedFloorPlans(raw: unknown): PersistedFloorPlans | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<PersistedFloorPlans>;
  if (Array.isArray(value.plans)) {
    const plans = value.plans.map(parseFloorPlan).filter((plan): plan is FloorPlan => !!plan);
    if (!plans.length) {
      return null;
    }
    const activeId =
      typeof value.activeId === 'string' && plans.some((plan) => plan.id === value.activeId)
        ? value.activeId
        : plans[0].id;
    return { activeId, plans };
  }
  const single = parseFloorPlan(raw);
  return single ? { activeId: single.id, plans: [single] } : null;
}

function parseShape(raw: unknown): FloorShape | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<FloorShape>;
  if (!Array.isArray(value.points) || value.points.length < 3) {
    return null;
  }
  const points = value.points
    .map((point) => {
      if (!point || typeof point !== 'object') {
        return null;
      }
      const { x, y } = point as Point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return { x: Number(x), y: Number(y) };
    })
    .filter((point): point is Point => !!point);
  if (points.length < 3) {
    return null;
  }
  return {
    id: typeof value.id === 'string' && value.id ? value.id : 'shape',
    points,
  };
}
