# Layout generator

How `generateLayout` builds a City network from inventory and an optional floor plan.

The engine lives in `src/app/core/layout-engine/` (`generate.ts` orchestrates `explore.ts`, `wander.ts`, `features.ts`, `score.ts`). Room collision lives in `floor-plan/space.ts`. Analysis stays in `layout-analysis/`. Share a failed or interesting result as a JSON snapshot from the designer. To have an agent generate on the running site and score the result, follow [AGENT.md](AGENT.md). To compare many eval seeds without the browser, run the [quality bench](#quality-bench).

## Solution direction

Grow a **network of equal heads** through the available floor, then join them. Do not start from a closed oval and decorate it.

Every open port is a turtle. Straights and curves follow the walls and uncovered floor. A switch turns one head into **two** full paths (through and diverge). Those paths wander like any other track, then rejoin. Rare pieces are placed unless they physically will not fit, and they are spread apart.

Track may **touch** a wall or furniture edge. It may not cross a wall or overlap the inside of an obstacle. If the builder wants a gap, they draw a smaller room or a larger obstacle.

## What a good layout looks like

Typical test collection: 58× `straight-16`, 97× `curve-22`, 2 left + 2 right switches, 1 double crossover.

Parking is **off by default**. Rare pieces are used when they fit. The only allowed open ports are requested parking ends.

Expect:

- An **organic circuit** that follows the room, not a four-sided diamond or stadium.
- **Both exits of every non-parking switch** grow as real paths and come back together. A leftover head with parking off becomes a reversing loop.
- **Most of the inventory used.** Leftovers are pieces that would overlap track, wall, or furniture.
- About **80%** of runs closed (or keerlus); an open path is a rare fallback.

## Pipeline

Default search budget is 4 seconds. The designer pauses the deadline while a phase is on screen.

1. **Explore** (`exploreSpace`): seed inside the room (or at the origin), grow heads, place switches with a minimum gap, join nearby heads.
2. If that network is not closed, fall back to wander-home or a 16-curve circle **only when that shape still fits the room**.
3. **Crossover / switch features** for leftover specials, then inflate leftover straights and curves.
4. **Parking** last. Flex closes a leftover near-miss only. Fifteen curves must not close with flex.
5. Score candidates; pick the best. `generateLayout()` stays synchronous for tests. The designer uses `generateLayoutAsync()`.

Instance-id prefixes: `ex` explore, `sw` switch, `jn` join, plus the older feature prefixes (`xo`, `rte`, `kel`, `sid`, `inf`, `w`, `c`).

## Quality bench

Bulk eval-scene runs go through `generateLayout` (same engine as the designer, no browser). Use this when comparing seeds, judging leftover stock, or checking whether a generator change moved the product bar. For a single layout on the running site, follow [AGENT.md](AGENT.md).

```bash
npm run bench:generator                            # 100 runs, parking 2, seeds 1–100
npm run bench:generator -- 20                      # 20 runs
npm run bench:generator -- 100 2 1                 # runs, parking (0|1|2), start seed
npx --yes tsx scripts/bench-generator.ts 100 2 1   # same, without the npm script
```

Each run uses the eval L-room and collection from `agent-scene.ts`, search budget 4 seconds (same default as the designer). Progress goes to stderr. A summary JSON (without needing the site) prints to stdout; the full per-seed table is written to `scripts/bench-generator-results.json` (gitignored).

Rates to read first, in the same order as [AGENT.md](AGENT.md):

| Field | Pass looks like |
| --- | --- |
| `rates.coreGood` / `closedPct` | Closed loop (`loop` and `unfinishedPorts === 0`). Product bar: about 80% closed. |
| `rates.parkExact` | Parking found equals the requested target. |
| `rates.bothArms` | Track in both arms of the eval L. |
| `rates.crossover` / `rates.allSwitches` | Double crossover and spare switches used when they fit. |
| `rates.flexUsed` | Flex only as a small gap closer (not a 15-curve close). |
| `unusedRigid.median` | Leftovers that would collide, not a half-empty collection. |
| `rates.gold` | Closed + parking match + crossover + all switches + both arms + one group + no isolated `in*` circles. |

A smoke check is `npm run bench:generator -- 1`. A hundred eval runs take on the order of 8–10 minutes.

## Scoring

Rewarded: unused rigid pieces near zero, specials used and spread, independent cycles, parking match, coverage of the floor.

Penalized: unused specials, unfinished ports, extra parking, adjacent switches, flex, a four-sided cardinal rectangle, tiny two-curve bypasses.

## Snapshots

Designer export is `lego-track-designer.snapshot` version 1. An optional `floorPlan` field carries the room. Older files without it still import.
