import { TestBed } from '@angular/core/testing';
import { INVENTORY_STORAGE_KEY } from '../../shared/models/track';
import { BrowserStorage } from '../storage/browser-storage';
import { InventoryStore } from './inventory.store';

class MemoryStorage {
  private readonly data = new Map<string, string>();

  read<T>(key: string): T | null {
    const raw = this.data.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  write(key: string, value: unknown): void {
    this.data.set(key, JSON.stringify(value));
  }
}

describe('InventoryStore', () => {
  it('persists quantities', () => {
    const memory = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: BrowserStorage, useValue: memory }],
    });
    const store = TestBed.inject(InventoryStore);
    store.setQuantity('curve-22', 16);
    expect(store.quantity('curve-22')).toBe(16);
    expect(store.totalPieces()).toBe(16);
    expect(memory.read<Record<string, number>>(INVENTORY_STORAGE_KEY)?.['curve-22']).toBe(16);
  });
});
