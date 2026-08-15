# Roadmap

The suggestion below is the build order I recommend after this boilerplate.

## Phase 0 — Foundation (done)

- Angular 20 app with routing and SCSS
- App shell and home page
- Documentation
- Local Git repository ready for a GitHub remote

## Phase 1 — Catalog and inventory

Goal: the user can say which parts they have.

- Add TypeScript models for parts, ports, and inventory
- Add a first catalog JSON with straights, curves, and switches
- Build an inventory page with quantity steppers
- Persist inventory in `localStorage`
- Show a simple summary: total pieces, estimated loop potential

Exit check: refresh the browser and the entered collection is still there.

## Phase 2 — Geometry and a known layout

Goal: prove that pieces can be placed correctly.

- Implement connector matching and collision tests
- Hard-code or generate the classic 16-curve circle
- Draw it with SVG
- Add zoom and pan on the canvas

Exit check: the circle closes visually and in the connection graph.

## Phase 3 — Generator

Goal: invent a layout from inventory.

- Backtracking search with inventory limits
- Preferences: closed loop, compact, use more pieces
- Progress and timeout in the UI
- Show unused pieces after generation
- "Generate another" using a different random seed

Exit check: an inventory of 16 curves produces a circle. An inventory of 8 curves and 8 straights produces an oval.

## Phase 4 — Switches and richer layouts

Goal: support real City collections.

- Left and right switches
- Optional crossing
- Multiple loops and sidings
- Warn when inventory cannot close a loop
- Piece-by-piece build list ordered from a start point

Exit check: a small mixed collection produces a loop with one siding.

## Phase 5 — Polish

- Print / SVG export
- Inventory presets for common City train sets
- Better part artwork
- Mobile-friendly inventory entry
- Headless tests in CI after GitHub is connected

## Recommended first implementation slice

When feature work starts, do **Phase 1 + the circle test from Phase 2** before investing in a full search algorithm. Wrong measurements will waste more time than a simple UI.

## Open decisions

These can wait until the matching phase:

- Exact official element IDs in the catalog
- Studs vs millimeters as the internal unit (recommendation: studs)
- Whether generation runs on the main thread or in a Web Worker
- Whether a second layout algorithm is needed after backtracking
