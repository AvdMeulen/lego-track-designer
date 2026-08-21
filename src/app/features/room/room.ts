import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CM_NUDGE_LARGE_STUDS,
  CM_NUDGE_STUDS,
  CLOSE_LOOP_STUDS,
  FloorHit,
  floorBounds,
  hitTestFloor,
  insertVertex,
  moveEdge,
  moveVertex,
  nextObstacleId,
  orthoSnap,
  otherVertices,
  removeVertex,
  replaceShape,
  segmentLength,
  shapeById,
} from '../../core/floor-plan/space';
import { FloorPlanStore } from '../../core/floor-plan/floor-plan.store';
import { TPipe } from '../../core/i18n/t.pipe';
import { FloorPlan, FloorShape, formatLengthCm } from '../../shared/models/floor-plan';
import { Point } from '../../shared/models/track';
import { boundsOf, distance } from '../../core/layout-engine/geometry';

type EditorFocus =
  | { kind: 'vertex'; shapeId: string; index: number; role: 'outer' | 'obstacle' }
  | { kind: 'edge'; shapeId: string; index: number; role: 'outer' | 'obstacle' };

type DragKind = 'pan' | 'vertex' | 'edge';

@Component({
  selector: 'app-room',
  imports: [RouterLink, TPipe],
  templateUrl: './room.html',
  styleUrl: './room.scss',
})
export class Room {
  protected readonly store = inject(FloorPlanStore);
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('board');

  protected readonly addMode = signal(false);
  protected readonly drawing = signal<Point[] | null>(null);
  protected readonly cursor = signal<Point | null>(null);
  protected readonly hover = signal<FloorHit | null>(null);
  protected readonly focus = signal<EditorFocus | null>(null);
  protected readonly panX = signal(0);
  protected readonly panY = signal(0);
  protected readonly zoom = signal(1);

  private drag: {
    kind: DragKind;
    start: Point;
    origin: Point;
    panX: number;
    panY: number;
    shapeId?: string;
    index?: number;
    shape?: FloorShape;
  } | null = null;

  readonly world = computed(() => {
    const plan = this.store.plan();
    const extra = this.drawing() ?? [];
    const points = [
      ...plan.outer.points,
      ...plan.obstacles.flatMap((shape) => shape.points),
      ...extra,
    ];
    const bounds = points.length ? boundsOf(points) : floorBounds(plan);
    const pad = 36;
    return {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      width: Math.max(120, bounds.maxX - bounds.minX + pad * 2),
      height: Math.max(90, bounds.maxY - bounds.minY + pad * 2),
    };
  });

  readonly view = computed(() => {
    const world = this.world();
    const zoom = this.zoom();
    return {
      minX: world.minX + this.panX(),
      minY: world.minY + this.panY(),
      width: world.width / zoom,
      height: world.height / zoom,
      box: `${world.minX + this.panX()} ${world.minY + this.panY()} ${world.width / zoom} ${world.height / zoom}`,
    };
  });

  readonly drawn = computed(() => {
    const plan = this.store.plan();
    const hover = this.hover();
    const focus = this.focus();
    return {
      outer: this.shapeView(plan.outer, 'outer', hover, focus),
      obstacles: plan.obstacles.map((shape) => this.shapeView(shape, 'obstacle', hover, focus)),
    };
  });

  readonly rubber = computed(() => {
    const points = this.drawing();
    const cursor = this.snappedCursor();
    if (!points?.length || !cursor) {
      return null;
    }
    const last = points[points.length - 1];
    const first = points[0];
    const closing = points.length >= 2 && distance(cursor, first) <= CLOSE_LOOP_STUDS;
    const end = closing ? first : cursor;
    return {
      points,
      path: points.map((point) => `${point.x},${point.y}`).join(' '),
      preview: `${last.x},${last.y} ${end.x},${end.y}`,
      length: formatLengthCm(segmentLength(last, end)),
      label: this.labelAt(last, end),
      closing,
    };
  });

  readonly deleteBadge = computed(() => {
    const focus = this.focus();
    if (focus?.kind !== 'vertex') {
      return null;
    }
    const shape = shapeById(this.store.plan(), focus.shapeId);
    if (!shape) {
      return null;
    }
    if (focus.role === 'outer' && shape.points.length <= 3) {
      return null;
    }
    const point = shape.points[focus.index];
    if (!point) {
      return null;
    }
    return { x: point.x + 8, y: point.y - 8 };
  });

