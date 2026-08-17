import { computed, inject, Injectable, signal } from '@angular/core';
import {
  DEFAULT_PREFERENCES,
  GenerationPreferences,
  normalizePreferences,
  InventoryItem,
  LAYOUT_STORAGE_KEY,
  TrackLayout,
  clampParkingSpots,
  switchCountOf,
} from '../../shared/models/track';
import { buildSnapshot, DesignerSnapshot } from '../export/snapshot';
import { emptyLayout, generateLayout } from '../layout-engine/generate';
import { InventoryStore } from '../inventory/inventory.store';
import { BrowserStorage } from '../storage/browser-storage';

interface PersistedLayout {
  layout: TrackLayout;
  preferences: GenerationPreferences;
  seed: number;
  usedInventory?: InventoryItem[];
}

function inventoryKey(items: InventoryItem[] | null | undefined): string {
  return (items ?? [])
    .filter((item) => item.quantity > 0)
    .sort((a, b) => a.partId.localeCompare(b.partId))
    .map((item) => `${item.partId}:${item.quantity}`)
    .join('|');
}

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly inventory = inject(InventoryStore);
  private readonly storage = inject(BrowserStorage);

  readonly preferences = signal<GenerationPreferences>(DEFAULT_PREFERENCES);
  readonly layout = signal<TrackLayout>(emptyLayout());
  readonly generating = signal(false);
  readonly selectedLabel = signal<number | null>(null);
  private readonly usedInventory = signal<InventoryItem[] | null>(null);
  private seed = 1;

  readonly canRebuild = computed(
    () =>
      this.usedInventory() !== null &&
      inventoryKey(this.inventory.snapshot()) !== inventoryKey(this.usedInventory()),
  );

  readonly parkingOptions = computed(() => {
    const max = clampParkingSpots(2, switchCountOf(this.inventory.snapshot()));
    return Array.from({ length: max + 1 }, (_, index) => index as 0 | 1 | 2);
  });

  readonly parkingHint = computed(
    () => switchCountOf(this.inventory.snapshot()) === 2 && this.preferences().targetParkingSpots === 1,
  );

  readonly usageSummary = computed(() => {
    const counts = new Map<string, number>();
    for (const part of this.layout().parts) {
      counts.set(part.partId, (counts.get(part.partId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([partId, quantity]) => ({ partId, quantity }));
  });

  constructor() {
    const saved = this.storage.read<PersistedLayout>(LAYOUT_STORAGE_KEY);
    if (saved?.layout) {
      this.layout.set(saved.layout);
      this.preferences.set(normalizePreferences(saved.preferences, switchCountOf(this.inventory.snapshot())));
      this.seed = saved.seed ?? 1;
      this.usedInventory.set(saved.usedInventory ?? this.inventory.snapshot());
    }
  }

  updatePreferences(patch: Partial<GenerationPreferences>): void {
    this.preferences.update((current) =>
      normalizePreferences({ ...current, ...patch }, switchCountOf(this.inventory.snapshot())),
    );
    this.persist();
  }

  select(label: number | null): void {
    this.selectedLabel.set(label);
  }

  generate(): void {
    if (this.generating()) {
      return;
    }
    if (this.usedInventory() !== null || this.layout().parts.length > 0) {
      this.seed += 1;
    }
    this.startRun();
  }

  rebuild(): void {
    if (this.generating() || !this.canRebuild()) {
      return;
    }
    this.startRun();
  }

  show(layout: TrackLayout): void {
    this.layout.set(layout);
    this.usedInventory.set(this.inventory.snapshot());
    this.persist();
  }

  currentSeed(): number {
    return this.seed;
  }

  exportSnapshot(): DesignerSnapshot {
    return buildSnapshot({
      seed: this.seed,
      preferences: this.preferences(),
      inventory: this.usedInventory() ?? this.inventory.snapshot(),
      layout: this.layout(),
    });
  }

  importSnapshot(snapshot: DesignerSnapshot): void {
    this.inventory.replaceAll(snapshot.inventory);
    this.preferences.set(normalizePreferences(snapshot.preferences, switchCountOf(snapshot.inventory)));
    this.layout.set(snapshot.layout);
    this.seed = snapshot.seed;
    this.usedInventory.set(snapshot.inventory);
    this.selectedLabel.set(null);
    this.persist();
  }

  private startRun(): void {
    this.generating.set(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.finishRun());
    });
  }

  private finishRun(): void {
    const used = this.inventory.snapshot();
    const prefs = normalizePreferences(this.preferences(), switchCountOf(used));
    this.preferences.set(prefs);
    const layout = generateLayout(used, prefs, {
      seed: this.seed,
      timeoutMs: 2800,
      previous: this.layout().parts,
    });
    this.usedInventory.set(used);
    this.layout.set(layout);
    this.selectedLabel.set(null);
    this.persist();
    this.generating.set(false);
  }

  private persist(): void {
    this.storage.write(LAYOUT_STORAGE_KEY, {
      layout: this.layout(),
      preferences: this.preferences(),
      seed: this.seed,
      usedInventory: this.usedInventory() ?? undefined,
    } satisfies PersistedLayout);
  }
}
