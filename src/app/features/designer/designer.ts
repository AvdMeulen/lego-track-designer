import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogService } from '../../core/catalog/catalog.service';
import { exportSvgElementToPng } from '../../core/export/png-export';
import { TPipe } from '../../core/i18n/t.pipe';
import { allFixtures } from '../../core/layout-engine/fixtures';
import { LayoutStore } from '../../core/layout-store/layout.store';
import { TrackCanvas } from '../../shared/canvas/track-canvas';

@Component({
  selector: 'app-designer',
  imports: [FormsModule, RouterLink, TrackCanvas, TPipe],
  templateUrl: './designer.html',
  styleUrl: './designer.scss',
})
export class Designer {
  protected readonly catalog = inject(CatalogService);
  protected readonly store = inject(LayoutStore);
  private readonly canvasHost = viewChild<ElementRef<HTMLElement>>('canvasHost');
  private readonly canvas = viewChild(TrackCanvas);

  protected readonly fixtures = allFixtures();

  setParking(value: string): void {
    const parsed = Number(value);
    const target = parsed >= 2 ? 2 : parsed >= 1 ? 1 : 0;
    this.store.updatePreferences({ targetParkingSpots: target });
  }

  generate(another = false): void {
    this.store.generate(another);
  }

  showFixture(id: string): void {
    const fixture = this.fixtures.find((item) => item.id === id);
    if (fixture) {
      this.store.show(fixture.layout);
    }
  }

  async exportPng(): Promise<void> {
    const svg = this.canvasHost()?.nativeElement.querySelector('svg');
    if (svg) {
      await exportSvgElementToPng(svg, 'lego-track-design.png', this.canvas()?.fullViewBox());
    }
  }
}
