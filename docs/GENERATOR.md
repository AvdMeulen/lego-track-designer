# Layout generator

How `generateLayout` builds a City network, and the rules that came out of iterating on real snapshots.

The engine lives in `src/app/core/layout-engine/generate.ts`. Analysis (parking, reverse, cycles) is separate in `layout-analysis/`. Share a failed or interesting result as a JSON snapshot from the designer — that is the source of truth for the next change.

## What a good large layout looks like

Typical test collection: 58× `straight-16`, 97× `curve-22`, 2 left + 2 right switches, 1 double crossover.

Preferences that match how the app is used: `targetParkingSpots: 1`, `preferReversingRoute`, `preferMorePieces`, `loopPlusParking`, `allowFlexCloses`, `compact: false`.

Expect:

- A **closed mainline** (no leftover ports on the loop).
- **At least one passing lane**: two switches on the same long straight, diverges rejoined so a train can run beside the mainline and merge again.
- **At most one parking siding** when the target is 1. Do not turn every unused diverge into a dead-end.
- **A long gap between the paired switches** (about 6–8 straights / 96+ studs). Two curves between almost-adjacent switches is not a useful passing loop.
- **A shape that is not a rectangle.** Extra curves become S-bends, jogs, wobbles, an octagon or irregular ring, a wander-home loop, or one replaced random arc.
- **Most of the inventory used.** Leaving tens of curves unused is a miss. A few leftovers for parking or a failed crossover insert are acceptable.

## Pipeline

1. **Budget first**, then build. Reserve a long passing run, one parking siding, and only keep the crossover if its second track actually closes. Do not decorate leftovers into extra dead-ends.
2. Build candidate **rings** from the remaining stock:
   - wobble octagon and irregular 5–8-gon first
   - wobble rectangle / oval as fallback
   - `wanderHomeLoop`: place freely, then home to the start port
3. For each closed ring, **place features**:
   - `wanderReplaceArc` — cut one unprotected arc and grow it at random (`rnd*`)
   - one facing pair on a run of at least 10 straights, plus **one** spare switch when parking is requested
   - try the crossover **between** that pair and join both diverges to its open ports; **revert the crossover** if those ports stay empty
   - otherwise `buildPassingLane` between the pair; keep `targetParkingSpots` diverges open
   - add **exactly** `targetParkingSpots` sidings and lengthen that siding with leftovers (do not start a second stub)
4. Also try a crossover-only parallel fixture and, if nothing looped, point-to-point or switch-led search.
5. Score all candidates. Prefer closed loops when `loopPlusParking` is on.

Flex runs last, and only to close a small leftover gap. Fifteen curves must not close with flex.

## Instance id prefixes

| Prefix | Meaning |
| --- | --- |
| `p*` | Sequence-built ring |
| `w*` | Wander-home loop |
| `rnd*` | Random replacement arc |
| `par*` | Passing-lane pieces |
| `sid*` | Parking siding |
| `xo*` | Double crossover |
| `ret*` | Grow/retry pieces (kept only if they join) |

A snapshot that is only `p1…pN` plus four `sid*` chains is the old “wobbly rectangle + four parkings” failure mode.

## City geometry that the generator depends on

- **Curve:** 22.5°, R40. Sixteen same-direction curves are 360°. Straights add no turn. Opposite-port pairs (`a` then `b`) are an S-bend: heading returns, the track shifts sideways.
- **Switch:** 32-stud through (two straights). The diverge is an S-curve that ends at 22.5°. One extra curve on the diverge runs **parallel** to the through route. Artwork is one continuous S, same bed width as a straight — not a self-crossing centerline.
- **Double crossover:** 48 studs long (three straights), parallel routes 16 studs apart.
- Ports connect within 0.35 studs and ~180° heading. Footprints may touch at faces, not overlap.

## Passing lanes

A useful passing loop needs **opposite-hand** switches on the **same** long run, far apart, facing each other on the **outside** of the loop.

