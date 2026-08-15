import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogService } from '../../core/catalog/catalog.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { InventoryStore } from '../../core/inventory/inventory.store';

@Component({
  selector: 'app-inventory',
  imports: [RouterLink, TPipe],
  templateUrl: './inventory.html',
  styleUrl: './inventory.scss',
})
export class Inventory {
  protected readonly catalog = inject(CatalogService);
  protected readonly inventory = inject(InventoryStore);
  protected readonly confirmingReset = signal(false);

  protected resetCollection(): void {
    this.inventory.clear();
    this.confirmingReset.set(false);
  }
}
