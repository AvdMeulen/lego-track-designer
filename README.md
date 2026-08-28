# LEGO Track Designer

Live site: https://avdmeulen.github.io/lego-track-designer/

Visualization-first Angular app for planning **LEGO City** train layouts from the pieces you own.

Record your collection, generate a network (loops, passing lanes, parking sidings, reversing routes), see **which part sits where**, keep the design after refresh, and export a labeled PNG or a JSON snapshot.

Flexible tracks are used only to close a small remaining gap.

## Stack

Angular 20, standalone components, signals, SCSS. No backend.

## Run

```bash
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200).

A coding agent can generate and score a layout on the running site. Instruct it with [docs/AGENT.md](docs/AGENT.md) (also [AGENTS.md](AGENTS.md)). Short form: `/designer?generate=1&seed=90&parking=2&scene=eval` or `await legoTrackAgent.generate({ scene: 'eval', seed: 90, parking: 2 })`.

```bash
npm run test:ci
npm run build
```

## Docs

| File | Contents |
| --- | --- |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | Setup |
| [docs/AGENT.md](docs/AGENT.md) | Instruct an agent to generate and judge layouts on the site |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product goal |
| [docs/DOMAIN.md](docs/DOMAIN.md) | Track model |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Code shape |
| [docs/GENERATOR.md](docs/GENERATOR.md) | How layouts are built, eval-scene quality bench, snapshot lessons |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Slices |

## Catalog

Straight 16, curve 22.5°, left/right switch, 90° crossing, 7996 double crossover, buffer stop, flexible track.

## License

Personal project. LEGO is a trademark of the LEGO Group, which does not sponsor or endorse this software.