- West + east on an eastbound side, outward south: right switch at the west end, left switch at the east end (or the mirror on the other lateral).
- Same-hand switches with the same rotation both send the diverge the same way. That does not make a short facing lane.
- Same-hand switches flipped 180° put diverges on **opposite** laterals.
- `facePassingSwitches` tries the four flip combinations and keeps the pair whose diverges are close and away from the centroid (outside).
- Do not flip a working same-side pair onto opposite laterals just to “point outward” for parking.
- Do not place switches adjacent (stem-to-stem). Minimum useful pair is a run of about 12 straights so that after each switch eats two studs of through, 6–8 straights remain between them.
- `buildPassingLane` first tries `wanderToPort` so the two routes can leave the mainline and rejoin on their own path. If that misses, it falls back to `curve + N straights + curve` (and straight-only). Keep the result only if the **target diverge is closed**.
- When a crossover sits between the pair, prefer joining each diverge to a crossover port instead of cloning the mainline.
- `growToward` must return the **original** parts when it does not meet the target. A “successful” path that never joins produced the long diagonal tentacle (seed 15).

Parking is a leftover diverge plus about five straights (`PARK_STRAIGHTS`). Cap long parks; do not spend the rest of the inventory on four dead-ends.

## Shape

Equal-length rectangle sides were required to close early loops (the Y-shape bug). That made every large layout a box.

Now:

- Spend extra curves on **balanced opposite-side** wobbles, jogs, and S-bends so the loop still closes.
- Prefer an **octagon** or **irregular polygon** (random 1–4 curve corners that still sum to 16 turns).
- Concentrate long straight runs on **two perpendicular sides** (not only east–west) so switches can sit on any heading. Rectangle rings may flip which pair of sides is long.
- `wanderHomeLoop` may produce a fully irregular closed path (`w*`).
- `wanderReplaceArc` replaces one non-switch arc so part of an otherwise structured ring goes off-box.

A wobbly rectangle can still win on piece count. Scoring therefore penalizes a high share of axis-aligned straights and rewards heading variety and long passing spans.

## Scoring (what we optimize)

Rewarded: closed loop, more pieces (no 80-piece cap), reversing loops/wyes, specials used, parking length near the target, **passing** (closed diverges minus parking spots), **span between aligned switches**, heading variety.

Penalized: unused rigid/special pieces, extra parking beyond the target, tentacle sidings longer than eight straights, boxy cardinal ratio, adjacent switches, unfinished ports on a loop, flex.

Unfinished ports on a closed mainline should only be unused branch ports. Do not keep a grow path that failed to join.

## Snapshots

Designer export is `lego-track-designer.snapshot` version 1 (`src/app/core/export/snapshot.ts`):

- `seed`, `preferences`, `inventory`
- full `layout` (parts, connections, unused, parking, reverse, marks, score)
- `summary` (counts and used/unused maps)

Import restores inventory, preferences, and the drawn layout so a seed can be discussed without regenerating. When changing the generator, paste the snapshot JSON into chat and treat unused counts, `par*` / `sid*` ids, and switch spacing as the bug report.

## Regression seeds

Large-collection tests in `generate.spec.ts` (timeout ~2500 ms):

| Seed | Guard |
| --- | --- |
| 14 | Switches not adjacent; parking ends capped |
| 15 | No long diagonal dead-end from a diverge |
| 17 | At least one rejoined passing pair; not every switch is parking; most curves used; switch gap ≥ 96 studs |
| 18 | Long passing lane (`par*` ≥ 4 pieces) and a wandered or multi-heading shape |
| 21 | Exactly one parking; crossover only if both tracks close; leftover straights+curves < 17 |
| 22 | One parking ≥ 80 studs; useful passing lane; no dangling crossover ports |

Smaller fixtures still cover the 16-curve circle, the 15-curve flex refusal, a single-switch parking siding, and S-bends on extra curves.

## Rules of thumb for the next change

- Fix from a snapshot, not from a guessed seed.
- If both a fix and an exploit-style path are possible, change scoring or placement — do not add a one-off for one seed.
- Keep `growToward` / passing / crossover joins honest: fewer open ports is not enough; the intended target port must close.
- Do not steal the long switch run to feed wobbles or parking.
- Prefer one passing loop + one parking over four parkings or two unfinished diverges.
- A random stretch is valuable only if the loop still closes and the switch sides stay long.
