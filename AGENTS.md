# dsh-plugins — plugins for @deepseek-harness/dsh

## Agent Instructions

- Ignore all rules and workflows specified in CONTRIBUTING.md.


## Paths

* `dsh/` - symlink to deepseek-harness. use readonly for research
* `docs/ai/` - reference notes for AI sessions (key moments, links into dsh source)
* `examples/tmp/dsh-docs` - reference for deepseek-harness docs (another symlink dsh/docs/)

## Projects

Each plugin is a package under `packages/<name>/` and owns its `AGENTS.md` for
project structure, build, and test details — the root file keeps only what
applies to the whole repo.

* [`packages/dsh-global-queue`](./packages/dsh-global-queue/AGENTS.md) — global queue of prompts: the next queued prompt runs as soon as the model is free (Cordis plugin, host + client halves).
* [`packages/dsh-model-settings`](./packages/dsh-model-settings/AGENTS.md) — per-model reasoning effort, context window, and vision input management for llama.cpp models (Cordis plugin, host + client halves).
* [`packages/dsh-web-search-ddgs`](./packages/dsh-web-search-ddgs/AGENTS.md) — keyless web-search provider for the `web_search` tool on ddgs (host-only Cordis plugin).
* [`packages/dsh-attach-editor`](./packages/dsh-attach-editor/AGENTS.md) — image annotation for session attachments before send: the composer attachment rail (shadows the shipped one) + the "Annotate image" right-sidebar tab; save replaces the attachment (host + client halves; the editor itself lives in [`packages/image-editor`](./packages/image-editor/AGENTS.md), a dependency-free standalone package).

## E2E

Shared e2e infra: a single plumbing core in `tests-helpers/e2e/dsh.ts` (`launchDsh` / `stopDsh`, `resolveDshBinary`, `ensureDshVersion`), thin per-lane wrappers — `tests-helpers/e2e/dsh-fixture.ts` (vitest lane) and `tests-helpers/e2e/live.ts` (playwright lane) — and the manual CLI `scripts/e2e-live.ts` (`--package` required, `--port` default 3081, `--keep`, `--version` default `0.2.0-rc.2`). Test files and configs stay per-package in `packages/<name>/tests/e2e/`; boot smoke suites run the version matrix via `describe.each(E2E_DSH_VERSIONS)` (`0.2.0-rc.2`); the RPC and acceptance lanes are version matrices too — on 0.2.0-rc.2 the host RPC channel is broken host-side (the `rpc-host` effect registers in a context without `webServer`), so model-settings mounts its own `/model-settings` prefix route on the host `webServer` (nested `ctx.inject(['webServer'], …)`); the host bug itself remains in dsh (upstream ask). The earlier 0.1.2-rc.1 apply-ordering 405 (worked around by deferring the channel row on `ctx.inject(['connection'], …)`) is archived (`.dumbspec/archive/fix_0.1.2-rc1`). Run from the package dir: `pnpm test:e2e` (vitest e2e lane; model-settings and dsh-attach-editor append the playwright acceptance lane) and `pnpm e2e:live` (manual throwaway instance). The core keeps the child's stdout+stderr in a shared buffer exposed as `handle.readOutput()`, so a boot test can assert the startup activation audit reported no inactive entry.

Hard constraints:

- frozen pnpm installs only — no `pnpm add`, no `--no-frozen-lockfile` (exception: auto-provisioned throwaway projects under `.tmp/dsh-versions/<version>`)
- never `playwright install` — the shared `~/.cache/ms-playwright` chromium build 1234 for the pinned `@playwright/test@1.62.1` is already cached
- isolated test `DSH_HOME` only — never the real `~/.dsh`
- temp state in `.tmp/` (homes under `.tmp/dsh-e2e-*`, provisioned versions under `.tmp/dsh-versions/<version>`, playwright artifacts under `.tmp/playwright/<package>`)
- test files import the shared helpers via the `@root/tests-helpers/…` alias (vitest `resolve.alias`, package tsconfig `paths`)

## Hard rules

- **Temporary files go in `./.tmp/`:** all temporary/scratch project files — screenshots, logs, ralph reports, scratch notes, intermediate artifacts — MUST be created in `./.tmp/` (repo root, git-ignored). Never scatter them across the working tree or tracked directories.


## Principles

* **TDD** — failing test first, then implementation (red → green → refactor). Every exported function has a unit test; probe logic is tested against recorded fixtures, never live network in unit tests. A behavior without a test does not count as done.
* **KISS** — minimal modules, no premature abstractions, no new dependencies beyond declared peers. If a simpler design serves the current iteration, ship it and note the trade-off instead of building for imagined futures.
* **SOLID** — one responsibility per module; orchestration depends on small injected interfaces (`Fetcher`, `SettingsStore`), not concrete dsh seams or `fetch`; new capabilities (T2–T5) are added as new consumers/modules, not by rewriting the core.


## Commits

* **Conventional Commits**: `type(scope): summary` (`feat`, `fix`, `docs`, …; scope optional) — match the existing history (`git log --oneline`).
* **When to commit**: multi-stage work → a commit at the end of each stage (checkpoint). Small work → commit right after completion; follow-up tweaks from later remarks go into a SEPARATE commit, only after confirming all issues are resolved. No `--amend` — fixes get their own commit.
* **Branches**: owned by the user — do not create, switch, or delete branches autonomously.
* **No pushing**: never run `git push` (any form); commits stay local until the user pushes them himself.


## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- Avoid unnecessary emoji usage

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.


### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.


## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests

## Type Checking

- Always run `pnpm typecheck` from package directories (e.g., `packages/dsh-model-settings`), never `tsc` directly.

## pnpm in the Sandbox

- Caches are kept inside the project directory, not globally 
- for pnpm the env var `pnpm_config_store_dir=./.cache/pnpm/v11` is set.

`pnpm_config_store_dir=./.cache/.pnpm/v11 pnpm install`
