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

## E2E tests

Shared infra lives in `scripts/e2e-live.mjs` + `tests-helpers/e2e/`; test files and configs stay per-package in `packages/<name>/tests/e2e/`. Everything runs on a throwaway `DSH_HOME` under `.tmp/dsh-e2e-*` — never the real `~/.dsh`.

Two lanes:

- **vitest e2e lane** — `tests/e2e/server/*.test.ts`, no browser: drives the live instance over its HTTP API via the shared fixture (`tests-helpers/e2e/dsh-fixture.ts`, default port 3091). Provider API keys are inherited from the caller.
- **playwright acceptance lane** — `tests/e2e/acceptance.spec.ts` + `playwright.config.ts` (model-settings today), real chromium: the instance is keyless by design (provider API keys are stripped), and browsers come from the shared `~/.cache/ms-playwright` cache — never run `playwright install`.

Run from the package dir:

```
pnpm test:e2e     # vitest e2e lane; model-settings then runs the playwright lane (vitest && playwright test)
pnpm e2e:live     # manual throwaway instance: node ../../scripts/e2e-live.mjs --package <name>
```

`e2e:live` flags: `--package <name>` (required — a dir under `packages/`), `--port <n>` (default 3081), `--keep` (preserve the temp root for debugging; `E2E_KEEP=1` does the same for the playwright lane). SIGINT/SIGTERM stop the instance and remove the temp root unless `--keep`.

The dsh binary is resolved identically in both lanes: env `E2E_DSH_BIN` (must exist — the run hard-fails with `E2E_DSH_BIN does not exist: …` otherwise) → the provisioned baseline `.tmp/dsh-versions/0.1.1-rc.2/node_modules/.bin/dsh` → `dsh` on PATH. Fresh-clone provisioning of the baseline: create `.tmp/dsh-versions/0.1.1-rc.2/` with a private `package.json` depending on `@deepseek-ai/dsh: 0.1.1-rc.2` (plus a `pnpm.onlyBuiltDependencies` list — see `.tmp/dsh-versions/0.1.1-rc.2/package.json` in this repo) and run `pnpm install` in that directory; without the baseline the chain falls back to `dsh` on PATH. dsh 0.1.1-rc.2 prints a tokenless ready URL (`session cookie: none`); dsh ≥ 0.1.2 prints a `?token=…` ready URL which the lanes exchange for a session cookie that suffices for in-session requests.

The standalone launcher needs `pnpm_config_store_dir` set to `<repo>/.cache/pnpm/v11` (its internal `dsh plugin add` invokes pnpm). Playwright artifacts land under `.tmp/playwright/<package>`, caches under `.cache/`.

Known issue: on dsh 0.1.2-rc.1, in-session `POST /model-settings/*` returns 405 (host plugin apply-ordering bug — tracked in dumbspec task `fix_0.1.2-rc1`); 0.1.1-rc.2 is the validated e2e baseline.

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
