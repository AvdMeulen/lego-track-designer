import { Component, computed, inject, input, output } from '@angular/core';
import { CatalogService } from '../../core/catalog/catalog.service';
import { boundsOf, transformPolygon } from '../../core/layout-engine/geometry';
import { PlacedPart, TrackLayout } from '../models/track';

@Component({
  selector: 'app-track-canvas',
  templateUrl: './track-canvas.html',
  styleUrl: './track-canvas.scss',
})
export class TrackCanvas {
  private readonly catalog = inject(CatalogService);

  readonly layout = input.required<TrackLayout>();
  readonly selectedLabel = input<number | null>(null);
  readonly partSelect = output<number>();

  readonly view = computed(() => {
    const parts = this.layout().parts;
    const points = parts.flatMap((part) => {
      if (part.flexPath?.length) {
        return part.flexPath;
      }
      return transformPolygon(this.catalog.byId(part.partId).footprint, part);
    });
    const bounds = points.length
      ? boundsOf(points)
      : { minX: -40, minY: -40, maxX: 40, maxY: 40 };
    const pad = 24;
    const minX = bounds.minX - pad;
    const minY = bounds.minY - pad;
    const width = Math.max(80, bounds.maxX - bounds.minX + pad * 2);
    const height = Math.max(80, bounds.maxY - bounds.minY + pad * 2);
    return { minX, minY, width, height, box: `${minX} ${minY} ${width} ${height}` };
  });

  readonly drawnParts = computed(() =>
    this.layout().parts.map((part) => {
      const spec = this.catalog.byId(part.partId);
      const polygon = part.flexPath?.length
        ? part.flexPath
        : transformPolygon(spec.footprint, part);
      const points = polygon.map((point) => `${point.x},${point.y}`).join(' ');
      const path = part.flexPath?.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
      const center = part.flexPath?.length
        ? part.flexPath[Math.floor(part.flexPath.length / 2)]
        : { x: part.x, y: part.y };
      return { part, spec, points, path, center };
    }),
  );

  readonly summary = computed(() => {
    const counts = new Map<string, { name: string; quantity: number }>();
    for (const part of this.layout().parts) {
      const spec = this.catalog.byId(part.partId);
      const current = counts.get(part.partId) ?? { name: spec.name, quantity: 0 };
      current.quantity += 1;
      counts.set(part.partId, current);
    }
    return [...counts.values()].map((item) => `${item.quantity}× ${item.name}`).join(', ');
  });

  select(part: PlacedPart): void {
    this.partSelect.emit(part.label);
  }
}
