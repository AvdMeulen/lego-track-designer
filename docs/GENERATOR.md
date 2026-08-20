# Layout generator

How `generateLayout` builds a City network from inventory.

The engine lives in `src/app/core/layout-engine/` (`generate.ts` orchestrates `topology.ts`, `tree.ts`, `wander.ts`, `features.ts`, `score.ts`). Analysis (parking, reverse, cycles) stays in `layout-analysis/`. Share a failed or interesting result as a JSON snapshot from the designer.

## Solution direction

Build a **growing network**, not a template oval with decorations.

The next rigid piece is rolled from remaining stock (more leftover curves means a curve is more likely). Curves are laid in **pairs**. A switch sprouts a new random branch from the diverge. As stock runs down, open heads steer toward each other: branches rejoin, the trunk closes, or a leftover diverge becomes a reversing loop. Parking is a short siding last.

A switch or crossover must add a **useful second route**: mixed straights and curves, eight or more extra pieces, often wandering outward or around the existing core. It is not a City two-curve passing bubble, and not a stadium of two curves plus a run of cardinal straights after every special.

When a long wander close will not fit in time or space, fall back: a stretched passing siding, then a compact two-curve loop, so specials are still used. Scoring then prefers the candidate that looks least like a box, diamond, or stadium.

## What a good layout looks like

Typical test collection: 58× `straight-16`, 97× `curve-22`, 2 left + 2 right switches, 1 double crossover.

Parking is **off by default**. The selector only offers `0 … min(2, switchCount)`. Rare pieces (switches, crossover, 90° crossing) are always placed. The only allowed open ports are requested parking ends.

Expect:

- An **organic closed circuit**. Prefer a stock-weighted tree (`t` / `br`) or a wander-home loop (`w`). If those cannot close, a wavy eight-corner ring (`p`) is the fallback — not a four-sided diamond.
- **Sub-circuits** from switch diverges (`rte`) and crossover exits (`xo`), including into the interior. On a large fallback ring, leftover diverges join with `wanderJoin` (at least eight extra mixed pieces). A short City passing loop is only used if that detour will not fit.
- **Both exits of every non-parking switch on a circuit.** One leftover switch with parking off becomes a reversing loop (`kel`). With parking on, an odd leftover switch stays unused so only parking ends remain open.
- **Parking** only when the user asks: one switch on the circuit and a mostly-straight siding (`sid`).
- **Most of the inventory used.** Leftovers are pieces that physically would overlap.

## Pipeline

Default search budget is 4 seconds. The designer pauses the deadline while a phase is on screen.

1. **TopologyPlan** from counts: parking, dual-route pairs, keerlus, crossover, crossing.
2. **Core.** On a large collection the first attempt grows the stock-weighted tree (about 1.5 s). Otherwise wander-home is tried first (about 0.65–0.85 s). If it cannot close, `organicRing` builds a wavy eight-corner loop. A 16-curve circle plus inflate is the last core fallback. Specials and some curves/straights are reserved for later features when the core is not a tree.
3. **Crossover** (`applyCrossover`) first on a large core, so a triple-straight still exists. Close its extra exits with a long wander branch (`minAdded` 8) before `ovalJoin`.
4. **Switch branches** (`applyRouteFeatures`). On a large core, try stretched passing (minimum eight pieces) or insert switches and `wanderJoin` the diverges organically. Compact two-curve passing is last. Leftover diverges get the same long wander; one leftover diverge with parking off becomes a keerlus.
5. **Inflate** leftover straights and curves as detours. A first pass puts **S-bends only** on `rte` / `xo` / `par` / `cr` / `kel` pieces so a stadium bubble gets wiggles. That pass must not `ovalJoin` nested circuits: bridging two nearby diverges looks like a tiny bypass and scores badly. Later passes may inflate the whole loop.
6. **Parking** last: a short siding from a switch (about a train length). Leftover straights and curves go into loop detours, not a runway.
7. Flex closes a leftover near-miss only. Fifteen curves must not close with flex.
8. Score candidates (up to 10 or until the timeout); pick the best. `generateLayout()` stays synchronous for tests. The designer uses `generateLayoutAsync()` and shows each phase on the canvas behind the searching overlay: core, crossover, switch branches, detours, parking, next candidate, then the winner.

## What not to do

These directions looked promising and then failed (timeouts, unused specials, or `shortSwitchBypassPenalty` jumping up). Do not repeat them as the main path:

- Skip `organicRing` or ban two-curve joins globally. Specials then sit unused when wander cannot close.
- Reserve a large block of curves (for example 16 per dual route) so the core starves.
- Run the tree on every attempt, or leave the tree deadline so late that features get no time.
- Unbounded `wanderJoin`, or wander-first on every join with no time gate.
- Nested inflate with `ovalJoin` first. That bridges a diverge pair into a two-curve bypass.
- Score `simpleBubblePenalty` on any two-axis loop. That punished good wander cores (for example seed 42).

Keep compact passing and oval joins as **timed fallbacks**, not as the shape we aim for.

## Instance ids in snapshots

Prefixes tell you which stage placed a piece. Treat them as the bug report together with unused counts and open ports.

| Prefix | Stage |
| --- | --- |
| `t`, `br` | Stock-weighted tree |
| `w` | Wander-home core |
| `p` | Eight-corner organic ring |
| `xo` | Crossover circuit |
| `rte`, `par` | Switch branch / passing |
| `kel` | Reversing loop |
| `cr` | 90° crossing circuit |
| `sid` | Parking siding |
| `inf` | Later loop inflate |

A typical stadium failure looks like a `p…` eight-corner core, an `xo…` cardinal oval, and an `rte…`/`par…` two-curve or all-straights siding.

## City geometry that the generator depends on

- **Curve:** 22.5°, R40. Sixteen same-direction curves are 360°. Opposite-port pairs (`a` then `b`) are an S-bend.
- **Switch:** 32-stud through (two straights). The diverge ends at 22.5°. A compact City passing loop (opposite-hand switches a few straights apart, two completing curves) is a last resort. Prefer a longer branch from the diverge.
- **Double crossover:** 48 studs, parallel routes 16 studs apart. All four ports must sit on circuits.
- **Crossing 90°:** plus intersection; routes do not join. All four ports must sit on circuits.
- Ports connect within 0.35 studs and ~180° heading.

## Scoring

Rewarded: unused rigid pieces near zero, specials used, independent cycles (route choice), parking match, heading variety as a bonus.

Penalized: unused specials, unfinished ports on a loop, extra parking above the target, adjacent switches, flex, a **four-sided cardinal rectangle envelope**, a **two-heading diamond or parallelogram**, long straight runways, **simple outer stadium bubbles** on `rte` / `xo` / `cr` circuits (cardinal straights, no S-bend), and **tiny two-curve bypasses** (≤4 hops) between switch diverges.

## Snapshots

Designer export is `lego-track-designer.snapshot` version 1. When changing the generator, paste the snapshot JSON into chat and treat unused counts, open ports, and instance-id prefixes as the bug report.
