import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { exportSvgElementToPng } from '../../core/export/png-export';
import { downloadJson, parseSnapshotText } from '../../core/export/snapshot';
import { TPipe } from '../../core/i18n/t.pipe';
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
  private readonly canvasHost = viewChild<ElementRef<HTMLElement>>('canvasHost');
  private readonly canvas = viewChild(TrackCanvas);
  private readonly snapshotFile = viewChild<ElementRef<HTMLInputElement>>('snapshotFile');

  protected readonly snapshotStatus = signal<string | null>(null);

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
      await exportSvgElementToPng(svg, 'lego-track-design.png', this.canvas()?.fullViewBox());
    }
  }

  exportJson(): void {
    downloadJson(`lego-track-snapshot-seed-${this.store.currentSeed()}.json`, this.store.exportSnapshot());
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