  toggleAdd(): void {
    const next = !this.addMode();
    this.addMode.set(next);
    this.drawing.set(null);
    this.focus.set(null);
    if (!next) {
      this.hover.set(null);
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button === 2) {
      event.preventDefault();
      this.undoDrawingPoint();
      return;
    }
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const world = this.pointerWorld(event);
    if (!world) {
      return;
    }
    const svg = this.svg()?.nativeElement;
    svg?.setPointerCapture(event.pointerId);
    const plan = this.store.plan();
    const hit = hitTestFloor(plan, world);

    if (this.addMode()) {
      this.handleAddClick(world, hit, plan);
      return;
    }

    if (hit?.kind === 'vertex') {
      this.focus.set({ kind: 'vertex', shapeId: hit.shapeId, index: hit.index, role: hit.role });
      this.drag = {
        kind: 'vertex',
        start: world,
        origin: { ...shapeById(plan, hit.shapeId)!.points[hit.index] },
        panX: this.panX(),
        panY: this.panY(),
        shapeId: hit.shapeId,
        index: hit.index,
        shape: { ...shapeById(plan, hit.shapeId)!, points: shapeById(plan, hit.shapeId)!.points.map((p) => ({ ...p })) },
      };
      return;
    }
    if (hit?.kind === 'edge') {
      this.focus.set({ kind: 'edge', shapeId: hit.shapeId, index: hit.index, role: hit.role });
      this.drag = {
        kind: 'edge',
        start: world,
        origin: world,
        panX: this.panX(),
        panY: this.panY(),
        shapeId: hit.shapeId,
        index: hit.index,
        shape: { ...shapeById(plan, hit.shapeId)!, points: shapeById(plan, hit.shapeId)!.points.map((p) => ({ ...p })) },
      };
      return;
    }
    this.focus.set(null);
    this.drag = {
      kind: 'pan',
      start: { x: event.clientX, y: event.clientY },
      origin: world,
      panX: this.panX(),
      panY: this.panY(),
    };
  }

