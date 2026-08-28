# Agent notes

This repository is an Angular LEGO City track planner. Product rules: [docs/PRODUCT.md](docs/PRODUCT.md), [docs/GENERATOR.md](docs/GENERATOR.md). SemVer before push: `.cursor/rules/semver.mdc`.

## Generate and evaluate on the website

When you need to run or judge a layout in the browser, **follow [docs/AGENT.md](docs/AGENT.md)**. Do not use whatever room or collection happens to be in `localStorage`.

Default:

```text
http://localhost:4200/designer?generate=1&seed=90&parking=2&scene=eval
```

```js
await legoTrackAgent.generate({ scene: 'eval', seed: 90, parking: 2 })
```

Wait for `html[data-lego-track="ready"]`, then read `[data-testid="run-stats"]` and `legoTrackAgent.report()`. Judge the core loop first.

## Many seeds (offline bench)

Do not click Generate in a loop. Same engine, no Angular:

```bash
npm run bench:generator
```

Args: `[runs=100] [parking=2] [startSeed=1]`. Writes `scripts/bench-generator-results.json` (gitignored). Command and metrics: [docs/GENERATOR.md](docs/GENERATOR.md) § Quality bench. Judge closed loop first.
