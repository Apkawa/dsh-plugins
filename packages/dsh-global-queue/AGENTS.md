# dsh-global-queue

Cordis plugin for a global queue of dsh prompts: prompts are queued globally
and the next prompt runs as soon as the model is free (host + client
halves). Configuration and install: [README.md](./README.md).

Repo-wide rules (style, commits, TDD, sandbox): [../../AGENTS.md](../../AGENTS.md).

## Build

One command: `pnpm build` = `tsc -p tsconfig.json` → host into `lib/`, then
`tsdown` → client bundle (`lib/client/index.js`). Host changes need a full
`dsh web` restart; client-only changes need a page reload. `pnpm typecheck`
runs both tsconfigs (`tsconfig.json` with `--noEmit` and
`tsconfig.client.json`); `pnpm test` (unit) and `pnpm test:e2e` (e2e) are
separate runs.

## Project structure

**Host half** (`src/*.ts`; pure logic + composition root, unit-tested):

* `index.ts` — composition root: plugin `name` (`global-queue`), the `Config`
  schema (`path`, default `$DSH_HOME/.global-queue.json`), and `apply`
  composing the `QueueStore`, the watcher (over the `agents` / `sessions` /
  `sessionPersistence` / `sessionProjections` seams, `agent/status` and
  `session/event` events), and the `/global-queue` RPC channel — mounted on
  the host `webServer` via a nested `ctx.inject` (the 0.2.0-rc.2
  host-RPC workaround).
* `queue/` — `types.ts` (`QueueItem`, the `queued`/`running`/`done`/`interrupted`
  statuses), `store.ts` (file-backed store: atomic writes + cross-process
  lock), `watcher.ts` (global idle detection, item execution — create /
  resume / followup — completion and interruption, token-delta stats).
* `rpc.ts` — the `/global-queue` prefix route on the host web server:
  `list` / `add` / `reorder` / `editText` / `remove` over the dsh carrier
  wire shape (every failure is an `ok: false` result).

**Client half** (`src/client/*`; React, no jsdom — pure logic lives in the
`.ts` file that is unit-tested):

* `index.ts` — the RPC client over the `/global-queue` channel plus the
  shared snapshot store (`getItems` / `subscribe` / `refresh`), and the
  registration of the "Show queue" tab type (`ctx.sidebarRightTabs`), its
  body under the keyed `sidebar.right.pane.tab` seat, and the "Add to
  queue" control under the `conversation.input.right` seat; built by
  `tsdown` (see `tsdown.config.ts`) into `lib/client/index.js` and
  typechecked by `tsconfig.client.json`.
* `QueuePane.tsx` — the tab body: one row per item in file order with
  drag-and-drop reorder, inline text edit, remove, the status label, the
  compact stats line, and the "open session" link (the workspace's display
  name with the folder icon, via `uiWorkspace`).
* `AddToQueue.tsx` — the composer control with the current-session /
  new-session target choice.
* `format.ts` — the compact per-item stats line (`1h 35m, 30.5M`) and the
  workspace display name (the workspace path's last segment) for the row's
  open-session link.

**Tests**: `tests/unit/server/{store,watcher}.test.ts` — the host-side
queue modules (vitest node env, in-process doubles, no network);
`tests/unit/client/format.test.ts` — the client stats formatting (same
env, no jsdom). `pnpm test`.

**E2E**: `tests/e2e/server/{boot,rpc}.test.ts` — live e2e against an
independent `dsh web` with the plugin linked, via the vitest wrapper
`tests-helpers/e2e/dsh-fixture.ts` over the shared launch core
`tests-helpers/e2e/dsh.ts` (manual CLI `scripts/e2e-live.ts` at the repo
root); the boot smoke and the RPC lane run the version matrix via
`describe.each(E2E_DSH_VERSIONS)`; 120 s test timeouts
(`vitest.e2e.config.ts`); no browser, no internet.
`tests/e2e/acceptance.spec.ts` + `playwright.config.ts` — the playwright
lane (via `tests-helpers/e2e/live.ts`) for the "Show queue" tab and the
"Add to queue" control, iterating the same `E2E_DSH_VERSIONS`, with
artifacts under `.tmp/playwright/global-queue`. `pnpm test:e2e` runs the
vitest lane; the playwright lane runs separately; `pnpm e2e:live` boots a
throwaway instance manually. Test files import the helpers via the
`@root/tests-helpers/…` alias.

## Hard constraints

- frozen pnpm installs only — no `pnpm add`, no `--no-frozen-lockfile`
- isolated test `DSH_HOME` only — never the real `~/.dsh`
- temp state in `.tmp/` (e2e homes, provisioned versions, artifacts)
- `pnpm typecheck` from the package dir, never bare `tsc`
