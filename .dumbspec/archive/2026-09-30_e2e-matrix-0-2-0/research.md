# 2026-09-30_e2e-matrix-0-2-0: research

## R1. Version references inventory (subagent report, 2026-09-30)

### Version references (path:line)

**Shared plumbing**
- `tests-helpers/e2e/dsh.ts:6` — header comment: 0.1.1-rc.2 prints tokenless ready URL, 0.1.2+ prints `?token=…`
- `tests-helpers/e2e/dsh.ts:26` — comment on `READY_LINE` matching both URL shapes
- `tests-helpers/e2e/dsh.ts:29` — `E2E_DSH_VERSIONS = ['0.1.1-rc.2', '0.1.2-rc.1'] as const`
- `tests-helpers/e2e/dsh.ts:45,53,79` — `version` defaults to the 0.1.1-rc.2 baseline (`launchDsh`, `resolveDshBinary` fallback)
- `tests-helpers/e2e/live.ts:10` — comment "core defaults to the 0.1.1-rc.2 baseline"
- `tests-helpers/e2e/live.ts:19-20` — comment "0.1.2+ ready URLs are tokenized"
- `tests-helpers/e2e/live.ts:25-27` — console filter for the keyless **0.1.1-rc.2** "Password field … not contained in a form" note
- `scripts/e2e-live.ts:88` — `--version` default `'0.1.1-rc.2'`

**dsh-model-settings**
- `packages/dsh-model-settings/tsdown.config.ts:10` — seed list = union of the 0.1.1-rc.2 and 0.1.2-rc.1 seed lists
- `packages/dsh-model-settings/tsdown.config.ts:93-94` — version-gated `client-store` fallback (0.1.2-rc.1 static platform seed; 0.1.1-rc.2 banner fallback)
- `packages/dsh-model-settings/src/index.ts:261` — RPC channel row defers on `ctx.inject(['connection'], …)` (0.1.2-rc.1: profile plugins apply before the web-app `client-connection` row)
- `packages/dsh-model-settings/tests/e2e/acceptance.spec.ts:6-12` — header comment: 0.1.2-rc.1 client-import failure, 405 bug "tracked in `.dumbspec/current/fix_0.1.2-rc1`" (STALE ref — task is archived)
- `packages/dsh-model-settings/tests/e2e/acceptance.spec.ts:32-35` — `if (version === '0.1.1-rc.2')` → expects `Add an API key to get started` dialog
- `packages/dsh-model-settings/tests/e2e/acceptance.spec.ts:39-46` — comments + red signal "missed the module table", 405 fallback
- `packages/dsh-model-settings/tests/e2e/acceptance.spec.ts:59-62` — `if (version === '0.1.1-rc.2')` → zero console errors asserted
- `packages/dsh-model-settings/AGENTS.md:39` — E2E section: matrix, 405 workaround, stale ref `.dumbspec/current/fix_0.1.2-rc1`

**dsh-web-search-ddgs**
- `packages/dsh-web-search-ddgs/package.json:34` — `"@deepseek-ai/dsh-web": "0.1.1-rc.2"` (types-only devDependency)
- no literal versions in its AGENTS.md or test files

**Repo docs**
- `AGENTS.md:25` — matrix versions, `e2e-live --version` default, 405 workaround, stale ref `.dumbspec/current/fix_0.1.2-rc1`
- `CONTRIBUTING.md:26,28,37` — vitest e2e lane, manual CLI, binary resolution + `.tmp/dsh-versions/`
- `CONTRIBUTING.md:41` — stale: "known 405 on 0.1.2-rc.1; pinned to 0.1.1-rc.2 until fix lands" (RPC lane is now in the matrix)

**Lockfile**
- `pnpm-lock.yaml` — 78 lines mention `0.1.1-rc.2`, 0 lines `0.1.2-rc.1` (the types-only dep is the only lockfile footprint; matrix versions are installed only into `.tmp/dsh-versions/<version>` throwaway projects)

### Matrix definition & consumers

- Definition: `tests-helpers/e2e/dsh.ts:29` `E2E_DSH_VERSIONS = ['0.1.1-rc.2', '0.1.2-rc.1'] as const`
- Consumers (all lanes, both packages, run the full matrix):
  - `packages/dsh-model-settings/tests/e2e/server/boot.test.ts:12` — boot smoke (`describe.each`)
  - `packages/dsh-model-settings/tests/e2e/server/model-settings.test.ts:13` — RPC lane (`describe.each`)
  - `packages/dsh-model-settings/tests/e2e/acceptance.spec.ts:13` — playwright lane (plain `for` over the matrix)
  - `packages/dsh-web-search-ddgs/tests/e2e/server/boot.test.ts:11` — boot smoke (`describe.each`)
  - `packages/dsh-web-search-ddgs/tests/e2e/server/live-search.test.ts` — NOT a matrix consumer (no dsh instance; skips when `uv` unavailable)
- Version-conditional test branches exist only in `acceptance.spec.ts` (`:32`, `:59` — 0.1.1-rc.2-only dialog + zero-error asserts).

### Shared e2e plumbing

`tests-helpers/e2e/dsh.ts` (268 L): `REPO_ROOT :19`, `READY_TIMEOUT_MS=90_000 :21`, `PROVISION_STALE_MS=10min :22`, `PROVISION_TIMEOUT_MS=180_000 :23`, `ONLY_BUILT :24`, `KEYLESS_STRIP :25`, `READY_LINE = /dsh web: (http:\/\/[^\s]+)/ :27`; `DshHandle { url, port, root, package, bin, cookie, child, version } :32-41`; `launchDsh :49-63` (validate package, `resolveDshBinary`, default `E2E_DSH_BIN` override → `null` else `opts.version ?? '0.1.1-rc.2'`, temp root, `childEnv`, `ensureBuilt`, `addPlugin` = `dsh plugin --profile web add <pkg>`, `bootWeb` = `dsh web --port <port> --no-open`, `cookie = url.includes('token=') ? await exchangeSession(url) : null`, `0.0.0.0`→`127.0.0.1`); `stopDsh :66-70` (SIGTERM + `rmSync(root)` unless `E2E_KEEP='1'`); `resolveDshBinary :73-80` (`E2E_DSH_BIN` must exist, no PATH fallback; else `ensureDshVersion(version ?? '0.1.1-rc.2')`); `ensureDshVersion :88-111` (`.tmp/dsh-versions/<version>`; short-circuits if `node_modules/.bin/dsh` exists; mkdir-based provision lock; manifest with `@deepseek-ai/dsh: <version>` + `onlyBuiltDependencies`; `spawnSync('pnpm', ['install'])` CI=1, `pnpm_config_store_dir=<repo>/.cache/pnpm/v11`, 180 s); `createTempRoot :115-120`; `childEnv :122-130` (isolated `DSH_HOME`, `DSH_AGENTS_HOME`, telemetry off, keyless strips, shared pnpm store); `ensureBuilt :132-139`; `requiredArtifacts :143-149` (`lib/index.js` + `lib/client.js` if `exports['./client']`); `waitForReady :173-191`; `exchangeSession :193-207` (token URL, expects 303 + Set-Cookie); `acquireProvisionLock :209-228`; `writeProvisionFiles :238-251` (local `pnpm-workspace.yaml` makes the dir its own pnpm root + package.json manifest).

