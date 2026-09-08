# dsh-model-settings

Cordis plugin for per-model reasoning effort, context window, and vision input
management (llama.cpp models). Feature docs, install, and debugging notes:
[README.md](./README.md).

Repo-wide rules (style, commits, TDD, sandbox): [../../AGENTS.md](../../AGENTS.md).

## Build

One command: `pnpm build` = `tsc -p tsconfig.json` → host into `lib/`, then
`tsdown` → client bundle. Host changes need a full `dsh web` restart;
client-only changes need a page reload. `pnpm typecheck` runs both tsconfigs;
`pnpm test` (unit) and `pnpm test:e2e` (e2e) are separate runs.

## Project structure

**Host half** (`src/*.ts`; pure logic + composition root, unit-tested):

* `index.ts` — composition root: registers the `model-settings` section, the `settings/updated` watcher → autofill, and the `/model-settings` RPC channel (`makeRpcHandler`; every error goes through `rpcFailure`, which must stay carrier-conformant).
* `probe.ts` / `props.ts` / `round.ts` — fetch `<baseURL>/v1/models`, parse INI presets (`ctx-size`, else `fit-ctx`), round down to the thousand.
* `settings-io.ts` — `SettingsStore` seam over dsh settings + persist ops.
* `autofill.ts` — batch autofill with self-cycle guard.
* `efforts.ts` — `THINKING_LEVELS`, `validateEfforts`, `planReasoningWrite` (empty efforts = clear → writes dsh's canonical `false`).
* `model-save.ts` — one Save commits efforts + ctx together (`contextWindow: null` drops the stored key).
* `log.ts` — `dbg` wrapper.

**Client half** (`src/client/*`; React, no jsdom — pure logic lives in `.ts` files that are unit-tested):

* `index.ts` — registers the v2 reasoning section (`settings.section`, label "Model settings") and the v2 composer EffortButton (both always on); the v1 fetch-apply card stays kept verbatim behind `CLIENT_ENABLED = false`.
* `ReasoningSection.tsx` / `reasoning-controller.ts` — per-model accordion (seven thinking levels, context-window field + Refresh, Vision checkbox, one Save) and its RPC client over `/model-settings` + snapshot store.
* `context-format.ts` / `efforts-editor.ts` / `vision-input.ts` — K/M parse/format; draft state (`draftsDirty`); canonical vision `input` spellings.
* `EffortButton.tsx` / `effort-button.ts` — composer button in `conversation.input.right` and its pure logic (structural mirrors of the session's shared model directory).
* `card.tsx` / `controller.ts` — the (disabled) v1 route card and its controller.
* `slot-contract.ts` — type-only `settings.plugin.item` slot mirror, erased at bundle time.

**Tests**: `tests/unit/{server|client}/<module>.test.ts` — host-side modules under `server/`, client-side (`src/client`) under `client/` (vitest node env, FakeStore/FakeConnection doubles, no jsdom); client logic files are tested the same way.

**E2E**: `tests/e2e/server/*.test.ts` — drives a live independent `dsh web` over the `/model-settings` RPC via the vitest wrapper `tests-helpers/e2e/dsh-fixture.ts` over the shared launch core `tests-helpers/e2e/dsh.ts` (manual CLI `scripts/e2e-live.ts` at the repo root); no browser, no internet. `tests/e2e/server/boot.test.ts` runs the version matrix via `describe.each(E2E_DSH_VERSIONS)`; the RPC suite and `tests/e2e/acceptance.spec.ts` (playwright lane, via `tests-helpers/e2e/live.ts`) are pinned to `0.1.1-rc.2` until the 0.1.2-rc.1 405 is fixed (`.dumbspec/current/fix_0.1.2-rc1`). Separate config + script (`pnpm test:e2e`), kept out of the unit run; `pnpm e2e:live` boots a throwaway instance manually (`--version` selects the dsh). Test files import the helpers via the `@root/tests-helpers/…` alias; versions auto-provision into throwaway projects under `.tmp/dsh-versions/<version>` on first launch. Running details: `CONTRIBUTING.md` → `E2E tests`.
