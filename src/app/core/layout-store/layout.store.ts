import { computed, inject, Injectable, signal } from '@angular/core';
import {
  DEFAULT_PREFERENCES,
  GenerationPreferences,
  InventoryItem,
  LAYOUT_STORAGE_KEY,
  TrackLayout,
} from '../../shared/models/track';
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
      this.preferences.set({ ...DEFAULT_PREFERENCES, ...saved.preferences });
      this.seed = saved.seed ?? 1;
      this.usedInventory.set(saved.usedInventory ?? this.inventory.snapshot());
    }
  }

  updatePreferences(patch: Partial<GenerationPreferences>): void {
    this.preferences.update((current) => ({ ...current, ...patch }));
    this.persist();
  }

  select(label: number | null): void {
    this.selectedLabel.set(label);
  }

  generate(): void {
    if (this.usedInventory() !== null || this.layout().parts.length > 0) {
      this.seed += 1;
    }
    this.run();
  }

  rebuild(): void {
    if (!this.canRebuild()) {
      return;
    }
    this.run();
  }

  show(layout: TrackLayout): void {
    this.layout.set(layout);
    this.usedInventory.set(this.inventory.snapshot());
    this.persist();
  }

  private run(): void {
    this.generating.set(true);
    const used = this.inventory.snapshot();
    const layout = generateLayout(used, this.preferences(), {
      seed: this.seed,
      timeoutMs: 2200,
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
