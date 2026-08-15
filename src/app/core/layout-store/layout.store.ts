import { computed, inject, Injectable, signal } from '@angular/core';
import {
  DEFAULT_PREFERENCES,
  GenerationPreferences,
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
}

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly inventory = inject(InventoryStore);
  private readonly storage = inject(BrowserStorage);

  readonly preferences = signal<GenerationPreferences>(DEFAULT_PREFERENCES);
  readonly layout = signal<TrackLayout>(emptyLayout());
  readonly generating = signal(false);
  readonly selectedLabel = signal<number | null>(null);
  private seed = 1;

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
    }
  }

  updatePreferences(patch: Partial<GenerationPreferences>): void {
    this.preferences.update((current) => ({ ...current, ...patch }));
    this.persist();
  }

  select(label: number | null): void {
    this.selectedLabel.set(label);
  }

  generate(another = false): void {
    this.generating.set(true);
    this.seed = another ? this.seed + 1 : this.seed;
    const layout = generateLayout(this.inventory.snapshot(), this.preferences(), {
      seed: this.seed,
      timeoutMs: 2200,
    });
    this.layout.set(layout);
    this.selectedLabel.set(null);
    this.persist();
    this.generating.set(false);
  }

  show(layout: TrackLayout): void {
    this.layout.set(layout);
    this.persist();
  }

  private persist(): void {
    this.storage.write(LAYOUT_STORAGE_KEY, {
      layout: this.layout(),
      preferences: this.preferences(),
      seed: this.seed,
    } satisfies PersistedLayout);
  }
}
