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

Closed rings first (octagon / irregular / wobble, plus a wander-home attempt), then decoration: random arc, crossover, switch pairs, passing lanes, at most `targetParkingSpots` sidings. Score picks among those candidates. Point-to-point and switch-led search run only when nothing looped. Flex closes a leftover near-miss only.

Details, instance-id prefixes, and snapshot-driven rules: [GENERATOR.md](GENERATOR.md).

## Testing

Golden fixtures live next to geometry (`fixtures.spec.ts`): 16-curve circle, oval, 15-curve refusal, switch/crossing/crossover, flex accept/refuse.

Generator regressions live in `generate.spec.ts`: parking sidings, S-bends, large-collection seeds 14–18 (no adjacent switches, no tentacle, passing lanes, unused curves, off-box shape). Snapshot parse/build is in `export/snapshot.spec.ts`.
