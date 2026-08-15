import { computed, inject, Injectable, signal } from '@angular/core';
import { CatalogService } from '../catalog/catalog.service';
import { BrowserStorage } from '../storage/browser-storage';
import { INVENTORY_STORAGE_KEY, InventoryItem } from '../../shared/models/track';

@Injectable({ providedIn: 'root' })
export class InventoryStore {
  private readonly catalog = inject(CatalogService);
  private readonly storage = inject(BrowserStorage);

  private readonly quantities = signal<Record<string, number>>(this.load());

  readonly items = computed<InventoryItem[]>(() =>
    this.catalog.parts.map((part) => ({
      partId: part.id,
      quantity: this.quantities()[part.id] ?? 0,
    })),
  );

  readonly totalPieces = computed(() => this.items().reduce((sum, item) => sum + item.quantity, 0));

  quantity(partId: string): number {
    return this.quantities()[partId] ?? 0;
  }

  setQuantity(partId: string, quantity: number): void {
    const next = Math.max(0, Math.floor(quantity));
    this.quantities.update((current) => {
      const updated = { ...current, [partId]: next };
      this.storage.write(INVENTORY_STORAGE_KEY, updated);
      return updated;
    });
  }

  adjust(partId: string, delta: number): void {
    this.setQuantity(partId, this.quantity(partId) + delta);
  }

  clear(): void {
    const next: Record<string, number> = {};
    for (const part of this.catalog.parts) {
      next[part.id] = 0;
    }
    this.quantities.set(next);
    this.storage.write(INVENTORY_STORAGE_KEY, next);
  }

  snapshot(): InventoryItem[] {
    return this.items().filter((item) => item.quantity > 0);
  }

  private load(): Record<string, number> {
    return this.storage.read<Record<string, number>>(INVENTORY_STORAGE_KEY) ?? {};
  }
}