`tests-helpers/e2e/dsh-fixture.ts` (129 L) — vitest wrapper, NO literal versions: `ROUTE_ID='e2e' :22`, `MODEL_ID='e2e-model' :23`, `WARMUP_TIMEOUT_MS=30_000 :25`, `POLL_MS=500 :26`; `startDsh({ packageName, version, port=0 }) :43-45`; `pluginListed :48-52`; `rpc<T>(handle, channel, endpoint, payload) :55-68` (POST `http://127.0.0.1:<port>/<channel>/<endpoint>` with `{ type:'client-request', rpcId, method, payload }`, unwraps `envelope.result`, transport errors → `{ ok:false, error:{ code:'transport' } }`); `rpcHeaders :70-74` (session-required versions → 401 without cookie); `warmModel :77-101` (writes `settings.yaml` pointing at a closed local port, polls `listModels` until the row is committed, 30 s); `findRow`/`writeSettings :104-111`; `startJsonServer(body) :117-129` (local JSON stand-in for `/v1/models` listings).

`tests-helpers/e2e/live.ts` (39 L) — playwright wrapper: `launchPluginTestHome(packageName, version?) :9-22` (opts `{ packageName, keyless: true, port: 0, version? }`, conditional spread); `trackConsoleErrors(page) :24-39` (console error/warning + pageerror; `:25-27` filters the benign keyless 0.1.1-rc.2 password-field DOM note).

### scripts/e2e-live.ts

125-line manual CLI: `main :30-50` (parse args, reject missing `packages/<name>`, SIGINT/SIGTERM → stop, `launchDsh({ packageName, port, version })`, `verifyInstance`, prints binary/url/cookie/root/pid); `verifyInstance :53-57` (HTTP GET with cookie must be 200); `stop :60-70` idempotent, `--keep` → `E2E_KEEP='1'`; `fail :73-83`; `parseArgs :87-121` defaults `{ port: 3081, keep: false, packageName: null, version: '0.1.1-rc.2' }`; flags `--keep`, `--port`, `--package` (required), `--version`; unknown option → usage error.

### fix_0.1.2-rc1 task state

- **COMPLETE and ARCHIVED** at `.dumbspec/archive/fix_0.1.2-rc1/` (all four files; `plan.md`: 23 `[x]`, 0 `[ ]`).
- Recorded outcomes: RPC 405 red on 0.1.2-rc.1 (`plan.md:51`); green: RPC lane in the matrix on both versions (`:53`); commit `225af97` = plugin-side `ctx.inject(['connection'], …)` deferral workaround, RPC 8/8 both versions, playwright 2/2 both (`:56`); refactor dropped redundant `CLIENT_EXTERNALS` (`:59`); task archived (`:62`); follow-up docs commit (`:65`, unit vitest `exclude: ['tests/e2e/**']`).
- **Stale references** to `.dumbspec/current/fix_0.1.2-rc1` (no longer exists): `AGENTS.md:25`, `packages/dsh-model-settings/AGENTS.md:39`, `packages/dsh-model-settings/tests/e2e/acceptance.spec.ts:6-12`; `CONTRIBUTING.md:41` carries the stale "pinned to 0.1.1-rc.2 until the fix lands" wording.

### Per-package e2e test files

**dsh-model-settings**
- `tests/e2e/server/boot.test.ts` (34 L) — boot smoke per version: `startDsh` (180 s), asserts `pluginListed` + HTTP 200 (cookie header only when minted); afterAll asserts `stopDsh` exit 0 + temp-root removal.
- `tests/e2e/server/model-settings.test.ts` (91 L) — RPC lane per version: cold home lists no rows; `saveModel` roundtrips `efforts`+`contextWindow`; `saveModel` roundtrips vision `input` part; autofill fills `input` from a live `startJsonServer` listing, polling `listReasoningRows` 30 s expecting `['text','image']` with no `contextWindow`.
- `tests/e2e/acceptance.spec.ts` (83 L) — playwright acceptance per version: keyless smoke shows Model settings; injects session cookie if minted; dismisses Internal Testing Notice; 0.1.1-rc.2-only branches (API-key dialog `:32-35`, zero console errors `:59-62`); asserts no "missed the module table" errors, zero "Failed to load plugins" toasts; Settings → Model settings → `No OpenAI-compatible routes configured.`; `window.__DSH_BOOT__` includes `@apkawa/dsh-model-settings`.

**dsh-web-search-ddgs**
- `tests/e2e/server/boot.test.ts` (33 L) — same shape as model-settings boot smoke.
- `tests/e2e/server/live-search.test.ts` (47 L) — NOT a matrix lane: `describe.skipIf(!uvAvailable)`; `DdgsSearchProvider` over `createRunner` (venv, `ddgsVersion: 'ddgs'`, 60 s timeout); asserts provider id + real results for query `'react version'`.

Config pairing: model-settings `package.json:65` `"test:e2e": "vitest run --config vitest.e2e.config.ts && pnpm exec playwright test"`; web-search-ddgs `package.json:44` `"test:e2e": "vitest run --config vitest.e2e.config.ts"`; both have `e2e:live` → `scripts/e2e-live.ts --package <name>`.

### Other relevant facts

