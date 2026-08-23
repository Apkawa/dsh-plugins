# dsh-plugins — plugins for @deepseek-harness/dsh

## Agent Instructions

- Ignore all rules and workflows specified in CONTRIBUTING.md.


## Paths

* `dsh/` - symlink to deepseek-harness. use readonly for research
* `docs/ai/` - reference notes for AI sessions (key moments, links into dsh source)
* `examples/tmp/dsh-docs` - reference for deepseek-harness docs (another symlink dsh/docs/)

## Project structure

All current work lives in `packages/dsh-model-settings/` — a Cordis plugin with two halves, built by one command (`pnpm build` = `tsc -p tsconfig.json` → host into `lib/`, then `tsdown` → client bundle). Host changes need a full dsh web restart; client-only changes need a page reload.

**Host half** (`src/*.ts`; pure logic + composition root, unit-tested):

* `index.ts` — composition root: registers the `model-settings` section, the `settings/updated` watcher → autofill, and the `/model-settings` RPC channel (`makeRpcHandler`; every error goes through `rpcFailure`, which must stay carrier-conformant).
* `probe.ts` / `props.ts` / `round.ts` — fetch `<baseURL>/v1/models`, parse INI presets (`ctx-size`, else `fit-ctx`), round down to the thousand.
* `settings-io.ts` — `SettingsStore` seam over dsh settings + persist ops.
* `autofill.ts` — batch autofill with self-cycle guard.
* `efforts.ts` — `THINKING_LEVELS`, `validateEfforts`, `planReasoningWrite` (empty efforts = clear → writes dsh's canonical `false`).
* `model-save.ts` — one Save commits efforts + ctx together (`contextWindow: null` drops the stored key).
* `log.ts` — `dbg` wrapper.

**Client half** (`src/client/*`; React, no jsdom — pure logic lives in `.ts` files that are unit-tested):

* `index.ts` — registers the reasoning section (`settings.section`, label "Model settings"); EffortButton + v1 card kept verbatim behind `CLIENT_ENABLED = false`.
* `ReasoningSection.tsx` — per-model accordion: seven thinking levels, context-window field + Refresh, one Save.
* `reasoning-controller.ts` — RPC client over `/model-settings` + snapshot store.
* `context-format.ts` / `efforts-editor.ts` — K/M parse/format; draft state (`draftsDirty`).

**Tests**: `tests/unit/{server|client}/<module>.test.ts` — host-side modules under `server/`, client-side (`src/client`) under `client/` (vitest node env, FakeStore/FakeConnection doubles, no jsdom); client logic files are tested the same way.

**E2E**: `tests/e2e/*.test.ts` — drives a live independent `dsh web` (via `scripts/e2e-live.mjs`) over the `/model-settings` RPC; no browser, no internet. Separate config + script (`pnpm test:e2e`), kept out of the unit run.

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
