# Product

## Problem

LEGO City train sets come with a limited mix of straights, curves, switches, and extras. Combining several sets still leaves a hard question: **what complete layout can I actually build with the pieces on the table?**

Trial and error on the floor is slow. Overlaps, leftover unused connectors, and pieces that do not close a loop are easy to miss.

## Goal

Let a builder:

1. Record which LEGO City train track parts they own, including quantities.
2. Generate one or more valid layout suggestions from that inventory.
3. See the suggestion as a clear visual design they can recreate physically.

## Users

The first user is a single builder at home. There is no account system in the first versions. Inventory can live in the browser.

## Primary flow

1. Open the app.
2. Select parts from a catalog of official LEGO City train tracks.
3. Set a quantity for each owned part.
4. Choose generation preferences (closed loop, compact footprint, use as many pieces as possible).
5. Generate a layout.
6. Inspect the canvas, piece list, and leftover inventory.
7. Regenerate or adjust quantities and try again.
8. Optionally export or print the design.

## Out of scope for the first release

- 3D brick-accurate rendering
- Powered Up / motor / train path simulation
- Duplo, monorail, or 9V metal-rail systems
- Multi-user accounts or cloud sync
- Automatic shopping lists for missing pieces

Those can follow once a 2D planner produces reliable layouts.

## Success criteria

A first useful version should:

- Cover the common City track types: straight, curve, left/right switch, and crossing.
- Produce a layout that does not overlap and that respects connector geometry.
- Never use more pieces than the entered inventory.
- Show the result in a way a builder can follow on the floor.
