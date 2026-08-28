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
import { CITY_TRACKS_BY_ID } from '../catalog/city-tracks';
import { FloorPlanStore } from '../floor-plan/floor-plan.store';
import { buildSnapshot, DesignerSnapshot } from '../export/snapshot';
import { refreshReverseAnalysis } from '../layout-analysis/analyze';
import { emptyLayout, generateLayoutAsync, GeneratePhaseSnapshot } from '../layout-engine/generate';
import { InventoryStore } from '../inventory/inventory.store';
import { BrowserStorage } from '../storage/browser-storage';
import { AgentLayoutReport, buildAgentReport } from './agent-report';
import { AgentGenerateOptions, AgentSetupInput, resolveAgentSetup } from './agent-setup';

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

function paintAndDwell(ms: number): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, ms);
      });
    });
  });
}

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly inventory = inject(InventoryStore);
  private readonly floorPlans = inject(FloorPlanStore);
  private readonly storage = inject(BrowserStorage);

  readonly preferences = signal<GenerationPreferences>(DEFAULT_PREFERENCES);
  readonly layout = signal<TrackLayout>(emptyLayout());
  readonly generating = signal(false);
  readonly generatePhase = signal<GeneratePhaseSnapshot | null>(null);
  readonly selectedLabel = signal<number | null>(null);
  readonly seed = signal(1);
  private readonly usedInventory = signal<InventoryItem[] | null>(null);
  private inFlight: Promise<AgentLayoutReport> | null = null;

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

  readonly reportJson = computed(() => JSON.stringify(this.agentReport()));

  constructor() {
    const saved = this.storage.read<PersistedLayout>(LAYOUT_STORAGE_KEY);
    if (saved?.layout) {
      const prefs = normalizePreferences(saved.preferences, switchCountOf(this.inventory.snapshot()));
      this.layout.set(refreshReverseAnalysis(saved.layout, CITY_TRACKS_BY_ID, prefs));
      this.preferences.set(prefs);
      this.seed.set(saved.seed ?? 1);
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
    void this.runGeneration({ increment: true });
  }

  rebuild(): void {
    if (this.generating() || !this.canRebuild()) {
      return;
    }
    void this.runGeneration({ increment: false });
  }

  async runGeneration(options: AgentGenerateOptions & { increment?: boolean } = {}): Promise<AgentLayoutReport> {
    if (this.generating() && this.inFlight) {
      await this.inFlight;
    }
    if (this.generating()) {
      return this.agentReport();
    }
    this.applySetup(options);
    if (options.seed != null) {
      this.seed.set(clampSeed(options.seed));
    } else if (options.increment !== false && (this.usedInventory() !== null || this.layout().parts.length > 0)) {
      this.seed.update((current) => current + 1);
    }
    return this.startRun();
  }

  applySetup(input: AgentSetupInput): void {
    const applied = resolveAgentSetup(input);
    if (applied.inventory) {
      this.inventory.replaceAll(applied.inventory);
    }
    if (applied.floorPlan) {
      this.floorPlans.replaceActive(applied.floorPlan);
    }
    if (applied.parking != null) {
      this.updatePreferences({ targetParkingSpots: applied.parking });
    }
  }

  show(layout: TrackLayout): void {
    this.layout.set(layout);
    this.usedInventory.set(this.inventory.snapshot());
    this.persist();
  }

  currentSeed(): number {
    return this.seed();
  }

  agentReport(): AgentLayoutReport {
    return buildAgentReport({
      seed: this.seed(),
      status: this.generating() ? 'generating' : this.layout().parts.length > 0 ? 'ready' : 'idle',
      preferences: this.preferences(),
      layout: this.layout(),
      collection: this.inventory.snapshot(),
      floorPlan: this.floorPlans.plan(),
    });
  }

  exportSnapshot(): DesignerSnapshot {
    return buildSnapshot({
      seed: this.seed(),
      preferences: this.preferences(),
      inventory: this.usedInventory() ?? this.inventory.snapshot(),
      layout: this.layout(),
      floorPlan: this.floorPlans.plan(),
    });
  }

  importSnapshot(snapshot: DesignerSnapshot): void {
    this.inventory.replaceAll(snapshot.inventory);
    const prefs = normalizePreferences(snapshot.preferences, switchCountOf(snapshot.inventory));
    this.preferences.set(prefs);
    this.layout.set(refreshReverseAnalysis(snapshot.layout, CITY_TRACKS_BY_ID, prefs));
    this.seed.set(snapshot.seed);
    this.usedInventory.set(snapshot.inventory);
    this.selectedLabel.set(null);
    if (snapshot.floorPlan) {
      this.floorPlans.replaceActive(snapshot.floorPlan);
    }
    this.persist();
  }

  private startRun(): Promise<AgentLayoutReport> {
    this.generating.set(true);
    this.generatePhase.set(null);
    this.inFlight = new Promise((resolve, reject) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void this.finishRun().then(resolve, reject);
        });
      });
    });
    return this.inFlight;
  }

  private async finishRun(): Promise<AgentLayoutReport> {
    const used = this.inventory.snapshot();
    const prefs = normalizePreferences(this.preferences(), switchCountOf(used));
    this.preferences.set(prefs);
    const previous = this.layout().parts;
    try {
      const layout = await generateLayoutAsync(used, prefs, {
        seed: this.seed(),
        timeoutMs: 4000,
        previous,
        floorPlan: this.floorPlans.plan(),
        onPhase: async (snapshot) => {
          this.generatePhase.set(snapshot);
          this.layout.set(snapshot.layout);
          this.selectedLabel.set(null);
          await paintAndDwell(snapshot.phase === 'done' ? 160 : 280);
        },
      });
      this.usedInventory.set(used);
      this.layout.set(layout);
      this.selectedLabel.set(null);
      this.persist();
    } finally {
      this.generatePhase.set(null);
      this.generating.set(false);
    }
    return this.agentReport();
  }

  private persist(): void {
    this.storage.write(LAYOUT_STORAGE_KEY, {
      layout: this.layout(),
      preferences: this.preferences(),
      seed: this.seed(),
      usedInventory: this.usedInventory() ?? undefined,
    } satisfies PersistedLayout);
  }
}

function clampSeed(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}
