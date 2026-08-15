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

- `/` home
- `/inventory` collection and presets
- `/designer` generate, inspect numbered parts, export PNG or JSON, import a snapshot

Inventory and the last layout are stored in this browser. Export PNG for a printable plan. Export or copy JSON (`lego-track-designer.snapshot`) to share a seed, inventory, preferences, and the exact layout — useful when iterating on the generator. Import the same file (or paste) to restore it.

## GitHub

- Repository: https://github.com/AvdMeulen/lego-track-designer
- Live site: https://avdmeulen.github.io/lego-track-designer/

Pushes to `main` run CI and publish the production build to GitHub Pages. The Pages workflow sets `--base-href /lego-track-designer/` and copies `index.html` to `404.html` so Angular routes reload correctly.
