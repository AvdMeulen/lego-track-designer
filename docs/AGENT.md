# Agent layout evaluation

How a coding agent generates a layout on the **running website** and judges the result. Follow this file when the user asks to try a seed, compare runs, or check generator quality in the browser.

Do not assume the room and collection already in `localStorage` are the right ones. Load a scene or pass inventory and floor plan yourself.

Source of truth for the API: `src/app/core/layout-store/` (`agent-api.ts`, `agent-setup.ts`, `agent-scene.ts`, `agent-report.ts`, `agent-bridge.ts`). Product quality rules: [GENERATOR.md](GENERATOR.md).

## Default command

Eval L-room (furniture obstacle) plus the typical collection, parking 2, a known seed:

```text
http://localhost:4200/designer?generate=1&seed=90&parking=2&scene=eval
```

Live site (after the change is on `main`):

```text
https://avdmeulen.github.io/lego-track-designer/designer?generate=1&seed=90&parking=2&scene=eval
```

Same run from the page (browser console or `evaluate`):

```js
await legoTrackAgent.generate({ scene: 'eval', seed: 90, parking: 2 })
```

`npm start` must be running for the local URL. Generation takes about four seconds of search plus phase pauses.

## Wait until it is done

- `html[data-lego-track="ready"]` (while searching: `generating`)
- Busy overlay `[data-testid="generate-busy"]` gone
- `legoTrackAgent.report().status === 'ready'`

Then read the canvas **and** the machine summary. A screenshot alone is not enough.

## What to read

| Place | What it is |
| --- | --- |
| `[data-testid="run-stats"]` | Seed, score, loop, parking found/target, open connectors |
| `[data-testid="run-stats"][data-report]` | Full JSON report |
| `[data-testid="stat-seed"]` etc. | Individual fields |
| `[data-testid="generate"]` | Generate button |
| `legoTrackAgent.report()` | Same JSON as `data-report` |

Report fields:

| Field | Meaning |
| --- | --- |
| `seed` | Search seed used |
| `score` | Ranking total (higher is better; often negative) |
| `loop` / `cycles` | Closed cycle present (`routeBonus > 0`) |
| `parkingTarget` / `parkingFound` | Requested vs real switch-diverge sidings |
| `unfinishedPorts` | Open connectors (parking ends count) |
| `parts`, `flex`, `crossover`, `switches` | Pieces placed |
| `collection` | Inventory that was loaded |
| `unused` | Leftover stock |
| `room.vertices` / `room.obstacles` / `room.envelope` | Floor plan that was loaded |
| `envelope` | Bounding box of placed track (studs) |
| `notes` | Translation keys such as `note.noSpareSwitch` |
| `marks` / `reverse` | Canvas labels and reverse kinds |

Confirm setup worked: `collection['straight-16'] === 58` and `room.vertices === 6` and `room.obstacles === 1` after `scene: 'eval'`.

## Eval scene (`scene=eval`)

Defined in `agent-scene.ts`.

Collection: 58× `straight-16`, 97× `curve-22`, 2× `switch-left`, 2× `switch-right`, 1× `double-crossover`, 12× `flex-track`.

L-room outer (studs): `(-163.6, 93.8) → (227.2, 93.8) → (227.2, 264.5) → (329.8, 264.5) → (329.8, 419.9) → (-163.6, 419.9)`. Obstacle `obs-1`: `(-4.8, 197.7)–(120.2, 298.0)`.

Parking is **not** part of the scene; pass `parking` (0, 1, or 2). Product default is 0; this builder usually tests **2**.

## `window.legoTrackAgent`

Available on every page after the app boots (`AgentBridge` in `app.ts`).

```js
legoTrackAgent.version          // app SemVer
legoTrackAgent.scenes           // ['eval']
legoTrackAgent.report()         // current summary
legoTrackAgent.setup({ ... })   // write room/collection/parking, no search
await legoTrackAgent.generate({ ... })
```

`generate` options (also `setup`, except `seed`):

| Option | Type | Role |
| --- | --- | --- |
| `scene` | `'eval'` | Load the eval room and collection |
| `inventory` | `{ 'straight-16': 58, ... }` or `[{ partId, quantity }]` | Override collection (catalog ids only) |
| `floorPlan` | Full snapshot plan, or `{ outer: [[x,y],...], obstacles: [{ id?, points }] }` | Override room (studs) |
| `snapshot` | Designer JSON object or string | Take inventory, room, and parking from a snapshot; then generate a **new** layout |
| `parking` | `0 \| 1 \| 2` | Parking target |
| `seed` | integer ≥ 1 | Search seed (`generate` only). Omit to increment like the Generate button |

Apply order: snapshot → scene → explicit `inventory` / `floorPlan` → `parking`. Later keys win.

Catalog part ids: `straight-16`, `curve-22`, `switch-left`, `switch-right`, `crossing-90`, `double-crossover`, `flex-track`.

## Query parameters (`/designer`)

| Param | Effect |
| --- | --- |
| `generate=1` | Start a search on load (`true` / `yes` also work) |
| `seed=90` | Use that seed (no increment) |
| `parking=0\|1\|2` | Parking target |
| `scene=eval` | Load eval room and collection first |

Example: `/designer?generate=1&seed=91&parking=2&scene=eval`

Without `generate`, `scene` / `parking` / `seed` still write the stores so a later click uses them.

## How to judge

Read [GENERATOR.md](GENERATOR.md) for the product bar. For each run, in this order:

1. **Core loop** — a real closed circuit. `loop === true`. Open main-line dead ends must not count as parking.
2. **Parking** — only switch **diverge** sidings of plausible length. Compare `parkingFound` to `parkingTarget`.
3. **Room use** — both arms of the L when the eval room is loaded; leftover stock should not sit unused while a bay is empty.
4. **Specials** — double crossover and spare switches used when they fit; passing pair is not a keerlus.
5. **Flex** — only a small gap closer, never a 15-curve close.
6. **Leftovers** — no isolated leftover circles (`in*` instance ids). Unused rigid pieces should be leftovers that would collide.

Different seeds should be able to produce different outer envelopes, not only different labels.

## Instructing a future agent

Paste or point at this file:

```text
Follow docs/AGENT.md. Generate seed 90 with parking 2 on the eval scene, wait until ready, and judge the core loop.
```

Cursor also loads `.cursor/rules/agent-eval.mdc` and the repo-root `AGENTS.md`, both of which point here.
