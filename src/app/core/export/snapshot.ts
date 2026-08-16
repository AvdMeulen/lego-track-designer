import {
  GenerationPreferences,
  InventoryItem,
  TrackLayout,
  normalizePreferences,
} from '../../shared/models/track';

export const SNAPSHOT_KIND = 'lego-track-designer.snapshot';
export const SNAPSHOT_VERSION = 1;

export interface SnapshotSummary {
  seed: number;
  parts: number;
  loop: boolean;
  parking: number;
  reverse: number;
  unfinished: number;
  message?: string;
  used: Record<string, number>;
  unused: Record<string, number>;
}

export interface DesignerSnapshot {
  kind: typeof SNAPSHOT_KIND;
  version: typeof SNAPSHOT_VERSION;
  exportedAt: string;
  seed: number;
  preferences: GenerationPreferences;
  inventory: InventoryItem[];
  layout: TrackLayout;
  summary: SnapshotSummary;
}

export function buildSnapshot(input: {
  seed: number;
  preferences: GenerationPreferences;
  inventory: InventoryItem[];
  layout: TrackLayout;
}): DesignerSnapshot {
  const inventory = normalizeInventory(input.inventory);
  const used: Record<string, number> = {};
  for (const part of input.layout.parts) {
    used[part.partId] = (used[part.partId] ?? 0) + 1;
  }
  const unused = Object.fromEntries(
    input.layout.unusedInventory
      .filter((item) => item.quantity > 0)
      .map((item) => [item.partId, item.quantity]),
  );
  return {
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    seed: input.seed,
    preferences: normalizePreferences(input.preferences),
    inventory,
    layout: input.layout,
    summary: {
      seed: input.seed,
      parts: input.layout.parts.length,
      loop: input.layout.score.routeBonus > 0,
      parking: input.layout.parkingSpots.length,
      reverse: input.layout.reverseOptions.length,
      unfinished: input.layout.unfinishedPorts,
      message: input.layout.message,
      used,
      unused,
    },
  };
}

export function parseSnapshot(raw: unknown): DesignerSnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<DesignerSnapshot>;
  if (value.kind !== SNAPSHOT_KIND || value.version !== SNAPSHOT_VERSION) {
    return null;
  }
  if (!Array.isArray(value.inventory)) {
    return null;
  }
  const inventory = normalizeInventory(value.inventory);
  const preferences = normalizePreferences(value.preferences);
  const layout = isLayout(value.layout) ? value.layout : emptyImportedLayout();
  return buildSnapshot({
    seed: Number.isFinite(value.seed) ? Number(value.seed) : 1,
    preferences,
    inventory,
    layout,
  });
}

export function parseSnapshotText(text: string): DesignerSnapshot | null {
  try {
    return parseSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeInventory(items: InventoryItem[]): InventoryItem[] {
  return items
    .filter((item) => typeof item?.partId === 'string' && Number(item.quantity) > 0)
    .map((item) => ({ partId: item.partId, quantity: Math.floor(Number(item.quantity)) }))
    .sort((a, b) => a.partId.localeCompare(b.partId));
}

function isLayout(value: unknown): value is TrackLayout {
  return !!value && typeof value === 'object' && Array.isArray((value as TrackLayout).parts);
}

function emptyImportedLayout(): TrackLayout {
  return {
    parts: [],
    connections: [],
    unusedInventory: [],
    parkingSpots: [],
    reverseOptions: [],
    unfinishedPorts: 0,
    marks: [],
    notes: [],
    score: {
      total: 0,
      parkingMatches: 0,
      reverseBonus: 0,
      routeBonus: 0,
      piecesUsed: 0,
      compactness: 0,
      unfinishedPenalty: 0,
      specialsBonus: 0,
      flexPenalty: 0,
    },
  };
}
