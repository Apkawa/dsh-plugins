# Research: 2026-10-16_utils-package

## Questions

1. What does the copy-pasted `log.ts` look like in the packages (canonical copy: `packages/dsh-ghl/src/log.ts`)? Which packages have copies?
2. How do the packages use their local loggers (call sites, namespaces, host/client halves)?
3. How is the pnpm workspace configured (workspace file, package.json conventions, cross-package deps)?
4. How are packages built and tested (build tool, tsconfig, vitest) so `packages/utils` can fit in?

## Findings

### F1 — Logger copies

Packages under `packages/`: `dsh-ghl`, `dsh-global-queue`, `dsh-model-settings`, `dsh-web-search-ddgs`.

Exactly **three** copies of the logger exist (one per package, `dsh-global-queue` has **no** logger at all):

- `packages/dsh-ghl/src/log.ts`
- `packages/dsh-model-settings/src/log.ts`
- `packages/dsh-web-search-ddgs/src/log.ts`

Canonical copy (`packages/dsh-ghl/src/log.ts`), verbatim:

```ts
/**
 * The plugin's gated logger. Every level except `error` is silent unless the process runs with
 * `DEBUG=1` (the exact value — no namespace globs); `error` is never gated, so failures
 * stay visible in quiet runs. The `[ghl]` tag lives here so call sites don't repeat it.
 */

/** True when this process was started with exactly `DEBUG=1`. */
const isEnabled = (): boolean => process.env.DEBUG === '1'

const TAG = '[ghl]'

export const dbg = {
  log: (...args: unknown[]): void => { if (isEnabled()) console.log(TAG, ...args) },
  info: (...args: unknown[]): void => { if (isEnabled()) console.info(TAG, ...args) },
  warn: (...args: unknown[]): void => { if (isEnabled()) console.warn(TAG, ...args) },
  debug: (...args: unknown[]): void => { if (isEnabled()) console.debug(TAG, ...args) },
  /** Never gated — failures must stay loud. */
  error: (...args: unknown[]): void => { console.error(TAG, ...args) },
}
```

Differences between copies: only the `TAG` (`[ghl]` / `[model-settings]` / `[web-search-ddgs]`) and one docstring clause. API, levels, gating, format identical.

Current exported API: single const object `dbg`; levels `log/info/warn/debug/error` → `console.*`; `log/info/warn/debug` gated on `process.env.DEBUG === '1'` (exact value); `error` never gated; output `<TAG> ...args`, no level prefix, no timestamps.

### F2 — Logger usage (all host-side)

Every `dbg` import/call site is in the host half (`src/*.ts`); client halves have zero logger usage.

- **dsh-model-settings**: imports in `src/index.ts:15`, `src/autofill.ts:1`, `src/probe.ts:1`. ~18 call sites: `dbg.debug` (watcher fire, autofill round start/skip/end, model listing, parse), `dbg.error` (autofill round FAILED at `index.ts:297`, persist failed at `autofill.ts:108`). NOTE: `index.ts:298–299` additionally logs the same autofill failure through dsh's own `ctx.logger.error(...)` — that is the dsh platform logger, not the copy-paste one.
- **dsh-ghl**: imports in `src/issues.ts:8`, `src/repo.ts:12`, `src/rpc.ts:12`, `src/cache.ts:11`. ~19 call sites: `dbg.debug` (requests, resolution paths, cache hits/misses), `dbg.warn` (rate budget exhausted `cache.ts:124`), `dbg.error` (GitHub API failures `issues.ts:105,106,113`, RPC failure `rpc.ts:23`).
- **dsh-web-search-ddgs**: imports in `src/index.ts:6`, `src/provider.ts:4`, `src/runner.ts:5`. ~11 call sites, all `dbg.log` (apply config, provider registered, availability, search ok, venv provisioning, uv invocation, spawn).
- **dsh-global-queue**: no logger, no `dbg`/`ctx.logger`/`console.*` anywhere in `src/` — nothing to migrate.

Each of the three packages has a unit test for its logger: `tests/unit/server/log.test.ts` asserting gating + tag.

### F3 — pnpm workspace configuration

- `pnpm-workspace.yaml` (verbatim): `packages:` / `  - packages/*` → a new `packages/utils` is picked up automatically; no workspace-file edit needed.
- Root `package.json` (verbatim):
  ```json
  {
    "name": "dsh-model-settings-workspace",
    "private": true,
    "type": "module",
    "engines": { "node": ">=24.0.0" },
    "scripts": {
      "build": "pnpm --filter @apkawa/dsh-model-settings build",
      "test": "pnpm --filter @apkawa/dsh-model-settings test",
      "typecheck": "pnpm --filter @apkawa/dsh-model-settings typecheck"
    }
  }
  ```
  Root scripts filter a **single** package (`@apkawa/dsh-model-settings`), no `pnpm -r` loop.
