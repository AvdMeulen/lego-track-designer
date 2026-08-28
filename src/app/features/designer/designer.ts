import { Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { exportSvgElementToPng } from '../../core/export/png-export';
import { downloadJson, parseSnapshotText } from '../../core/export/snapshot';
import { TPipe } from '../../core/i18n/t.pipe';
import { FloorPlanStore } from '../../core/floor-plan/floor-plan.store';
import { agentQueryKey, parseAgentQuery } from '../../core/layout-store/agent-query';
import { LayoutStore } from '../../core/layout-store/layout.store';
import { TrackCanvas } from '../../shared/canvas/track-canvas';

@Component({
  selector: 'app-designer',
  imports: [FormsModule, RouterLink, TrackCanvas, TPipe],
  templateUrl: './designer.html',
  styleUrl: './designer.scss',
})
export class Designer {
  protected readonly store = inject(LayoutStore);
  protected readonly floorPlan = inject(FloorPlanStore);
  private readonly route = inject(ActivatedRoute);
  private readonly canvasHost = viewChild<ElementRef<HTMLElement>>('canvasHost');
  private readonly canvas = viewChild(TrackCanvas);
  private readonly snapshotFile = viewChild<ElementRef<HTMLInputElement>>('snapshotFile');
  private readonly pieceList = viewChild<ElementRef<HTMLUListElement>>('pieceList');
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private lastQueryKey = '';

  protected readonly snapshotStatus = signal<string | null>(null);

  constructor() {
    effect(() => {
      const label = this.store.selectedLabel();
      const list = this.pieceList()?.nativeElement;
      if (label == null || !list) {
        return;
      }
      queueMicrotask(() => {
        list.querySelector<HTMLElement>('li.active')?.scrollIntoView({ block: 'nearest' });
      });
    });
    effect(() => {
      const query = parseAgentQuery(this.queryParams());
      const key = agentQueryKey(query);
      if (key === this.lastQueryKey) {
        return;
      }
      this.lastQueryKey = key;
      untracked(() => {
        if (!query.generate) {
          if (query.scene) {
            this.store.applySetup({
              scene: query.scene,
              ...(query.parking != null ? { parking: query.parking } : {}),
            });
          } else if (query.parking != null) {
            this.store.updatePreferences({ targetParkingSpots: query.parking });
          }
          if (query.seed != null) {
            this.store.seed.set(query.seed);
          }
          return;
        }
        void this.store.runGeneration({
          ...(query.seed != null ? { seed: query.seed } : { increment: true }),
          ...(query.parking != null ? { parking: query.parking } : {}),
          ...(query.scene ? { scene: query.scene } : {}),
        });
      });
    });
  }

  setParking(value: string): void {
    const parsed = Number(value);
    const target = parsed >= 2 ? 2 : parsed >= 1 ? 1 : 0;
    this.store.updatePreferences({ targetParkingSpots: target });
  }

  generate(): void {
    this.store.generate();
  }

  rebuild(): void {
    this.store.rebuild();
  }

  async exportPng(): Promise<void> {
    const svg = this.canvasHost()?.nativeElement.querySelector('svg');
    if (svg) {
      await exportSvgElementToPng(
        svg,
        `lego-track-design-${this.store.currentSeed()}.png`,
        this.canvas()?.fullViewBox(),
      );
    }
  }

  exportJson(): void {
    downloadJson(`lego-track-snapshot-${this.store.currentSeed()}.json`, this.store.exportSnapshot());
    this.snapshotStatus.set('designer.snapshotExported');
  }

  async copyJson(): Promise<void> {
    const text = JSON.stringify(this.store.exportSnapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.snapshotStatus.set('designer.snapshotCopied');
    } catch {
      this.exportJson();
    }
  }

  openImport(): void {
    this.snapshotFile()?.nativeElement.click();
  }

  async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    const snapshot = parseSnapshotText(await file.text());
    if (!snapshot) {
      this.snapshotStatus.set('designer.snapshotInvalid');
      return;
    }
    this.store.importSnapshot(snapshot);
    this.snapshotStatus.set('designer.snapshotImported');
  }
}
