# Domain model

The planner works with **LEGO City plastic train tracks**. Units are **studs**.

## Catalog

| id | Ports | Role |
| --- | --- | --- |
| `straight-16` | 2 | 16-stud straight |
| `curve-22` | 2 | 22.5° R40 curve. Sixteen make a circle. |
| `switch-left` | 3 | 32-stud through plus a left S-curve diverge (ends at 22.5°). One extra curve runs parallel. |
| `switch-right` | 3 | Same, diverge to the right. |
| `crossing-90` | 4 | Plus crossing, routes do not join |
| `double-crossover` | 4 | Assembled 7996, 48 studs long, parallel centerlines 16 studs apart |
| `buffer-stop` | 1 | Parking terminator |
| `flex-track` | 2 | Backup closer for a near-miss gap |

Source notes live in `public/catalog/city-tracks.json` and `src/app/core/catalog/city-tracks.ts`.

## Geometry rules

- Two ports connect when they coincide within 0.35 studs and headings differ by ~180°.
- Footprints may touch at connector faces; bodies may not overlap.
- A closed loop of City curves needs **16 curves** (360°). Straights do not add turn.
- Flex may join two leftover ports only when chord and bend fit `lengthStuds=16`, `minChordStuds=6`, `maxBendDegrees=50`.
- One flex piece per gap. Flex is never a seed and never a normal search candidate.

## Layout features

- **Passing lane:** two opposite-hand switches on one long straight, diverges joined so a second track runs beside the mainline and merges again. Needs a long gap (about 6–8 straights), not two adjacent switches.
- **Parking spot:** dead-end siding from a leftover diverge, preferably about five straights (80 studs) clear of the switch. The generator aims at `targetParkingSpots` and should not park every unused diverge.
- **Reverse options:** `dead-end`, `reversing-loop`, `wye`.
- An open port is parking, a flex candidate, or an unfinished connector. Only unfinished connectors penalize the score.

## Snapshots

File format `lego-track-designer.snapshot` version 1. Fields: `seed`, `preferences`, `inventory`, `layout`, `summary`. See `src/app/core/export/snapshot.ts` and [GENERATOR.md](GENERATOR.md).

## Persistence keys

- `lego-track-designer.inventory.v1`
- `lego-track-designer.layout.v1`