  onPointerMove(event: PointerEvent): void {
    const world = this.pointerWorld(event);
    if (!world) {
      return;
    }
    this.cursor.set(world);
    const plan = this.store.plan();
    if (!this.drag) {
      this.hover.set(this.addMode() && this.drawing()?.length ? null : hitTestFloor(plan, world));
      return;
    }
    if (this.drag.kind === 'pan') {
      const view = this.view();
      const svg = this.svg()?.nativeElement;
      if (!svg) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - this.drag.start.x) * view.width) / Math.max(rect.width, 1);
      const dy = ((event.clientY - this.drag.start.y) * view.height) / Math.max(rect.height, 1);
      this.panX.set(this.drag.panX - dx);
      this.panY.set(this.drag.panY - dy);
      return;
    }
    const shape = this.drag.shape ?? shapeById(plan, this.drag.shapeId ?? '');
    if (!shape || this.drag.index == null) {
      return;
    }
    if (this.drag.kind === 'vertex') {
      const snapped = orthoSnap(world, otherVertices(plan, { shapeId: shape.id, index: this.drag.index }));
      this.store.replaceActive(replaceShape(plan, moveVertex(shape, this.drag.index, snapped)));
      this.focus.set({
        kind: 'vertex',
        shapeId: shape.id,
        index: this.drag.index,
        role: shape.id === plan.outer.id ? 'outer' : 'obstacle',
      });
      return;
    }
    const raw = { x: world.x - this.drag.origin.x, y: world.y - this.drag.origin.y };
    const moved = moveEdge(shape, this.drag.index, raw);
    const others = otherVertices(plan, { shapeId: shape.id, index: this.drag.index });
    const snapped = orthoSnap(moved.points[this.drag.index], others);
    const aligned = {
      x: snapped.x - shape.points[this.drag.index].x,
      y: snapped.y - shape.points[this.drag.index].y,
    };
    this.store.replaceActive(replaceShape(plan, moveEdge(shape, this.drag.index, aligned)));
  }

  onPointerUp(): void {
    this.drag = null;
  }

  onContextMenu(event: Event): void {
    event.preventDefault();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = this.zoom();
    const newZoom = Math.min(6, Math.max(0.25, oldZoom * factor));
    if (newZoom === oldZoom) {
      return;
    }
    const world = this.world();
    this.panX.update((x) => x + (world.width / oldZoom - world.width / newZoom) / 2);
    this.panY.update((y) => y + (world.height / oldZoom - world.height / newZoom) / 2);
    this.zoom.set(newZoom);
  }

  deleteFocused(): void {
    const focus = this.focus();
    if (focus?.kind !== 'vertex') {
      return;
    }
    const plan = this.store.plan();
    const shape = shapeById(plan, focus.shapeId);
    if (!shape) {
      return;
    }
    if (focus.role === 'outer') {
      const next = removeVertex(shape, focus.index);
      if (!next) {
        return;
      }
      this.store.replaceActive(replaceShape(plan, next));
      this.focus.set(null);
      return;
    }
    if (shape.points.length <= 3) {
      this.store.replaceActive({
        ...plan,
        obstacles: plan.obstacles.filter((item) => item.id !== shape.id),
      });
      this.focus.set(null);
      return;
    }
    const next = removeVertex(shape, focus.index);
    if (next) {
      this.store.replaceActive(replaceShape(plan, next));
    }
    this.focus.set(null);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.focus.set(null);
      this.addMode.set(false);
      this.drawing.set(null);
      return;
    }
    const focus = this.focus();
    if (!focus || this.addMode()) {
      return;
    }
    const step =
      event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown'
        ? event.shiftKey
          ? CM_NUDGE_LARGE_STUDS
          : CM_NUDGE_STUDS
        : 0;
    if (!step) {
      return;
    }
    event.preventDefault();
    const delta = {
      x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    };
    const plan = this.store.plan();
    const shape = shapeById(plan, focus.shapeId);
    if (!shape) {
      return;
    }
    const next =
      focus.kind === 'vertex'
        ? moveVertex(shape, focus.index, {
            x: shape.points[focus.index].x + delta.x,
            y: shape.points[focus.index].y + delta.y,
          })
        : moveEdge(shape, focus.index, delta);
    this.store.replaceActive(replaceShape(plan, next));
  }

  private handleAddClick(world: Point, hit: FloorHit | null, plan: FloorPlan): void {
    const drawing = this.drawing();
    if (drawing?.length) {
      const first = drawing[0];
      if (drawing.length >= 3 && distance(world, first) <= CLOSE_LOOP_STUDS) {
        this.finishObstacle(drawing);
        return;
      }
      const snapped = orthoSnap(world, [...drawing, ...otherVertices(plan)]);
      this.drawing.set([...drawing, snapped]);
      return;
    }
    if (hit?.kind === 'edge') {
      const shape = shapeById(plan, hit.shapeId);
      if (!shape) {
        return;
      }
      const next = insertVertex(shape, hit.index, hit.at);
      this.store.replaceActive(replaceShape(plan, next));
      this.addMode.set(false);
      this.focus.set({
        kind: 'vertex',
        shapeId: next.id,
        index: hit.index + 1,
        role: hit.role,
      });
      return;
    }
    const start = orthoSnap(world, otherVertices(plan));
    this.drawing.set([start]);
  }

  private finishObstacle(points: Point[]): void {
    const plan = this.store.plan();
    const obstacle: FloorShape = { id: nextObstacleId(plan), points };
    this.store.replaceActive({ ...plan, obstacles: [...plan.obstacles, obstacle] });
    this.drawing.set(null);
    this.addMode.set(false);
    this.focus.set(null);
  }

  private undoDrawingPoint(): void {
    const drawing = this.drawing();
    if (!drawing?.length) {
      return;
    }
    if (drawing.length === 1) {
      this.drawing.set(null);
      return;
    }
    this.drawing.set(drawing.slice(0, -1));
  }

  private snappedCursor(): Point | null {
    const cursor = this.cursor();
    const drawing = this.drawing();
    if (!cursor) {
      return null;
    }
    const plan = this.store.plan();
    return orthoSnap(cursor, [...(drawing ?? []), ...otherVertices(plan)]);
  }

  private pointerWorld(event: PointerEvent): Point | null {
    const svg = this.svg()?.nativeElement;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    const view = this.view();
    return {
      x: view.minX + ((event.clientX - rect.left) / Math.max(rect.width, 1)) * view.width,
      y: view.minY + ((event.clientY - rect.top) / Math.max(rect.height, 1)) * view.height,
    };
  }

  private shapeView(
    shape: FloorShape,
    role: 'outer' | 'obstacle',
    hover: FloorHit | null,
    focus: EditorFocus | null,
  ) {
    const count = shape.points.length;
    const edges = shape.points.map((point, index) => {
      const next = shape.points[(index + 1) % count];
      const hovered = hover?.kind === 'edge' && hover.shapeId === shape.id && hover.index === index;
      const focused = focus?.kind === 'edge' && focus.shapeId === shape.id && focus.index === index;
      return {
        index,
        points: `${point.x},${point.y} ${next.x},${next.y}`,
        hovered,
        focused,
        length: formatLengthCm(segmentLength(point, next)),
        label: this.labelAt(point, next),
      };
    });
    const vertices = shape.points.map((point, index) => ({
      index,
      point,
      hovered: hover?.kind === 'vertex' && hover.shapeId === shape.id && hover.index === index,
      focused: focus?.kind === 'vertex' && focus.shapeId === shape.id && focus.index === index,
    }));
    return {
      id: shape.id,
      role,
      polygon: shape.points.map((point) => `${point.x},${point.y}`).join(' '),
      edges,
      vertices,
    };
  }

  private labelAt(a: Point, b: Point): { x: number; y: number } {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {
      x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * 7,
      y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * 7,
    };
  }
}
