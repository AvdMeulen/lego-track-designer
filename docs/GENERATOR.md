# Layout generator

How `generateLayout` builds a City network from inventory.

The engine lives in `src/app/core/layout-engine/` (`generate.ts` orchestrates `topology.ts`, `wander.ts`, `features.ts`, `score.ts`). Analysis (parking, reverse, cycles) stays in `layout-analysis/`. Share a failed or interesting result as a JSON snapshot from the designer.

## What a good layout looks like

Typical test collection: 58× `straight-16`, 97× `curve-22`, 2 left + 2 right switches, 1 double crossover.

Parking is **off by default**. The selector only offers `0 … min(2, switchCount)`. Rare pieces (switches, crossover, 90° crossing) are always placed. The only allowed open ports are requested parking ends.

Expect:

- An **organic closed circuit** built like a growing tree: the next piece is rolled from remaining stock (more leftover curves means a curve is more likely). Curves are laid in pairs. A switch sprouts a new random branch from the diverge. As stock runs down, heads steer toward each other so branches rejoin, the trunk closes, or a leftover diverge becomes a reversing loop.
- **Sub-circuits** (passing loops, crossover bubbles) wander the same way, including **into the interior** of the main loop. They are not simple ovals glued to the outside.
- **Both exits of every non-parking switch on a circuit.** Two switches become two different round trips. One leftover switch with parking off becomes a reversing loop (keerlus). With parking on, an odd leftover switch stays unused so only parking ends remain open.
- **Parking** only when the user asks: one switch on the circuit and a mostly-straight siding.
- **Most of the inventory used.** Leftovers are pieces that physically would overlap.

## Pipeline

1. **TopologyPlan** from counts: parking, dual-route pairs, keerlus, crossover, crossing.
2. **Stock-weighted tree** that grows every open head from remaining pieces (curves in pairs). Switches sprout extra heads. As stock runs down, heads steer toward each other, then join: branches rejoin, the trunk closes, or a leftover diverge becomes a reversing loop. A ring or older wander is the fallback if the tree cannot close.
3. **Features:** insert switches / crossover / crossing into that path. Grow a circuit from every new exit until it rejoins — a wandering mix of curves and straights, inward when there is room. Do not replace a large closed path with two tiny ovals. Dual-route switches sit on the same straight run so the second circuit can nest inside or wander beside the first.
4. **Inflate** leftover straights and curves as detours on a closed loop, keeping a few straights if parking is on.
5. **Parking** last: a short siding from a switch (about a train length). Leftover straights and curves go into loop detours, not a runway.
6. Flex closes a leftover near-miss only. Fifteen curves must not close with flex.
7. Score candidates within the timeout; pick the best.

## City geometry that the generator depends on

- **Curve:** 22.5°, R40. Sixteen same-direction curves are 360°. Opposite-port pairs (`a` then `b`) are an S-bend.
- **Switch:** 32-stud through (two straights). The diverge ends at 22.5°. A passing loop is six consecutive straights: opposite-hand switches with two straights between them, then one completing curve on each diverge.
- **Double crossover:** 48 studs, parallel routes 16 studs apart. All four ports must sit on circuits.
- **Crossing 90°:** plus intersection; routes do not join. All four ports must sit on circuits.
- Ports connect within 0.35 studs and ~180° heading.

## Scoring

Rewarded: unused rigid pieces near zero, specials used, independent cycles (route choice), parking match, heading variety as a bonus.

Penalized: unused specials, unfinished ports on a loop, extra parking above the target, adjacent switches, flex, a **four-sided cardinal rectangle envelope**, long cardinal straight runways, and simple outer stadium bubbles on feature circuits.

## Snapshots

Designer export is `lego-track-designer.snapshot` version 1. When changing the generator, paste the snapshot JSON into chat and treat unused counts and open ports as the bug report.
