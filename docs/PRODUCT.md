# Product

## Problem

LEGO City train sets come with a limited mix of straights, curves, switches, and extras. Combining several sets still leaves a hard question: **what complete layout can I actually build with the pieces on the table?**

## Goal

Visualization first. A builder records owned City tracks, generates a network layout, and sees **which physical part is used where**, well enough to recreate it on the floor.

The last design survives a browser refresh and can be exported as a labeled PNG.

## Users

A single builder at home. No accounts. Inventory, preferences, and the current layout live in the browser.

## Primary flow

1. Open the app and set inventory quantities (or a set preset).
2. Choose preferences: parking count, reversing route, flex gap-closes, compact.
3. Generate a layout.
4. Inspect numbered parts on the canvas and in the piece list.
5. Export PNG or refresh — the design is still there.
6. Generate another or adjust inventory.

## First catalog

Straight 16, curve 22.5°, left/right switch, 90° crossing, assembled 7996 double crossover, buffer stop, flexible track (gap closer only).

## Success criteria

- Never use more pieces than inventory.
- Show every placed part with a number, color, and name.
- Support parking dead-ends and direction change, not only a single circle.
- Use flex only to close a small remaining gap.
- Persist the design and export a readable PNG.
