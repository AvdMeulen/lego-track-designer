export type PartCategory =
  | 'straight'
  | 'curve'
  | 'switch'
  | 'crossing'
  | 'double-crossover'
  | 'flex';

export interface Point {
  x: number;
  y: number;
}

export interface Port {
  id: string;
  x: number;
  y: number;
  heading: number;
}

export interface FlexLimits {
  lengthStuds: number;
  minChordStuds: number;
  maxBendDegrees: number;
}

export interface TrackPart {
  id: string;
  name: string;
  category: PartCategory;
  hint: string;
  legoIds?: string[];
  ports: Port[];
  footprint: Point[];
  extraFootprints?: Point[][];
  color: string;
  flex?: FlexLimits;
}

export interface InventoryItem {
  partId: string;
  quantity: number;
}

export interface PlacedPart {
  instanceId: string;
  partId: string;
  label: number;
  x: number;
  y: number;
  rotation: number;
  flexPath?: Point[];
}

export interface Connection {
  fromInstanceId: string;
  fromPortId: string;
  toInstanceId: string;
  toPortId: string;
}

export interface ParkingSpot {
  id: string;
  endInstanceId: string;
  clearLengthStuds: number;
  switchInstanceId?: string;
}

export type ReverseKind = 'dead-end' | 'reversing-loop' | 'wye';

export interface ReverseOption {
  kind: ReverseKind;
  partIds: string[];
}

export interface LayoutMark {
  kind: 'parking' | 'reverse' | 'flex' | 'unfinished';
  x: number;
  y: number;
  text: string;
}

export interface LayoutScore {
  total: number;
  parkingMatches: number;
  reverseBonus: number;
  routeBonus: number;
  piecesUsed: number;
  compactness: number;
  unfinishedPenalty: number;
  specialsBonus: number;
  flexPenalty: number;
}

export interface GenerationPreferences {
  targetParkingSpots: 0 | 1 | 2;
}

export interface TrackLayout {
  parts: PlacedPart[];
  connections: Connection[];
  unusedInventory: InventoryItem[];
  parkingSpots: ParkingSpot[];
  reverseOptions: ReverseOption[];
  unfinishedPorts: number;
  marks: LayoutMark[];
  notes: string[];
  score: LayoutScore;
  message?: string;
}

export const DEFAULT_PREFERENCES: GenerationPreferences = {
  targetParkingSpots: 1,
};

export function normalizePreferences(raw?: unknown): GenerationPreferences {
  const spots =
    raw && typeof raw === 'object' && 'targetParkingSpots' in raw
      ? Number((raw as { targetParkingSpots: unknown }).targetParkingSpots)
      : DEFAULT_PREFERENCES.targetParkingSpots;
  return { targetParkingSpots: spots >= 2 ? 2 : spots >= 1 ? 1 : 0 };
}

export const INVENTORY_STORAGE_KEY = 'lego-track-designer.inventory.v1';
export const LAYOUT_STORAGE_KEY = 'lego-track-designer.layout.v1';
