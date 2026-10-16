# dsh-ghl

Cordis plugin for a read-only GitHub-issue integration (host + client
halves): the Host serves the issue data over the `/ghl` RPC channel, and
the Client shows the repo's issues in a right-sidebar tab (list → detail).

Repo-wide rules (style, commits, TDD, sandbox): [../../AGENTS.md](../../AGENTS.md).

## Build

One command: `pnpm build` = `tsc -p tsconfig.json` → host into `lib/`, then
`tsdown` → client bundle (`lib/client.js`). Host changes need a full
`dsh web` restart; client-only changes need a page reload. `pnpm typecheck`
runs both tsconfigs (`tsconfig.json` with `--noEmit` and
`tsconfig.client.json`); `pnpm test` (unit) and `pnpm test:e2e` (e2e) are
separate runs.

## Project structure

**Host half** (`src/*.ts`; pure logic + composition root, unit-tested):

* `index.ts` — composition root: plugin `name` (`ghl`), the `inject` list
  (empty), the `Config` schema (empty), and `apply` composing the GitHub
  issue provider over a TTL/budget cache and the `/ghl` RPC channel —
  mounted on the host `webServer` via a nested `ctx.inject` (the 0.2.0-rc.2
  host-RPC workaround).
* `issues.ts` — the provider-agnostic `BaseIssue` contract (`Issue`,
  `RepoRef`) and the `GitHubIssue` implementation over the public REST API
  (no token) and an injected `Fetcher` boundary.
* `repo.ts` — the git-remote repo detection (`detectRepo`, `gitRemoteUrl`).
* `cache.ts` — the TTL/budget cache over the issue provider (rate-limit
  budget window).
* `rpc.ts` — the `/ghl` prefix route on the host web server:
  `detectRepo` / `listIssues` / `getIssue` over the dsh carrier wire shape
  (every failure is an `ok: false` result).

**Client half** (`src/client/*`; React, no jsdom — pure logic lives in the
`.ts` files that are unit-tested):

* `index.ts` — the RPC client over the `/ghl` channel plus the shared issue
  snapshot store (`getRepo` / `getIssues` / `getSelected` / `subscribe` /
  `refresh` / `select` / `back`, over a settable RPC seam the unit tests
  point at a fake), and the registration of the "Issues" tab type
  (`ctx.sidebarRightTabs`) and its body under the keyed
  `sidebar.right.pane.tab` seat; built by `tsdown` (see `tsdown.config.ts`)
  into `lib/client.js` and typechecked by `tsconfig.client.json`.
* `IssuePane.tsx` — the tab body: one row per issue (`#number`, title,
  status token, label chips) with row click opening the detail view
  (title, `#number`, body, the github.com link, the back control), plus the
  empty and missing-repo states.
* `format.ts` — the issue's state token (`open`/`closed`) and the `#N`
  reference.
* `css-modules.d.ts` — the `*.module.css` declaration for the client build.

**Tests**: `tests/unit/server/{repo,github-issue,cache,rpc}.test.ts` — the
host-side modules (vitest node env, in-process doubles, no network);
`tests/unit/client/{format,issue-store}.test.ts` — the client formatting and
the issue snapshot store over a fake RPC (same env, no jsdom). `pnpm test`.

**E2E**: none yet (scaffold). `pnpm test:e2e` runs the vitest e2e lane.

## Hard constraints

- frozen pnpm installs only — no `pnpm add`, no `--no-frozen-lockfile`
- isolated test `DSH_HOME` only — never the real `~/.dsh`
- temp state in `.tmp/` (e2e homes, provisioned versions, artifacts)
- `pnpm typecheck` from the package dir, never bare `tsc`
