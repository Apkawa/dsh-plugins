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

Shared infra: a single plumbing core in `tests-helpers/e2e/dsh.ts` (`launchDsh` / `stopDsh`, `resolveDshBinary`, `ensureDshVersion`), thin per-lane wrappers — `tests-helpers/e2e/dsh-fixture.ts` (vitest) and `tests-helpers/e2e/live.ts` (playwright) — and the manual CLI `scripts/e2e-live.ts`. Test files and configs stay per-package in `packages/<name>/tests/e2e/`, importing the shared helpers via the `@root/tests-helpers/…` alias. Everything runs on a throwaway `DSH_HOME` under `.tmp/dsh-e2e-*` on port 0 (the real port comes from the ready URL) — never the real `~/.dsh`.

Lanes:

- **vitest e2e lane** — `tests/e2e/server/*.test.ts`, no browser: drives the live instance over its HTTP API via the vitest wrapper (`tests-helpers/e2e/dsh-fixture.ts`). Provider API keys are inherited from the caller. The boot smoke suite (`tests/e2e/server/boot.test.ts`) runs the version matrix via `describe.each(E2E_DSH_VERSIONS)` — `0.1.1-rc.2` and `0.1.2-rc.1`.
- **playwright acceptance lane** — `tests/e2e/acceptance.spec.ts` + `playwright.config.ts` (model-settings today), real chromium: the instance is keyless by design (provider API keys are stripped), and browsers come from the shared `~/.cache/ms-playwright` cache — never run `playwright install`.
- **manual CLI** — `scripts/e2e-live.ts`, a thin wrapper over the core: flags `--package <name>` (required — a dir under `packages/`), `--port <n>` (default 3081), `--keep` (preserve the temp root for debugging; `E2E_KEEP=1` does the same for the playwright lane), `--version <v>` (default `0.1.1-rc.2`; `--version 0.1.2-rc.1` prints a real session cookie instead of `none`). SIGINT/SIGTERM stop the instance and remove the temp root unless `--keep`.

Run from the package dir:

```
pnpm test:e2e     # vitest e2e lane; model-settings then runs the playwright lane (vitest && playwright test)
pnpm e2e:live     # manual throwaway instance: node ../../scripts/e2e-live.ts --package <name>
```

The dsh binary is resolved identically in every lane: env `E2E_DSH_BIN` (must exist — the run hard-fails with `E2E_DSH_BIN does not exist: …` otherwise, no PATH fallback) → `ensureDshVersion(version)`, which auto-provisions the selected version on first launch: a throwaway pnpm project under `.tmp/dsh-versions/<version>` (~20–60 s; `CI=1`, `pnpm_config_store_dir=<repo>/.cache/pnpm/v11`, ~180 s timeout, serialized on a per-version lock); subsequent launches are instant. Those throwaway projects are exempt from the frozen-lockfile rule — the repo itself still installs frozen. dsh 0.1.1-rc.2 prints a tokenless ready URL (`session cookie: none`); dsh ≥ 0.1.2 prints a `?token=…` ready URL which the lanes exchange for a session cookie that suffices for in-session requests.

Playwright artifacts land under `.tmp/playwright/<package>`, caches under `.cache/`.

Known issue: on dsh 0.1.2-rc.1, in-session `POST /model-settings/*` returns 405 (host plugin apply-ordering — tracked in dumbspec task `fix_0.1.2-rc1`); it also 401s cookie-less plain-URL navigation. The boot smoke suites cover the full matrix; the model-settings RPC suite and the playwright acceptance lane are pinned to `0.1.1-rc.2` until the fix lands. 0.1.1-rc.2 is the validated e2e baseline.

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
