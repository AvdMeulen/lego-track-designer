import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogService } from '../../core/catalog/catalog.service';
import { InventoryStore } from '../../core/inventory/inventory.store';
import { INVENTORY_PRESETS } from '../../core/inventory/presets';

@Component({
  selector: 'app-inventory',
  imports: [RouterLink],
  templateUrl: './inventory.html',
  styleUrl: './inventory.scss',
})
export class Inventory {
  protected readonly catalog = inject(CatalogService);
  protected readonly inventory = inject(InventoryStore);
  protected readonly presets = INVENTORY_PRESETS;
}
