import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CatalogService } from '../../core/catalog/catalog.service';
import {
  allFootprints,
  boundsOf,
  CURVE_ANGLE,
  CURVE_RADIUS,
  crossoverArtwork,
  curveArtworkPath,
  curveEnd,
  crossingArtwork,
  polygonCenter,
  switchArtwork,
  transformPolygon,
} from '../../core/layout-engine/geometry';
import { closestPointOnSegment, distanceToSegment, floorBounds, segmentLength } from '../../core/floor-plan/space';
import { TPipe } from '../../core/i18n/t.pipe';
import { FloorPlan, formatLengthCm } from '../models/floor-plan';
import { TrackLayout } from '../models/track';

@Component({
  selector: 'app-track-canvas',
  imports: [TPipe],
  templateUrl: './track-canvas.html',
  styleUrl: './track-canvas.scss',
})
export class TrackCanvas {
  private readonly catalog = inject(CatalogService);

  readonly layout = input.required<TrackLayout>();
  readonly floorPlan = input<FloorPlan | null>(null);
  readonly selectedLabel = input<number | null>(null);
  readonly partSelect = output<number | null>();

  readonly hoverMeasure = signal<{ x: number; y: number; text: string } | null>(null);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly zoom = signal(1);
  readonly dragging = signal(false);

  private moved = false;
  private pressLabel: number | null = null;
  private dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

  readonly world = computed(() => {
    const parts = this.layout().parts;
    const points = parts.flatMap((part) => {
      if (part.flexPath?.length) {
        return part.flexPath;
      }
      const spec = this.catalog.byId(part.partId);
      return allFootprints(spec).flatMap((polygon) => transformPolygon(polygon, part));
    });
    const plan = this.floorPlan();
    const floorPoints = plan
      ? [...plan.outer.points, ...plan.obstacles.flatMap((shape) => shape.points)]
      : [];
    const bounds = points.length
      ? boundsOf(points.concat(floorPoints))
      : floorPoints.length
        ? floorBounds(plan!)
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

  readonly floorLayer = computed(() => {
    const plan = this.floorPlan();
    if (!plan) {
      return null;
    }
    return {
      outer: plan.outer.points.map((point) => `${point.x},${point.y}`).join(' '),
      obstacles: plan.obstacles.map((shape) => ({
        id: shape.id,
        points: shape.points.map((point) => `${point.x},${point.y}`).join(' '),
      })),
    };
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
      const special =
        spec.category === 'switch'
          ? switchArtwork(spec.id === 'switch-right' ? -1 : 1)
          : spec.category === 'double-crossover'
            ? crossoverArtwork()
            : spec.category === 'crossing'
              ? crossingArtwork()
              : { beds: [] as string[], rails: [] as string[] };
      const curvePath = spec.category === 'curve' ? curveArtworkPath() : '';
      const showPolygon = spec.category !== 'curve' && special.beds.length === 0;
      const transform = `translate(${part.x} ${part.y}) rotate(${part.rotation})`;
      const outline = special.outline ?? '';
      const centerLocal =
        spec.category === 'curve'
          ? curveEnd(CURVE_RADIUS, CURVE_ANGLE / 2)
          : spec.category === 'double-crossover'
            ? { x: 0, y: 8 }
            : polygonCenter(spec.footprint);
      const center = part.flexPath?.length
        ? part.flexPath[Math.floor(part.flexPath.length / 2)]
        : transformPolygon([centerLocal], part)[0];
      return {
        part,
        spec,
        points,
        path,
        curvePath,
        beds: special.beds,
        rails: special.rails,
        outline,
        showPolygon,
        transform,
        center,
      };
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
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    this.pressLabel = labelOf(event.target);
    this.dragging.set(true);
    this.moved = false;
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      panX: this.panX(),
      panY: this.panY(),
    };
    const target = event.currentTarget as SVGSVGElement;
    try {
      if (event.isPrimary !== false && event.pointerId >= 1) {
        target.setPointerCapture(event.pointerId);
      }
    } catch {
      return;
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) {
      this.updateHoverMeasure(event);
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
    if (!this.moved) {
      this.partSelect.emit(this.pressLabel);
    }
    this.pressLabel = null;
  }

  private updateHoverMeasure(event: PointerEvent): void {
    const plan = this.floorPlan();
    const point = this.clientToWorld(event);
    if (!plan || !point) {
      this.hoverMeasure.set(null);
      return;
    }
    let best: { x: number; y: number; text: string; dist: number } | null = null;
    for (const shape of [plan.outer, ...plan.obstacles]) {
      for (let index = 0; index < shape.points.length; index += 1) {
        const a = shape.points[index];
        const b = shape.points[(index + 1) % shape.points.length];
        const dist = distanceToSegment(point, a, b);
        if (dist > 8) {
          continue;
        }
        if (!best || dist < best.dist) {
          const at = closestPointOnSegment(point, a, b);
          best = { x: at.x, y: at.y - 6, text: formatLengthCm(segmentLength(a, b)), dist };
        }
      }
    }
    this.hoverMeasure.set(best ? { x: best.x, y: best.y, text: best.text } : null);
  }

  private clientToWorld(event: PointerEvent): { x: number; y: number } | null {
    const target = event.currentTarget as SVGSVGElement | null;
    if (!target) {
      return null;
    }
    const rect = target.getBoundingClientRect();
    const view = this.view();
    return {
      x: view.minX + ((event.clientX - rect.left) / Math.max(rect.width, 1)) * view.width,
      y: view.minY + ((event.clientY - rect.top) / Math.max(rect.height, 1)) * view.height,
    };
  }

  onContextMenu(event: Event): void {
    event.preventDefault();
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

}

function labelOf(target: EventTarget | null): number | null {
  const el = target instanceof Element ? target.closest('[data-label]') : null;
  const raw = el?.getAttribute('data-label');
  if (!raw) {
    return null;
  }
  const label = Number(raw);
  return Number.isFinite(label) ? label : null;
}
