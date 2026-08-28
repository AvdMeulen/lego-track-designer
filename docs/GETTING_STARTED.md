# Getting started

```bash
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200).

| Script | Purpose |
| --- | --- |
| `npm start` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests (watch) |
| `npm run test:ci` | Headless Chrome, single run |
| `npm run build:pages` | Production build with the GitHub Pages base href |

## Pages

- `/` home — work order: room, collection, generator
- `/room` floor plan editor
- `/inventory` collection
- `/designer` generate, inspect numbered parts, export PNG or JSON, import a snapshot
- `/designer?generate=1&seed=90&parking=2&scene=eval` agent search with the eval room and collection (see [AGENT.md](AGENT.md))

To have a coding agent run the designer itself, point it at [AGENT.md](AGENT.md) (repo-root [AGENTS.md](../AGENTS.md) links there too).

Inventory, the last layout, and the floor plan are stored in this browser. Export PNG for a printable plan. Export or copy JSON (`lego-track-designer.snapshot`) to share a seed, inventory, preferences, optional floor plan, and the exact layout. Import the same file to restore it.

## GitHub

- Repository: https://github.com/AvdMeulen/lego-track-designer
- Live site: https://avdmeulen.github.io/lego-track-designer/

Pushes to `main` run CI and publish the production build to GitHub Pages. The Pages workflow sets `--base-href /lego-track-designer/` and copies `index.html` to `404.html` so Angular routes reload correctly.
