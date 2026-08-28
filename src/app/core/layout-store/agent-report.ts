import { APP_VERSION } from '../version';
import { FloorPlan } from '../../shared/models/floor-plan';
import { GenerationPreferences, InventoryItem, PlacedPart, Point, TrackLayout } from '../../shared/models/track';

export type AgentRunStatus = 'idle' | 'generating' | 'ready';

export interface LayoutEnvelope {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface AgentLayoutReport {
  version: string;
  status: AgentRunStatus;
  seed: number;
  parkingTarget: 0 | 1 | 2;
  parkingFound: number;
  unfinishedPorts: number;
  loop: boolean;
  cycles: number;
  score: number;
  parts: number;
  flex: number;
  crossover: number;
  switches: number;
  unused: Record<string, number>;
  collection: Record<string, number>;
  room: { name: string; vertices: number; obstacles: number; envelope: LayoutEnvelope | null };
  notes: string[];
  message?: string;
  reverse: string[];
  marks: string[];
  envelope: LayoutEnvelope | null;
}

export function layoutEnvelope(parts: PlacedPart[]): LayoutEnvelope | null {
  const points: Point[] = [];
  for (const part of parts) {
    if (part.flexPath?.length) {
      points.push(...part.flexPath);
    } else {
      points.push({ x: part.x, y: part.y });
    }
  }
  return pointsEnvelope(points);
}

export function pointsEnvelope(points: Point[]): LayoutEnvelope | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: round1(minX),
    minY: round1(minY),
    maxX: round1(maxX),
    maxY: round1(maxY),
  };
}

export function buildAgentReport(input: {
  seed: number;
  status: AgentRunStatus;
  preferences: GenerationPreferences;
  layout: TrackLayout;
  collection?: InventoryItem[];
  floorPlan?: FloorPlan | null;
}): AgentLayoutReport {
  const { layout } = input;
  const unused = Object.fromEntries(
    layout.unusedInventory
      .filter((item) => item.quantity > 0)
      .map((item) => [item.partId, item.quantity]),
  );
  const collection = Object.fromEntries(
    (input.collection ?? [])
      .filter((item) => item.quantity > 0)
      .map((item) => [item.partId, item.quantity]),
  );
  const floorPlan = input.floorPlan ?? null;
  return {
    version: APP_VERSION,
    status: input.status,
    seed: input.seed,
    parkingTarget: input.preferences.targetParkingSpots,
    parkingFound: layout.parkingSpots.length,
    unfinishedPorts: layout.unfinishedPorts,
    loop: layout.score.routeBonus > 0,
    cycles: layout.score.routeBonus,
    score: layout.score.total,
    parts: layout.parts.length,
    flex: countPart(layout, 'flex-track'),
    crossover: countPart(layout, 'double-crossover'),
    switches: countPart(layout, 'switch-left') + countPart(layout, 'switch-right'),
    unused,
    collection,
    room: {
      name: floorPlan?.name ?? '',
      vertices: floorPlan?.outer.points.length ?? 0,
      obstacles: floorPlan?.obstacles.length ?? 0,
      envelope: floorPlan ? pointsEnvelope(floorPlan.outer.points) : null,
    },
    notes: [...layout.notes],
    message: layout.message,
    reverse: layout.reverseOptions.map((option) => option.kind),
    marks: layout.marks.map((mark) => mark.text),
    envelope: layoutEnvelope(layout.parts),
  };
}

function countPart(layout: TrackLayout, partId: string): number {
  return layout.parts.filter((part) => part.partId === partId).length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
