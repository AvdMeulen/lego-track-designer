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
  core/layout-engine/      Geometry, collide, generate, fixtures, flex closer
  core/layout-analysis/    Parking, reverse options, cycles
  core/export/             SVG to PNG, JSON snapshot import/export
  core/storage/            localStorage adapter
  features/home/
  features/inventory/
  features/designer/
```

## Data flow

Catalog → inventory page → inventory store → designer → `generateLayout` → flex closer → layout store → analysis → labeled canvas → PNG or JSON snapshot.

## Engine

Grow a closed organic core first (stock-weighted tree or wander-home; wavy eight-corner ring if those cannot close). Then features: a long wander branch from each switch/crossover, compact City passing only as fallback, keerlus, 90° crossing, at most `targetParkingSpots` sidings. Score picks among candidates. Flex closes a leftover near-miss only.

Details, instance-id prefixes, and snapshot-driven rules: [GENERATOR.md](GENERATOR.md).

## Testing

Golden fixtures live next to geometry (`fixtures.spec.ts`): 16-curve circle, oval, 15-curve refusal, switch/crossing/crossover, flex accept/refuse.

Generator regressions live in `generate.spec.ts`: closed loops, parking sidings, S-bends, large-collection specials and leftovers. Snapshot parse/build is in `export/snapshot.spec.ts`.
