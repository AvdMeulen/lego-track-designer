import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
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

  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly zoom = signal(1);
  readonly dragging = signal(false);

  private moved = false;
  private dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

  readonly world = computed(() => {
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
    return {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      width: Math.max(80, bounds.maxX - bounds.minX + pad * 2),
      height: Math.max(80, bounds.maxY - bounds.minY + pad * 2),
    };
  });

  readonly view = computed(() => {
    const world = this.world();
    const zoom = this.zoom();
    const width = world.width / zoom;
    const height = world.height / zoom;
    const minX = world.minX + this.panX();
    const minY = world.minY + this.panY();
    return { minX, minY, width, height, box: `${minX} ${minY} ${width} ${height}` };
  });

  readonly grid = computed(() => {
    const view = this.view();
    const step = 16;
    const xs: number[] = [];
    const ys: number[] = [];
    const startX = Math.floor(view.minX / step) * step;
    const startY = Math.floor(view.minY / step) * step;
    for (let x = startX; x <= view.minX + view.width + step; x += step) {
      xs.push(x);
    }
    for (let y = startY; y <= view.minY + view.height + step; y += step) {
      ys.push(y);
    }
    return { xs, ys };
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

  fullViewBox(): string {
    const world = this.world();
    return `${world.minX} ${world.minY} ${world.width} ${world.height}`;
  }

  constructor() {
    effect(() => {
      this.layout();
      this.panX.set(0);
      this.panY.set(0);
      this.zoom.set(1);
    });
  }

  onPointerDown(event: PointerEvent): void {
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    this.dragging.set(true);
    this.moved = false;
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      panX: this.panX(),
      panY: this.panY(),
    };
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    const target = event.currentTarget as SVGSVGElement;
    const rect = target.getBoundingClientRect();
    const scaleX = this.view().width / Math.max(rect.width, 1);
    const scaleY = this.view().height / Math.max(rect.height, 1);
    const dx = (event.clientX - this.dragStart.x) * scaleX;
    const dy = (event.clientY - this.dragStart.y) * scaleY;
    if (Math.hypot(event.clientX - this.dragStart.x, event.clientY - this.dragStart.y) > 4) {
      this.moved = true;
    }
    this.panX.set(this.dragStart.panX - dx);
    this.panY.set(this.dragStart.panY - dy);
  }

  onPointerUp(): void {
    this.dragging.set(false);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = this.zoom();
    const newZoom = Math.min(4, Math.max(0.35, oldZoom * factor));
    if (newZoom === oldZoom) {
      return;
    }
    const world = this.world();
    const oldWidth = world.width / oldZoom;
    const oldHeight = world.height / oldZoom;
    const newWidth = world.width / newZoom;
    const newHeight = world.height / newZoom;
    this.panX.update((x) => x + (oldWidth - newWidth) / 2);
    this.panY.update((y) => y + (oldHeight - newHeight) / 2);
    this.zoom.set(newZoom);
  }

  select(part: PlacedPart): void {
    if (this.moved) {
      return;
    }
    this.partSelect.emit(part.label);
  }
}
