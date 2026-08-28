# Contributing

This is a personal project. These notes keep the repository consistent while features are added.

## Branching

Work on a feature branch from `main`:

```bash
git checkout -b feature/inventory-catalog
```

Keep commits focused. Prefer messages that explain why a change exists.

## Angular conventions

- Use standalone components.
- Prefer signals for component state.
- Put feature code under `src/app/features/<feature>/`.
- Put shared UI and models under `src/app/shared/`.
- Put singleton services and configuration under `src/app/core/`.
- Generate files with the Angular CLI when possible:

```bash
npx ng generate component features/inventory --style=scss
npx ng generate service core/inventory/inventory
```

## Checks before you push

```bash
npm test
npm run build
```

## Documentation

If a change alters product behavior, folder structure, or setup steps, update the matching file in `docs/`. Generator behavior, snapshot-driven rules, and the eval-scene quality bench belong in [docs/GENERATOR.md](docs/GENERATOR.md). Browser-agent generate/judge instructions belong in [docs/AGENT.md](docs/AGENT.md) (linked from [AGENTS.md](AGENTS.md) and `.cursor/rules/agent-eval.mdc`). Re-run `npm run bench:generator` (or a shorter `-- 20`) when a generator change should move closed-loop or leftover rates.
