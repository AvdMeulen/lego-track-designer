import { Injectable } from '@angular/core';
import { TrackPart } from '../../shared/models/track';
import { CITY_TRACKS, CITY_TRACKS_BY_ID } from './city-tracks';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  readonly parts: readonly TrackPart[] = CITY_TRACKS;

  byId(id: string): TrackPart {
    const part = CITY_TRACKS_BY_ID[id];
    if (!part) {
      throw new Error(`Unknown catalog part: ${id}`);
    }
    return part;
  }

  color(id: string): string {
    return this.byId(id).color;
  }
}
