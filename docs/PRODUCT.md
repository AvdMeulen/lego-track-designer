# Product

## Problem

LEGO City train sets come with a limited mix of straights, curves, switches, and extras. Combining several sets still leaves a hard question: **what complete layout can I actually build with the pieces on the table?**

## Goal

Visualization first. A builder draws the room, records owned City tracks, generates a network that fits that floor, and sees **which physical part is used where**, well enough to recreate it on the floor.

The last design survives a browser refresh. It can be exported as a labeled PNG, or as a JSON snapshot that another session can import.

## Users

A single builder at home. No accounts. Inventory, preferences, and the current layout live in the browser.

## Primary flow

1. Open the app and draw the available floor (walls and furniture).
2. Set inventory quantities (or keep the last collection).
3. Choose parking count, then generate a layout (or rebuild the same seed).
4. Inspect numbered parts on the canvas and in the piece list.
5. Export PNG, export/copy JSON, or refresh — the design is still there.
6. Generate another, import a snapshot, or adjust the room.

## First catalog

Straight 16, curve 22.5°, left/right switch, 90° crossing, assembled 7996 double crossover, buffer stop, flexible track (gap closer only).

## Success criteria

- Never use more pieces than inventory.
- Show every placed part with a number, color, and name.
- Support parking dead-ends, alternate circular routes via switches, and direction change — not only a single circle.
- Use most of a large collection instead of a small rectangle with leftover piles.
- Use flex only to close a small remaining gap.
- Persist the design, export a readable PNG, and share a JSON snapshot.