- Representative plugin `package.json` (`@apkawa/dsh-model-settings` v0.1.1): `type: module`, `main: lib/index.js`, `exports` for `.` and `./client` → `lib/*` (types+js), `files: ["lib", "cordis.patch.yml"]`, `dsh` block (bundle patch, client inject), `peerDependencies` + `devDependencies` (`tsdown ^0.22.2`, `typescript ^6.0.3`, `vitest ^4.1.8`, `@types/node ^22.20.0`, ...), scripts: `build: "tsc -p tsconfig.json && tsdown"`, `test: "vitest run"`, `typecheck: "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json"`.
- `tests-helpers/` is NOT a workspace package (no package.json) — shared test code is wired via `@root/tests-helpers/*` path alias (vitest `resolve.alias` + tsconfig `paths`).
- **No package uses the `workspace:` protocol yet** — `packages/utils` would introduce the first internal workspace link.
- No `packageManager` field; lockfile `lockfileVersion: '9.0'`; repo policy: frozen installs only, no `pnpm add` / `--no-frozen-lockfile` (cache via `pnpm_config_store_dir=./.cache/pnpm/v11`).

### F4 — Build & test setup

- Build tool: **tsc** (host half → `lib/`, `declaration: true`) + **tsdown** (browser client bundle, host+client packages only). No bun/tsup. `dsh-web-search-ddgs` is host-only → `tsc` alone.
- tsconfigs: no `composite`, no `references`, no root tsconfig. Host `tsconfig.json` (representative, verbatim):
  ```json
  {
    "compilerOptions": {
      "target": "es2024",
      "module": "esnext",
      "moduleResolution": "bundler",
      "ignoreDeprecations": "6.0",
      "baseUrl": ".",
      "paths": { "@root/tests-helpers/*": ["../../tests-helpers/*"] },
      "allowImportingTsExtensions": true,
      "rewriteRelativeImportExtensions": true,
      "declaration": true,
      "sourceMap": true,
      "skipLibCheck": true,
      "esModuleInterop": true,
      "strict": true,
      "types": ["node"],
      "noUncheckedIndexedAccess": true,
      "exactOptionalPropertyTypes": true,
      "noImplicitOverride": true,
      "noFallthroughCasesInSwitch": true,
      "outDir": "lib",
      "rootDir": "src"
    },
    "include": ["src"],
    "exclude": ["src/client", "tests"]
  }
  ```
  Host-only variant excludes only `["tests"]`. Client `tsconfig.client.json` is type-check-only (`noEmit`), extends host config.
- Vitest: per-package `vitest.config.ts`, `environment: 'node'`, `include: ['tests/**/*.test.ts']` (or `tests/unit/**`), `exclude: ['tests/e2e/**']`; test command `vitest run`.
- Consumption is from `lib/` (built output), never `src/`.
- New pure-TS `packages/utils` recipe: `type: module`, `main: lib/index.js`, `exports: { ".": { types, default }, "./package.json" }`, `files: ["lib"]`, no `dsh` block; scripts `build: "tsc -p tsconfig.json"`, `test: "vitest run"`, `typecheck: "tsc -p tsconfig.json --noEmit"`; vitest config node-env shape. Root scripts, if extended, follow the single-`--filter` pattern.

### F5 — Plugin install / runtime dependency resolution (e2e)

- `tests-helpers/e2e/dsh.ts` `launchDsh`: builds the package (`ensureBuilt`), then installs via `dsh plugin --profile web add <packageDir>` — a pnpm forwarder (`dsh/packages/boot/plugin-manager/src/operations.ts` `installOperation`, `anchorPathSpec`).
- The profile (`<DSH_HOME>/profiles/web/package.json`) records the plugin as a **`link:` install** — pnpm symlinks the live repo directory into the profile's `node_modules` (verified in leftover `.tmp/dsh-e2e-*/.dsh/profiles/web/`: `"@apkawa/dsh-ghl": "link:/home/apkawa/code/dsh-model-settings/packages/dsh-ghl"`, `node_modules/@apkawa/dsh-ghl -> ../../../../../../../packages/dsh-ghl`). The `files` restriction never applies to `link:` installs; the plugin keeps the repo's workspace `node_modules`.
- dsh runtime resolution (`dsh/.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.md`): symlinks are followed to the real path; a linked plugin's non-peer imports resolve along the **real path's ancestor chain** (`packages/<plugin>/node_modules` → repo-root `node_modules` → …). A workspace-linked `@apkawa/utils` therefore resolves in e2e once the repo's `pnpm install` links it.
- Precedent: `dsh/docs/user/develop/basic/publish.md` — linked checkouts "keep their own node_modules"; "Keep independently versioned third-party dependencies and stateless dsh utilities in `dependencies` so the linked checkout installs and owns them."
- **Registry/tarball install (production):** a `files`-scoped copy ships no `node_modules`; `@apkawa/utils` would need to be published to npm and declared in the plugin's `dependencies`. Deployment constraint — out of scope for this task.

**Decision input:** plugins declare `@apkawa/utils` in `dependencies` with the `workspace:*` protocol (first internal workspace link in the repo); works in e2e via the linked checkout's own node_modules.
