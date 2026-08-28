import { FloorPlan, FloorShape, parseFloorPlan } from '../../shared/models/floor-plan';
import { InventoryItem, Point } from '../../shared/models/track';
import { parseSnapshot, parseSnapshotText } from '../export/snapshot';
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { AGENT_EVAL_SCENE, agentEvalScene } from './agent-scene';

export type AgentSceneId = typeof AGENT_EVAL_SCENE;

export interface AgentSetupInput {
  scene?: AgentSceneId;
  inventory?: Record<string, number> | InventoryItem[];
  floorPlan?: unknown;
  snapshot?: unknown;
  parking?: 0 | 1 | 2;
}

export interface AgentGenerateOptions extends AgentSetupInput {
  seed?: number;
}

export interface AppliedAgentSetup {
  inventory?: InventoryItem[];
  floorPlan?: FloorPlan;
  parking?: 0 | 1 | 2;
}

export function parseAgentScene(raw: string | null): AgentSceneId | null {
  if (raw?.trim().toLowerCase() === AGENT_EVAL_SCENE) {
    return AGENT_EVAL_SCENE;
  }
  return null;
}

export function normalizeAgentInventory(raw: Record<string, number> | InventoryItem[]): InventoryItem[] {
  const counts = new Map<string, number>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item?.partId === 'string') {
        counts.set(item.partId, (counts.get(item.partId) ?? 0) + Math.max(0, Math.floor(Number(item.quantity) || 0)));
      }
    }
  } else {
    for (const [partId, quantity] of Object.entries(raw)) {
      counts.set(partId, Math.max(0, Math.floor(Number(quantity) || 0)));
    }
  }
  return [...counts.entries()]
    .filter(([partId, quantity]) => quantity > 0 && partId in CITY_TRACKS_BY_ID)
    .map(([partId, quantity]) => ({ partId, quantity }))
    .sort((a, b) => a.partId.localeCompare(b.partId));
}

export function parseAgentFloorPlan(raw: unknown): FloorPlan | null {
  const full = parseFloorPlan(raw);
  if (full) {
    return full;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as { outer?: unknown; obstacles?: unknown };
  const outerPoints = parsePoints(value.outer);
  if (!outerPoints) {
    return null;
  }
  const obstacles = Array.isArray(value.obstacles)
    ? value.obstacles
        .map((item, index) => parseObstacle(item, index))
        .filter((shape): shape is FloorShape => !!shape)
    : [];
  return {
    id: 'room-agent',
    name: 'Room',
    outer: { id: 'outer', points: outerPoints },
    obstacles,
  };
}

export function resolveAgentSetup(input: AgentSetupInput): AppliedAgentSetup {
  const applied: AppliedAgentSetup = {};
  if (input.snapshot != null) {
    const parsed =
      typeof input.snapshot === 'string' ? parseSnapshotText(input.snapshot) : parseSnapshot(input.snapshot);
    if (parsed) {
      applied.inventory = parsed.inventory;
      if (parsed.floorPlan) {
        applied.floorPlan = parsed.floorPlan;
      }
      applied.parking = parsed.preferences.targetParkingSpots;
    }
  }
  if (input.scene === AGENT_EVAL_SCENE) {
    const scene = agentEvalScene();
    applied.inventory = scene.inventory;
    applied.floorPlan = scene.floorPlan;
  }
  if (input.inventory) {
    applied.inventory = normalizeAgentInventory(input.inventory);
  }
  if (input.floorPlan != null) {
    const plan = parseAgentFloorPlan(input.floorPlan);
    if (plan) {
      applied.floorPlan = plan;
    }
  }
  if (input.parking != null) {
    applied.parking = input.parking;
  }
  return applied;
}

function parseObstacle(raw: unknown, index: number): FloorShape | null {
  if (Array.isArray(raw)) {
    const points = parsePoints(raw);
    return points ? { id: `obs-${index + 1}`, points } : null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as { id?: unknown; points?: unknown };
  const points = parsePoints(value.points);
  if (!points) {
    return null;
  }
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `obs-${index + 1}`,
    points,
  };
}

function parsePoints(raw: unknown): Point[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const points: Point[] = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2 && Number.isFinite(item[0]) && Number.isFinite(item[1])) {
      points.push({ x: Number(item[0]), y: Number(item[1]) });
      continue;
    }
    if (item && typeof item === 'object') {
      const { x, y } = item as Point;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push({ x: Number(x), y: Number(y) });
      }
    }
  }
  return points.length >= 3 ? points : null;
}
