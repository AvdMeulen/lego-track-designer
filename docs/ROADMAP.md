# Roadmap

## Phase 0 — Foundation (done)

Angular 20 app, docs, GitHub remote `AvdMeulen/lego-track-designer`.

## Slice A — Catalog + inventory (done)

Eight-part catalog, inventory page, presets, `localStorage`.

## Slice B — Geometry + labeled canvas (done)

Connect/collide, fixtures, numbered SVG, PNG export.

## Slice C — Generator + saved design (done)

Rigid search, flex closer, layout persistence.

## Slice D — Parking and reversing (done)

Graph analysis for parking spots, dead-end reverse, reversing loop, wye.

## Slice E — Polish (done)

Set presets, richer silhouettes/colors, GitHub Actions CI.

## Slice F — Shareable layouts and generator quality (done)

JSON snapshot import/export. Switch artwork as one S. Generator prefers closed loops with passing lanes, one parking siding, leftover curves spent on wobbles / octagons / a random arc — not a box with four dead-ends. Lessons: [GENERATOR.md](GENERATOR.md).

## Slice G — Organic generator (done)

Path-first generator: wander in 22.5° steps, close every switch exit except requested parking, spend leftovers as detours. No rectangle template. Parking options follow switch count; default is 0.

## Slice H — Useful switch branches (done)

Switches and the crossover grow a wander branch (eight or more mixed pieces) instead of a stadium oval or a two-curve City passing bubble. Compact passing stays a last resort. The designer shows each generation phase on the canvas. Details: [GENERATOR.md](GENERATOR.md).

## Slice I — Room-constrained organic (done)

Draw a floor plan (outer wall + furniture polygons), persist it, and generate a circuit that stays on the playable floor. Heads grow equally after each switch and rejoin. Track may touch walls; extra clearance is the builder's job.

## Later

Richer room-scale shapes, using the double crossover more often, 3D bricks, train animation, switch-lever states, PDF print, chaining several flex pieces, third-party crossovers.
