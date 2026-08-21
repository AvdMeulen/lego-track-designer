import { Injectable, computed, inject, signal } from '@angular/core';
import {
  FLOOR_PLAN_STORAGE_KEY,
  FloorPlan,
  PersistedFloorPlans,
  cloneFloorPlan,
  defaultFloorPlan,
  parsePersistedFloorPlans,
} from '../../shared/models/floor-plan';
import { BrowserStorage } from '../storage/browser-storage';

@Injectable({ providedIn: 'root' })
export class FloorPlanStore {
  private readonly storage = inject(BrowserStorage);
  private readonly plans = signal<FloorPlan[]>([]);
  private readonly activeId = signal<string>('');

  readonly plan = computed(() => {
    const id = this.activeId();
    return this.plans().find((item) => item.id === id) ?? this.plans()[0] ?? defaultFloorPlan();
  });

  constructor() {
    const saved = parsePersistedFloorPlans(this.storage.read<PersistedFloorPlans>(FLOOR_PLAN_STORAGE_KEY));
    if (saved) {
      this.plans.set(saved.plans.map(cloneFloorPlan));
      this.activeId.set(saved.activeId);
    } else {
      const initial = defaultFloorPlan();
      this.plans.set([initial]);
      this.activeId.set(initial.id);
      this.persist();
    }
  }

  update(plan: FloorPlan): void {
    const next = cloneFloorPlan(plan);
    this.plans.update((plans) => {
      const index = plans.findIndex((item) => item.id === next.id);
      if (index < 0) {
        return [...plans, next];
      }
      return plans.map((item, itemIndex) => (itemIndex === index ? next : item));
    });
    this.activeId.set(next.id);
    this.persist();
  }

  replaceActive(plan: FloorPlan): void {
    this.update({ ...plan, id: this.plan().id });
  }

  private persist(): void {
    this.storage.write(FLOOR_PLAN_STORAGE_KEY, {
      activeId: this.activeId(),
      plans: this.plans(),
    } satisfies PersistedFloorPlans);
  }
}