- No CI config (no `.github/`); e2e runs locally only.
- Version-gated conditional code (independent of the matrix list): `tsdown.config.ts:10,93-94` (client-store seed list = union of both versions' seeds; per-version fallback), `src/index.ts:261` (inject deferral for 0.1.2-rc.1 ordering), `acceptance.spec.ts:32-35,59-62` (0.1.1-rc.2-only UI branches), `live.ts:25-27` (keyless console filter written for 0.1.1-rc.2).
- `pnpm-lock.yaml` footprint of `0.1.1-rc.2` = the types-only `@deepseek-ai/dsh-web` devDep in web-search-ddgs only.
- Both current versions are already provisioned under `.tmp/dsh-versions/<version>`; first `0.2.0-rc.2` launch triggers a fresh ~180 s provision.
- `dsh-fixture.ts` is version-agnostic; all version sensitivity lives in `dsh.ts` defaults/comments, `live.ts` comments/console filter, `e2e-live.ts:88`, and test-file conditional branches.
- Root `package.json:10` `test` script filters only model-settings unit tests; no root e2e script.

## R2. dsh 0.2.0-rc.2 impact on plugins (subagent report, 2026-09-30)

### Checkout identity
- `dsh/` → `/home/apkawa/source/deepseek-harness` is **0.1.2-rc.1** (package.json `0.1.2-rc.1`, HEAD detached at tag `dsh-v0.1.2-rc.1`, commit `a66e470204 release(dsh): 0.1.2-rc.1`). Local clone stale (tags only to `dsh-v0.1.3-alpha.1`).
- Remote has `refs/tags/dsh-v0.2.0-rc.2` → commit `639ed015397290b3745d163aafe02ffee4aa3f84`.
- 0.2.0-rc.2 facts come from extracted GitHub tag source (`.tmp/dsh-src-0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/`) and npm tarball (`.tmp/dsh-npm-0.2.0-rc.2/package/`); nothing written under `dsh/`.

### npm registry state
- `@deepseek-ai/dsh@0.2.0-rc.2` **exists**, is `latest` AND `next`. dist-tags: `{ alpha: 0.1.7-alpha.2, latest: 0.2.0-rc.2, next: 0.2.0-rc.2 }`.
- Version tail: `… 0.1.7-rc.1, 0.1.7-rc.2, 0.2.0-rc.1, 0.2.0-rc.2`.
- Published package = thin CLI wrapper (`apps/cli`), deps: `@deepseek-ai/cordis ~4.0.4`, `cordis-plugin-include ~1.0.9`, `cordis-plugin-loader ~1.0.5`, `@deepseek-ai/schemastery ~3.18.4`, all `@deepseek-ai/dsh-*` pinned to `0.2.0-rc.2`.
- Relevant: `@deepseek-ai/dsh-settings@0.2.0-rc.2`, `@deepseek-ai/dsh-client-connection@0.2.0-rc.2` (dual-face, both halves ship).

### Startup ordering / 405 bug status
- **Structurally unchanged; bug NOT fixed in 0.2.0-rc.2 (static-source inference).**
- Composition order identical: bundles' patch lists in `dsh.profile.bundles` order over empty entry list, then profile's own `cordis.patch.yml`, then launcher layers (0.2.0-rc.2 `packages/boot/app-boot/src/profile.ts` L5–14, L731 `composeEntries`).
- Web template bundles identical: `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`.
- `dsh plugin add` appends added bundles to the end of `dsh.profile.bundles` in both versions (0.2.0-rc.2 `packages/boot/profile-plugins.ts` `reconcileProfilePlugins`).
- `connection` row still inside web-app bundle in 0.2.0-rc.2 (`packages/bundle/web-app/cordis.patch.yml`, `id: connection`, `name: '@deepseek-ai/dsh-client-connection'`, `inject: [webRuntime]`); host `'connection'` service provided only by that row's host-half `apply` (`packages/client/connection/src/rpc-host.ts`: `HostConnectionService extends Service` → `super(ctx, 'connection')`).
- Activation is dependency-driven: rows with unmet `inject` stay pending while later rows activate. A later plugin row (no unmet inject at apply) can apply while `connection` is still pending — the exact 405 mechanism.
- Strongest evidence the gap persists: web-app bundle's OWN ready line defers on the service — `ctx.inject(['connection'], (connectionCtx) => { … print URL … })` at 0.2.0-rc.2 `packages/bundle/web-app/src/index.ts:257` (same pattern 0.1.2-rc.1 `web-app/src/index.ts:262`).
- Conclusion: keep the nested `ctx.inject(['connection'], …)` workaround for 0.2.0-rc.2; NOT e2e-verified (matrix switch confirms).

### Plugin API surface

**model-settings host half (`packages/dsh-model-settings/src/index.ts`):**

| Call (current code) | 0.2.0-rc.2 status | Evidence |
|---|---|---|
| `ctx.inject(['settings'], sctx => …)` | OK — service still named `settings` | `SettingsForms extends Service`, `super(ownerContext, 'settings')` — `packages/settings/settings/src/index.ts:223-230` |
| `sctx.settings.register(NS, ModelSettingsSchema, { base: EMPTY_CONFIG })` (L238) | **GONE** — no `register`; namespaces derive from Loader entry id + plugin's own `Config` schema (`SettingsForms.schema(entry)` = `entry.fiber.runtime.Config`, projected via `volatileForm`) | `packages/settings/settings/src/index.ts` (no `register`; `describe()` L300+; `schema()` L421+). Existed in 0.1.2-rc.1 at `:419`. |
| `ctx.on('settings/updated', (ns) => …)` (L244) | **RENAMED** — `settings/document-updated(ns, revision)` (2 args, revision-based); old event has zero matches | `settings/src/index.ts:317` (emit), `types.ts:75` |
| `import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'` (L12) | **BROKEN import** — published 0.2.0-rc.2 `lib/types/index.d.ts` exports NO `settingsNamespace` function (only `SettingsNamespace` type) and NO `SettingsProvider` type; our installed 0.1.0-rc.8 still has `settingsNamespace` | `.tmp`-extracted `@deepseek-ai/dsh-settings@0.2.0-rc.2` `lib/types/index.d.ts` |
| `makeLlmStore` → `settings.describe()` / `settings.mutate(ns, ops, expectedRevision)` | OK — `describe` (d.ts L96), `mutate` (L114), `update`/`replace`, `SettingsConflictError` (L31) all exist | same d.ts |
| `sctx.inject(['connection'], …)` + `connCtx.get('connection')` (L266) | OK — still the documented pattern | §ordering |
| `conn.rpc.handle(CHANNEL, handler, { authority: 'trusted-host' })` (L269) | **Signature unchanged**: `handle(channel: string, handler: ConnectionRpcHandler): () => Promise<void>` in BOTH versions (0.2.0-rc.2 `rpc.ts:173-176`; 0.1.2-rc.1 `rpc.ts:140-143`). 3rd arg extra in both — runtime no-op, pre-existing type mismatch in our code | both `rpc.ts` |

- In 0.2.0-rc.2 the settings namespace string is the **profile entry id** — our bundle inserts `id: model-settings`, so `ns === 'model-settings'` for describe/mutate. BUT `describe()` skips entries without a `Config` schema, and our host half exports **no `Config`** (only `name` + `apply`) — the old `register(NS, z.object({}), {base})` placeholder has no direct replacement: namespace will not exist unless the plugin gains a `Config` export (which also auto-generates a settings page, `autoGenerate` default true).
- The `llm-pi-ai` namespace for `makeLlmStore` must come from the llm adapter's own `Config` in 0.2.0-rc.2 (NOT VERIFIED — caveats).
- Channel routing unchanged: `register()` builds `WebRoute {kind:'prefix', path: channel}`, effect `owner.webServer.register(route)`; unknown endpoint → 404, non-POST → 404 (`rpc-host.ts`).

**model-settings client half (`src/client/index.ts`):** `inject = ['slots', 'connection', 'remote']` — all three still provided client-side in 0.2.0-rc.2 (`'connection'` `packages/client/connection/src/client/index.ts:310`, `'slots'` `packages/client/ui-renderer/src/client/registry.ts:160`, `'remote'` `packages/api/gateway/src/client/index.ts:154`). `ctx.slots.register/inject` unchanged. Client already listens for `'settings/document-updated'` via `remote.$on` (`client/index.ts:87`) — already on the NEW event name; the host half's `ctx.on('settings/updated', …)` is the side still on the old name.

**web-search-ddgs (host-only):** `inject = ['web']`, `ctx.web.registerSearchProvider(provider)` — **unchanged** (0.2.0-rc.2 `packages/web/web/src/index.ts:103`, `WebRuntime extends Service`, `super(ctx, 'web')`). One behavior delta: any plugin `Config` schema is projected into settings forms, so ddgs's `Config` (backend/maxResults/timeoutMs/venvDir/ddgsVersion) will surface as a `web-search-ddgs` settings namespace automatically.

### dsh web ready line
- 0.2.0-rc.2: after the complete Loader tree settles, prints `dsh web: <authenticatedUrl>` plus ` (LAN: <lanUrl>)` when a LAN address exists (`packages/bundle/web-app/src/index.ts` L271). `authenticatedUrl = connection.authenticatedUrl(webUrl)` adds the process launch token → **tokenized** URL. Test `tests/web-app.spec.ts:148` expects `http://127.0.0.1:4567/?token=test-token (LAN: …)`.
- Default-browser handoff prints `dsh web: opening the default browser; pass --no-open to disable` (L274); handoff default-on, suppressed under SSH and by `--no-open`.
- Flags `--host`, `--port`, repeatable `--trusted-host`, `--no-open` identical in 0.1.2-rc.1 (`web-app/src/startup.ts:52`) and 0.2.0-rc.2 — e2e harness (`dsh web --port N --no-open`) works unchanged.
- Ready line **unchanged in shape between 0.1.2-rc.1 and 0.2.0-rc.2**. Only the 0.1.1-rc.2 baseline was tokenless.

### Release notes deltas (0.1.2-rc.1 → 0.2.0-rc.2)
No CHANGELOG in repo; notes from GitHub Releases. Intermediate releases: 0.1.3-alpha.1/.2, 0.1.5-alpha.1/.2, 0.1.5-rc.1/.2, 0.1.6-alpha.1/.2, 0.1.7-alpha.1/.2, 0.1.7-rc.1/.2, 0.2.0-rc.1, 0.2.0-rc.2. Plugin-relevant:
- **0.1.7-alpha.1** (into 0.1.7-rc.1): "Save settings in the current Profile's plugin configuration, supporting fields declared for live updates. Import from the legacy settings.yaml is attempted only once; **custom settings plugins must adapt**" — the settings redesign behind the `SettingsForms` API. Directly breaks `settings.register` / `settings/updated`.
- 0.1.7-alpha.1: plugin bundles may declare ordered multiple patch files; volatile/live config fields.
- 0.1.6-alpha.2: "Plugin dependencies now use runtime resolution, and Plugin Manager supports runtime unloading. **Plugin developers should check their loading and unloading logic**" (our `ctx.effect` disposer pattern is the supported form).
- 0.1.6-alpha.1: PTC renamed to `ptc-runtime` family (not used by us); `agent/session-start` → async `agent/created` (not used by us).
- 0.1.5-rc.1: `ctx.agent` removed; `Inbox` type-only; **Web plugin panel API** changed (`sidebar.panellist`, `main`, conversation slot) — we use `ctx.slots` (`settings.section`, `settings.plugin.item`), not the panel API, so unaffected.
- 0.2.0-rc.1: "Reduce waiting time when saving plugin configuration"; automation tasks become an optional plugin bundle.
- 0.2.0-rc.2 (vs rc.1): no plugin-API changes — dsh command bundled in macOS/Windows desktop, plugin-management UI refinements, model catalog update to pi-ai 0.87.1 (some old model IDs removed), experimental async question mode.

### Caveats
- The `dsh/` checkout is 0.1.2-rc.1; all 0.2.0-rc.2 statements rest on extracted GitHub tag source and npm tarballs in `.tmp/`.
- §ordering verdict (405 mechanism unchanged) is a **static-source inference**, not e2e-verified against 0.2.0-rc.2.
- NOT verified: whether the `llm-pi-ai` entry in 0.2.0-rc.2 still carries a `Config` making `mutate('llm-pi-ai', …)` work (autofill store depends on it); whether `volatileForm`/field-volatility rules would accept the models-list path op `providers.<route>.models`.
- `rpc.handle` 3rd arg `{ authority: 'trusted-host' }` was already outside the declared 2-arg signature in 0.1.2-rc.1 — pre-existing type-level mismatch, unchanged.
- Temp artifacts remain in `.tmp/` (`dsh-npm-0.2.0-rc.2/`, `dsh-src-0.2.0-rc.2/`, `dsh-releases.json`, `dsh-settings-0.2.0-rc.2` extraction).

## R3. Red run findings (Stage 1, 2026-09-30)

- **NEW FACT — peer-dependency compatibility check at install time:** dsh 0.2.0-rc.2 rejects `dsh plugin add` when the plugin's `peerDependencies` are incompatible: model-settings pins `^0.1.0-rc.7` on `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-settings` → `installation rejected: Plugin @apkawa/dsh-model-settings@0.1.1 is incompatible with dsh 0.2.0-rc.2`. Escape hatch offered: `dsh plugin --profile web allow-version <plugin> --dsh-version <v> --accept-risk` (not needed if peerDeps are bumped). Consequence: **Stage 3 must bump model-settings peerDeps** to ranges covering 0.2.0-rc.2; the host half never even loads, so the `settings.register` runtime failure is masked by the install rejection.
- model-settings red: boot FAIL, RPC FAIL, acceptance FAIL — all on the install rejection (logs: `.tmp/e2e-stage1-model-settings.log`).
- ddgs boot **PASS** on 0.2.0-rc.2 (peerDeps only `@deepseek-ai/cordis` + `@deepseek-ai/schemastery` — no dsh-client-* pins).
- ddgs live-search: environmental — sandbox can't write `~/.cache/uv` (must set `UV_CACHE_DIR`/`TMPDIR` into workspace); with that, venv provisions and ddgs runs but `DDGSException: No results found` (live-scraper network failure, reproduced twice; orthogonal to the version-matrix switch).
- E2E harness behavior (pre-existing): when `addPlugin` throws in `launchDsh`, the temp root `.tmp/dsh-e2e-*` leaks (not cleaned, no `stopDsh` call path). Noted, out of scope unless it recurs.
- E2E-live CLI note: `pnpm e2e:live -- --port N` passes a literal `--` the parser rejects; use `pnpm e2e:live --port N` (package script already carries `--package`).
- 0.2.0-rc.2 boot observed: ready line tokenized in child stdout; the CLI handle URL is the token-exchanged (cookie) form, `session cookie` minted — consistent with `exchangeSession` core logic.

## R4. Settings API migration mapping — host half (Stage 2, 2026-09-30)

Legend: DSH = `.tmp/dsh-src-0.2.0-rc.2/deepseek-harness-dsh-v0.2.0-rc.2/`; PLG = `packages/dsh-model-settings/`; settings pkg = `DSH/packages/settings/settings/src/`; published settings tarball extracted at `.tmp/dsh-settings-tgz-0.2.0-rc.2/package` (tarball parity with source confirmed verbatim for `SettingsPathOp`, event map, `configure`, `mutate`).

### R4.1 Entry / Config declaration
- 0.1.x (ours): host half owned a hand-built section via `SettingsForms.register(ns, schema, {base})` — `PLG/src/index.ts:238` `sctx.settings.register(NS, ModelSettingsSchema, { base: EMPTY_CONFIG })`, with the empty schema `ModelSettingsSchema = z.object({})` (`src/index.ts:32`) and `EMPTY_CONFIG = {}` (`src/index.ts:33`).
- 0.2.0-rc.2: no `register` on `SettingsForms` (published method surface is exactly `configure`, `writable`, `describe`, `update`, `replace`, `mutate` — tarball `lib/types/index.d.ts`). The namespace is derived from the plugin's profile entry id + its named-export `Config` schema; `SettingsForms` reads `entry.fiber?.runtime?.Config` (settings `index.ts:425-428`, guarded by `'toJSON' in schema`).
- A plugin that wants a settings section must `export const Config = <schemastery z schema>` with at least one `.volatile()` field.

### R4.2 Our namespace id
- 0.1.x: `const NS = settingsNamespace('model-settings')` (`PLG/src/index.ts:25`), `settingsNamespace` imported from `@deepseek-ai/dsh-settings` (`src/index.ts:12`).
- 0.2.0-rc.2: `settingsNamespace` is NOT exported (tarball exports: `redactSecrets`, `RedactedSecret`, `RedactedValue`, `SettingsNamespace`, `SettingsDescriptor`, `SettingsDescribeOptions`, `SettingsConflictError`, `SettingsPathOp`, `SettingsForms` + default — no `settingsNamespace`, no `SettingsProvider`). The namespace key IS the profile entry id: `ns: entry.options.id` (settings `index.ts:315`, :325). Our entry id is `model-settings` (`PLG/cordis.patch.yml:5`).
- **Decision:** the v1 registered card was an EMPTY schema (`z.object({})`). In 0.2.0-rc.2 an empty schema produces no namespace at all (`form === undefined`, settings `index.ts:308-309`) and every write would throw `has no volatile fields` (settings `index.ts:385-386`). All model rows live in the `llm-pi-ai` namespace (R4.5). Therefore the host half **stops claiming the `model-settings` namespace**: drop `register`, drop the empty `ModelSettingsSchema`/`EMPTY_CONFIG`, do NOT add a volatile `Config` to the plugin (that would auto-generate a duplicate settings page — see R4.8). Use plain-string namespace ids (`'llm-pi-ai'`).

### R4.3 register() replacement / document shape
- No drop-in replacement. The "document" is the profile patch managed by the settings service's `configEditor` (settings `index.ts:289` `documentPath`, `prepareDocument()` :292-293); each plugin's live section is its own `Config` schema value in the profile. `configure({auto}, fiber)` (settings `index.ts:266-279`) only sets the page-generation policy for an existing Config — it does not declare a section.

### R4.4 settings/document-updated
- Declaration (Cordis `Events`, `@mode emit`), argument order `(ns, revision)`: `DSH/packages/settings/settings/src/types.ts:75` — `'settings/document-updated'(ns: SettingsNamespace, revision: number): void`.
- Emit sites (on the owner/host root context): on value/policy change inside `describe()` — settings `index.ts:316-318` (`if (previous?.raw !== raw || previous.autoGenerate !== autoGenerate) this.ownerContext.emit('settings/document-updated', entry.options.id, revision)`); on entry removal — settings `index.ts:337`.
- Host-side listener pattern (confirmed from a real 0.2.0-rc.2 consumer, `DSH/packages/settings/settings/tests/configuration.spec.ts:166`): `ctx.on('settings/document-updated', (ns, revision) => { … })`. Service reached via `ctx.inject(['settings'], …)` (service name `'settings'`, settings `index.ts:224,231`; real consumer `DSH/packages/llm/llm-pi-ai/src/index.ts:150`).
- Wire forwarding to clients: `DSH/packages/api/remotes/src/remote-events.ts:45` — `{ event: 'settings/document-updated', mode: 'emit' }`. Client consumers use `ctx.remote.$on('settings/document-updated', …)` (`DSH/packages/client/ui-settings/src/client/index.ts:43`, `ui-settings-models/src/client/index.ts:126`, `ui-agent-preset/src/client/index.ts:136`, `ui-model-selection/src/client/service.ts:55`).
- Our host listener `ctx.on('settings/updated', …)` (`PLG/src/index.ts:244`) must be renamed; the old event name has ZERO hits in the 0.2.0-rc.2 tree.

### R4.5 llm-pi-ai namespace (autofill)
- Entry id `llm-pi-ai`: `DSH/packages/bundle/base/cordis.patch.yml:127-128`. Namespace = entry id (`DSH/packages/llm/llm-pi-ai/src/index.ts:151`, `NS = 'llm-pi-ai'` at :96).
- Config (`DSH/packages/llm/llm-pi-ai/src/config.ts:351-354`):
  ```ts
  export const Config = z.object({
    providers: z.dict(profile).default({}).volatile(),
  })
  ```
  Only top-level field: `providers` (dict keyed by provider-route id, default `{}`, `.volatile()`).
- Per-route profile fields (`config.ts:326-349`): `apiKeyEnv` (role `credential-ref`), `displayName`, `api`, `baseURL`, `models: z.array(modelProfile)`, `modelOverrides`, `compat`, `defaultContextWindow` (262144), `defaultMaxTokens` (32768), `defaultInput` (`['text']`), `headers`, `reasoning`, `thinkingBudgets`, `cacheRetention`, `transport`, `timeoutMs`, `websocketConnectTimeoutMs`, `streamIdleTimeoutMs` (300000), `maxRequestImageBytes`, `requestImagePixelBudget`, `requestImageMaxBytes`, `retryPolicy`.
- Per-model fields (`modelProfile = z.object({ id, …modelFields })`, `config.ts:314-317`, `modelFields` :303-311): `id` required, `name` (default = id), plus the context/input fields — confirm exact names from `config.ts:303-311` during implementation (autofill writes `efforts`/`contextWindow`/`input`-style rows).
- **Autofill write unchanged:** `mutate('llm-pi-ai', [{ op: 'set', path: ['providers', routeId, 'models'], …value }], revision)` — conflict semantics identical.

### R4.6 mutate op shapes
- `SettingsPathOp`: op name `set` with `path: (string|number)[]` and a value (tarball `lib/types/index.d.ts`; settings source `index.ts` mutate impl). List-set via `path: ['providers', routeId, 'models']` replaces the whole list — accepted (same shape llm-pi-ai itself uses). `expectedRevision` conflict → `SettingsConflictError` unchanged.

### R4.7 Volatility
- A field is live-editable when marked with the `.volatile()` schemastery modifier (see `llm-pi-ai` `config.ts:353`). An entry whose Config has NO volatile fields is not writable: writes throw `has no volatile fields` (settings `index.ts:385-386`), and `describe()` projects no form for it (`index.ts:308-309`).
- `llm-pi-ai`'s `providers` IS volatile, so the autofill `providers.<routeId>.models` mutation works unchanged.
- Implication for us: no `Config` needed at all (R4.2 decision).

### R4.8 autoGenerate
- `configure({auto}, fiber)` (settings `index.ts:266-279`) sets the page-generation policy for a plugin that HAS a Config; default `autoGenerate` is true. Since we add no `Config`, no auto-generated page appears for `model-settings` — no conflict with the client's slot-registered section.

### R4.9 Imports & peer deps
- Published `@deepseek-ai/dsh-settings@0.2.0-rc.2` exports (runtime+types): `redactSecrets`, `RedactedSecret`, `RedactedValue`, `SettingsNamespace`, `SettingsDescriptor`, `SettingsDescribeOptions`, `SettingsConflictError`, `SettingsPathOp`, `SettingsForms` + default. `settingsNamespace`/`SettingsProvider` are GONE — those imports must be dropped or replaced by the remaining names (e.g. `type SettingsNamespace`, `SettingsConflictError`, `SettingsPathOp` where needed).
- All four peer packages (`@deepseek-ai/dsh-client-connection`, `dsh-client-runtime`, `dsh-client-ui-slots`, `dsh-settings`) are published at `0.2.0-rc.2`. Peer range recommendation: `^0.2.0-rc.2` for all four (covers the 0.2.0-rc.2 dsh install that the e2e matrix targets).
- Also relevant: bump `@deepseek-ai/cordis` peer to `~4.0.4` and `@deepseek-ai/schemastery` to `~3.18.4` if the install check requires (R4.9 detail from the mapping report — confirm against the exact rejection message if the bump to `^0.2.0-rc.2` alone does not satisfy the check).

### R4.10 Client sync
- The client half's `remote.$on('settings/document-updated', …)` (`PLG/src/client/index.ts:87`) stays correct: the host-side `settings/document-updated` emit is forwarded to client connections by `remote-events.ts:45`.
- **NEW FACT — client slot rename:** the client slot `settings.plugin.item` (`PLG/src/client/slot-contract.ts:13`) does NOT exist in the 0.2.0-rc.2 slot catalog; the current settings slots are `settings.section` (`DSH/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:2650`) and `settings.plugins.tab` (:2600). The client half's slot registration must be migrated accordingly (Stage 4 scope).

### R4.11 Open risks
1. Cross-namespace mutate: whether a plugin may `mutate` ANOTHER entry's namespace (`llm-pi-ai` from `model-settings`) — the settings package source should be checked for an ownership check during implementation; the 0.1.x autofill did this and 0.2.0-rc.2's `mutate` signature is unchanged, so low risk; e2e will confirm.
2. `modelFields` exact field names for per-model `efforts`/`contextWindow`/`input` (truncated in R4.5) — read `DSH/packages/llm/llm-pi-ai/src/config.ts:303-311` during implementation.
3. The install-time compatibility check may also inspect cordis/schemastery peer ranges (R4.9) — verify with the actual `dsh plugin add` error after the peer bump.
4. Client slot migration target (`settings.section` vs `settings.plugins.tab`) must match what the dsh web-app settings UI expects for a third-party plugin section — confirm by reading `ui-settings`/`ui-settings-models` client examples.

### R5 Root cause of the 0.2.0-rc.2 RPC-channel 405 (host bug)
- Symptom: e2e RPC lane red on 0.2.0-rc.2 — `POST /model-settings/<endpoint>` returns 405 with an empty body (frontend-static fallback), so the channel handler never runs. The 0.1.2-rc.1 workaround (`ctx.inject(['connection'], …)` deferral) no longer helps.
- Root cause (`.tmp/dsh-src-0.2.0-rc.2/…/packages/client/connection/src/rpc-host.ts`): `HostConnectionService.register()` (L171-195) does `owner.effect(() => owner.webServer.register(route))` where `owner` is the connection entry's OWN context. `webServer` is provided by the sibling `webserver` fiber, which is NOT in that fiber chain, so the Cordis 4.0.4 property proxy throws `cannot get property "webServer" without inject`; the effect fails and the channel prefix route never mounts. Invisible in logs because 0.2.0 `dsh web` registers no console logger exporter (in-memory only). No first-party 0.2.0 plugin uses `rpc.handle` (they use `connection.fetch.register`), so the path was never exercised.
- Proof: standalone Cordis 4.0.4 repro `.tmp/probe-cordis-repro.mjs` — `connCtx.webServer` THROWS, `connCtx.get('webServer')` resolves; live probe `.tmp/probe-3992.log`.
- Host-blessed pattern (the host's own `/api` route, `packages/client/connection/src/index.ts:124-159`): `ctx.inject(['webServer'], webCtx => { … webCtx.effect(() => webCtx.webServer.register(route), 'client-connection: /api route') })` — the nested inject makes `webCtx.webServer` resolvable inside the effect.
- **Plugin-side workaround (Stage 3):** replace the `conn.rpc.handle` block with a direct `webServer` prefix route registered through the nested-inject pattern, implementing the 0.2.0 RPC wire contract itself (from `rpcFetchHandler`, rpc-host.ts L222-268, and client `client/rpc.ts:36-71`): POST `/model-settings/<endpoint>`, `content-type: application/json`, body envelope `{type:'client-request', rpcId, method, payload}`; reject non-POST / unknown endpoint → 404, non-JSON media type → 415, bad JSON → 400, invalid envelope → `gateway/bad-request` with issues, `method ≠ endpoint` → `gateway/bad-request`; success → 200 `{type:'server-response', rpcId, result}` (rpcId echoed; result = plugin `RpcResult`). The installed 0.1.x cordis/dsh types declare no `webServer` property, so the plugin types it with a local structural interface (no `any`).
- **Upstream fix (out of scope, tracked in Stage-6 docs):** one line in `rpc-host.ts` — register the effect inside `owner.inject(['webServer'], …)`; the plugin-side workaround stands until it ships.

### R6 Fixture seeding: the `settings.yaml` seam is dead in 0.2.0
- Symptom: after the R5 workaround landed, the three warm RPC tests failed deterministically — the fixture's `warmModel`/`writeSettings` seeded models by writing `<DSH_HOME>/settings.yaml`, which 0.2.0-rc.2 never reads: it imports that file exactly ONCE at boot (`packages/settings/settings/src/index.ts:235` `importLegacyDocument`, :243-251 — one-way rename to `settings.yaml.imported`) and watches it never.
- The only runtime config seam in 0.2.0-rc.2: the HMR config watcher (`packages/boot/hmr/src/index.ts:215,235`) chokidar-watches exactly two files — `$DSH_HOME/profiles/<name>/cordis.patch.yml` and `$DSH_HOME/cordis.patch.yml`. Every settings write funnels through `ConfigEditor.edit` (`packages/boot/config-editor/src/index.ts:87-154`) into the profile patch document (`documentPath` = `profileContext.patchPath` = `$DSH_HOME/profiles/web/cordis.patch.yml`, `packages/app-boot/src/profile.ts:40,259`); the file watcher reconciles → `app-boot/config-reload` → revision bump → `settings/document-updated`.
- **Fixture fix (implemented):** `tests-helpers/e2e/dsh-fixture.ts` no longer touches `settings.yaml`. `warmModel`/`writeSettings` now upsert the `llm-pi-ai:` section into `$DSH_HOME/profiles/web/cordis.patch.yml` (dependency-free parse/replace/append of the top-level `- id: llm-pi-ai` entry; preserves header comments and foreign entries; drops the template `[]` marker). Polling unchanged (500 ms / 30 s on `listModels`); error text: `host did not commit the profile patch edit within 30s`.
- e2e: 5/6 green after the fix (boot 2/2; RPC cold ✓, saveModel ×2 ✓; autofill ✗ — R7).

### R7 Autofill persist rejected: `HMR transactions cannot be nested` (host limitation, plugin-side workaround)
- Symptom: the autofill test is deterministically red — `settings.mutate` inside the autofill round rejects with `Error: HMR transactions cannot be nested` (`@deepseek-ai/dsh-hmr` `lib/index.js:280` `runExclusive`; chain: dsh-settings `Proxy.mutate` :489 → dsh-hmr `runExclusive`).
- Root cause: the host emits `settings/document-updated` from INSIDE its open HMR transaction — the settings `write` callback calls `describe()` inside `configEditor.edit` (`settings/src/index.ts:367-423`, edit run via `await hmr.runExclusive(run)` at `config-editor/src/index.ts:152-153`; `describe()` emits at `settings/src/index.ts:317`). The plugin's event handler therefore runs inside the host transaction's async context, and its round's `settings.mutate` tries to open a second, nested transaction.
- **No deferral escapes it:** the nested check is `if (this.executing.getStore())` where `executing = new AsyncLocalStorage()` (`dsh-hmr lib/index.js:271,279-287`) — the AsyncLocalStorage store propagates into EVERY async continuation (microtask, `setImmediate`, `setTimeout`, `await`) scheduled from inside the transaction. Verified empirically twice: (a) a live DEBUG run with a `setImmediate`-deferred round — persist still rejected (`.tmp/diag-autofill-2/out.log`); (b) an ALS matrix scratch test (`.tmp/als-escape-test.mjs`) — only an `AsyncLocalStorage#exit` (or a timer created outside the transaction) yields a cleared store.
- **Workaround (implemented, e2e-green):** run the round under the host's own escape idiom — dsh-hmr uses `this.executing.exit(…)` internally (`lib/index.js:165`, watch-config). The plugin reads the handle via `ctx.inject(['hmr'], …)` (root-level base-bundle service, `packages/bundle/base/cordis.patch.yml:28`; a direct `ctx.hmr` read throws on Cordis 4.0.4 contexts) and does `executing.exit(() => autofill(…))`. `exit` runs the callback in the store-less outermost context AND forwards the callback's return value (verified: the round's promise rejection reaches the outer `.catch`, `.finally` clears the `running` flag). The round's `mutate` then opens its own top-level transaction, serialized on HMR's internal operations chain behind the host's in-flight one. The listener never throws into the host's unisolated `emit` (Cordis `emit` dispatches synchronously without error isolation; a missing service makes `inject` never settle instead of throwing).
- Consequence for the RPC `listReasoningRows` endpoint: schemastery materializes an absent model `input` as `[]`, so the projection now treats `[]` as absent (`input: undefined`) — the same semantics `isInputList`/autofill already use. Without this, the test's poll predicate (`row?.input !== undefined`) breaks on the rev=1 commit's materialized `[]` before the autofill fill lands.
- **Upstream ask (out of scope, Stage-6 docs):** the host should emit `settings/document-updated` AFTER the transaction settles (or expose a public defer/exit API on the hmr service).

### R8. Lockfile regen blocked: pnpm prerelease peer-range intersection (Stage 5, 2026-10-01)
- Symptom: plain root `pnpm install` after bumping ddgs' `@deepseek-ai/dsh-web` to `0.2.0-rc.2` fails deterministically: `ERR_PNPM_NO_MATCHING_VERSION — No matching version found for @deepseek-ai/dsh-timeout@>=0.1.1 <0.2.0-0` (log `.tmp/stage5-install-ndjson.log:759`; repro steps and bisect evidence in `.tmp/stage5-bisect/`).
- Root cause: the ddgs bump pulls `dsh-web@0.2.0-rc.2` → auto-peer `dsh-llm@0.2.0-rc.2` → `dsh-timeout@0.2.0-rc.2`. model-settings' four `^0.1.0-rc.7` devDeps (the 0.1.x types baseline kept intentionally in Stage 3) auto-materialize a 0.1.x peer closure where `dsh-timeout` is required by two ranges (`^0.1.1-rc.2` from the 0.1.1-rc.2 generation, `^0.1.0-rc.8` from the 0.1.0-rc.8 generation). pnpm merges required peers with `semver-range-intersect@0.3.1`, which drops the prerelease from the lower bound: `^0.1.1-rc.2 ∩ ^0.1.0-rc.8` → `>=0.1.1 <0.2.0-0` (demonstrated empirically, `.tmp/sri-test/`) — unsatisfiable because the registry carries only prerelease 0.1.x/0.2.0 versions (29 dsh versions, `.tmp/verdaccio-scan/`).
- HEAD installs green because the same peers are satisfied by the committed pinned `dsh-timeout@0.1.1-rc.2` lockfile node; the failure appears only when the 0.2.0 closure is added alongside the 0.1.x closure.
- Second latent unsatisfiable range: `@deepseek-ai/dsh-client-runtime@^0.2.0-rc.2` (model-settings peer since 9cb566f; lockfile never regenerated) — masked in the full graph by the same-named direct devDep; fails when absent (bisect case 2, `.tmp/stage5-bisect/`).
- The natural fix belongs upstream (regen the plugin's peers + lockfile together, or publish a stable 0.1.x line) — both out of Stage-5 sanctioned scope.

### R9. Decision: unify model-settings' types baseline on 0.2.0-rc.2 (Stage 5, 2026-10-01)
- The lockfile cannot be regenerated while the 0.1.x closure coexists with a 0.2.0 closure (R8), and the whole task drops 0.1.1 support — so the types-only devDeps baseline moves to `^0.2.0-rc.2` alongside the peers (Stage 3's "keep 0.1.x types" stopgap becomes moot).
- 0.2.0 type deltas that force source edits (verified against the `.tmp/dsh-src-0.2.0-rc.2/` source):
  - `@deepseek-ai/dsh-settings@0.2.0-rc.2` has NO `SettingsProvider` class and NO `settingsNamespace()` helper — the 0.1.x runtime imports in `src/index.ts:12` and `tests/unit/server/composition.test.ts` break. Available exports: `SettingsNamespace` (Branded), `SettingsPathOp`, `SettingsConflictError`, `SettingsDescriptor` (`ns`/`value`/`revision` + schema/meta fields). Context augmentation: `settings: SettingsForms` (a `Service` class; sync `describe(options?): SettingsDescriptor[]`; `mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>` — the ns is a plain `string` parameter).
  - Host fix: a local structural seam for `makeLlmStore` (same pattern as the existing `WebServerRegistry`/`HmrFacade` mirrors), importing the real `SettingsPathOp` type; the `LLM_NS` branded cast is kept (its comment updates).
  - Test fix: the 0.2.0 dsh idiom for fake services is `ctx.provide('settings', { describe: …, mutate: … } as never)` on a plain `new Context()` (cf. `packages/api/session-controller/tests/session-models.host.spec.ts:353`, `packages/experimental/inspector/tests/plugin.host.spec.ts:27`); the repo already uses `as never` for fake services.
  - Client fixes: `ClientContext` is no longer exported from `@deepseek-ai/dsh-client-runtime/client` — the 0.2.0 idiom is cordis `Context` itself (dsh's own client code uses `import type { Context as ClientContext } from '@deepseek-ai/cordis'`; the repo style bans import aliases, so annotate with `Context` directly). `SnapshotStore` is now a generic `SnapshotStore<T>` exported from `@deepseek-ai/dsh-client-store` (not from runtime/client); `createSnapshotStore` is there too. `ConnectionHandle` (dsh-client-connection/client) and `InjectFace` (dsh-client-ui-slots) still exist in 0.2.0.
  - The local `SlotMap` augmentation in `slot-contract.ts` stays valid: the 0.2.0 `@deepseek-ai/dsh-client-ui-slots` ships an EMPTY `SlotMap` (`packages/client/ui-slots/src/index.ts:26`); `settings.section` is declared in the separate `ui-settings` package we do not import.
- Consequence: ONE plain `pnpm install` (sanctioned exception to frozen installs) regenerates the lockfile on a single 0.2.0 closure (no 0.1.x `@deepseek-ai/dsh-*` nodes left) and clears both latent ranges from R8.
- Rename fact (Stage 5, implemented): `@deepseek-ai/dsh-client-runtime` does not exist in 0.2.0 — the package was renamed to `@deepseek-ai/dsh-client-modules` (same `./client` subpath). model-settings' `dsh.client.inject` list, `peerDependencies`, and `devDependencies` all moved to the new name; this also obsoletes R8's second latent range (`dsh-client-runtime@^0.2.0-rc.2` no longer has a name in 0.2.0).
- 0.2.0 client typing fact (Stage 5, implemented): `ctx.slots` is typed through `dsh-client-ui-renderer`'s Context augmentation (renderer-owned); a bundle that does not import ui-renderer needs a local structural mirror (`SlotRegistryFace` + `SlotInjectionEffect`) to typecheck slot registration — same mirror pattern as the host `WebServerRegistry`/`HmrFacade`.
