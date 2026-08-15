# Getting started

## Install

From the repository root:

```bash
npm install
```

## Run the app

```bash
npm start
```

The development server listens on [http://localhost:4200](http://localhost:4200).

## Build

```bash
npm run build
```

Output is written to `dist/lego-track-designer/browser`.

## Test

```bash
npm test
```

Karma opens Chrome by default. Use `ng test --watch=false --browsers=ChromeHeadless` for a single CI-style run.

## Project layout

```text
src/app/
  app.ts                 Application shell
  app.routes.ts          Route table
  features/home/         Landing page
  core/                  Planned: services and configuration
  shared/                Planned: models and reusable UI
docs/                    Product and engineering documentation
```

## Connect GitHub

The local repository is already initialized. Create an empty GitHub repository, then:

```bash
git remote add origin https://github.com/<your-username>/lego-track-designer.git
git push -u origin main
```

Or with the GitHub CLI:

```bash
gh repo create lego-track-designer --private --source=. --remote=origin --push
```

## Node version note

This app was generated with Angular CLI 20 because Node.js 22.20.0 does not meet the Angular 21+ minimum (`v22.22.3`). After upgrading Node, Angular can be updated in a later phase.
