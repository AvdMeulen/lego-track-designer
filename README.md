# LEGO Track Designer

Angular application for planning **LEGO City** train layouts from the track pieces you already own.

You record your collection. The app then suggests a visual track design that can be built with those parts.

This repository currently contains the Angular 20 boilerplate, project documentation, and a local Git history. Feature work is planned in [docs/ROADMAP.md](docs/ROADMAP.md).

## Status

Boilerplate and documentation are in place. Inventory, layout generation, and the track canvas are not implemented yet.

## Stack

- Angular 20 (standalone components, signals, SCSS)
- TypeScript 5.9
- Angular Router
- Karma + Jasmine for unit tests

Node.js **22.20.0** is the version used to generate this project. The latest Angular CLI (v21+) needs a newer Node release, so this app stays on Angular 20 until Node is upgraded.

## Prerequisites

- Node.js 22.12 or later (22.20.0 is known to work)
- npm 11 or later
- Git

## Getting started

```bash
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200). The app reloads when source files change.

| Script | Purpose |
| --- | --- |
| `npm start` | Development server |
| `npm run build` | Production build in `dist/` |
| `npm test` | Unit tests |
| `npm run watch` | Rebuild on change |

More setup detail lives in [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

## Documentation

| File | Contents |
| --- | --- |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | Local setup and GitHub remote |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product goal and user flow |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Proposed app structure |
| [docs/DOMAIN.md](docs/DOMAIN.md) | LEGO City track model |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased build plan |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to work in this repo |

## Bind this folder to GitHub

The project is a local Git repository on branch `main`. It does not have a GitHub remote yet.

### Option A: GitHub CLI

```bash
gh auth login
gh repo create lego-track-designer --private --source=. --remote=origin --push
```

Use `--public` instead of `--private` if you want an open repository.

### Option B: GitHub website

1. Create an empty repository on GitHub. Do not add a README, `.gitignore`, or license.
2. Connect and push:

```bash
git remote add origin https://github.com/<your-username>/lego-track-designer.git
git push -u origin main
```

Replace `<your-username>` with your GitHub username.

## License

Personal project. LEGO is a trademark of the LEGO Group, which does not sponsor or endorse this software.
