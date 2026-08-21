# Contributing

Thanks for contributing. This repo holds dsh plugins under `packages/<name>/`.


## Setup

```
pnpm install        # workspace root, Node >= 24
```

Each plugin is a standalone package; its own scripts run from the root:

```
pnpm test           # vitest (unit tests only — no live network)
pnpm typecheck      # tsc over src + client configs
pnpm build          # tsc + tsdown → lib/
```

## Working style

- **TDD**: failing test first, then implementation. Every exported function has a unit test; probe logic is tested against recorded fixtures, never live endpoints. A behavior without a test does not count as done.
- **KISS / SOLID**: minimal modules, no new dependencies beyond declared peers, orchestration depends on small injected interfaces (`Fetcher`, `SettingsStore`).

## git

### Commits

- Conventional Commits: `type(scope): summary` (`feat`, `fix`, `docs`, …). Match existing history (`git log --oneline`).
- Multi-stage work → a commit at the end of each stage. Small work → commit right after completion. No `--amend`; fixes get their own commit.

### Merge feature

Cheatsheet

```bash
git checkout master
git merge --squash feat/task-tag
git commit -m "feat(scope): everything from plan.md in one clean commit"
```
