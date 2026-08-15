# Architecture

## Principles

- Keep generation out of Angular components.
- Treat the catalog as data (`city-tracks.ts` / `public/catalog/city-tracks.json`).
- Persist inventory, preferences, and the current layout in `localStorage`.
- Render a labeled SVG so a builder can see which part is where.
- Export that labeled view as PNG.

## Folders

```text
src/app/
  shared/models/           Track types
  shared/canvas/           Labeled SVG + legend
  core/catalog/            Eight City parts
  core/inventory/          Quantities, presets, localStorage
  core/layout-store/       Current design + preferences
  core/layout-engine/      Geometry, collide, fixtures, search, flex closer
  core/layout-analysis/    Parking, reverse options, cycles
  core/export/             SVG to PNG
  core/storage/            localStorage adapter
  features/home/
  features/inventory/
  features/designer/
```

## Data flow

Catalog → inventory page → inventory store → designer → rigid search → flex closer → layout store → analysis → labeled canvas → PNG export.

## Engine

1. Constructive rounded loop when 16 curves are available.
2. Point-to-point when a closed loop is not possible.
3. Switch-led sidings for parking.
4. Timed backtracking for leftover rigid pieces.
5. Flex closer for leftover near-miss ports only.

## Testing

Golden tests live next to the engine: 16-curve circle, oval fixture, 15-curve refusal, switch/crossing/crossover fixtures, parking siding, flex accept/refuse.
