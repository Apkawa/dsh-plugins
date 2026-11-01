# Research — 2026-10-31_dsh-0.2.1-rc.5-plugins

## R1 — dsh checkout, upgrade guides, plugin API changes (agent run, 2026-10-31)

**Checkout facts**
- `dsh/` → `/home/apkawa/source/deepseek-harness`, git HEAD = tag `dsh-v0.2.1-rc.5`. Root `package.json`: `@deepseek-ai/dsh-root` 0.2.1-rc.5 (private workspace); published entry package is **`@deepseek-ai/dsh`** (`apps/cli`), libraries `@deepseek-ai/dsh-<name>` all at 0.2.1-rc.5. npm scope `@deepseek-ai` (not `@deepseek-harness`).
- No CHANGELOG/patchnotes files in the checkout. Release-note mechanism = upgrade guides: `dsh/docs/upgrade-guide/<version>/<slug>/guide.md` (+ `.zh.md`, `.i18n.yaml`). No guide dir for rc.5; latest entry dir is `v0.2.1-rc.4`.
- rc.4→rc.5 range = 4 commits: release bump + `fix(web): customize thinking block rendering (#7484)`. The externally visible API change: `conversation.chat.reasoning.body` contributions get new `rawText` field (`text` becomes prepared display text). Guide lives under `v0.2.1-rc.4/reasoning-body-props/guide.md` but code shipped in rc.5 (`packages/client/ui-chat/src/client/contract/slots.ts:81`).

**Plugin-relevant changes accumulated 0.2.0-rc.2 → 0.2.1-rc.5** (the matrix jump)
- `plugin-engines-dsh` (v0.2.1-alpha.3): compatibility judged by own `engines.dsh` range alone when present; `peerDependencies` on `@deepseek-ai/dsh*` ignored; peers rule only when `engines.dsh` absent. Non-object `engines` / non-string `engines.dsh` → manifest unreadable → package refused. `peers` renamed to `requirements` in `IncompatiblePlugin`/`PluginCompatibility`.
- `plugin-install-over-installed` (v0.2.1-alpha.2): under HMR, `pluginManager.installBundle(spec)` over an installed package fails (`application: 'failed'`, `error.code: 'already-installed'`); must `removeBundle(name)` first. `ManagementError['code']` gained `already-installed`.
- `subpath-plugin-display-manifest` (dir v0.2.0-rc.2, targets rc.5-era): subpath plugins no longer read `<subpath>/package.json`; title/description from `<subpath>/locale/*.json` (`meta.title`/`meta.description`), image from `<subpath>/icon` export. Our packages use root `"dsh"` block (`bundle.patch` + `client.inject/platform`) — unaffected.
- `plugin-option-placement` (alpha.1): `dsh plugin` reads `--profile` only before forwarded pnpm args; own `--help`.
- `experimental-package-composition` (alpha.1): explicit install + peer deps + config for optional experimental packages.
- `remove-runtime-invariants` (v0.2.0-rc.2): runtime invariant registry package and `./invariant` subpaths removed.
- `web-listener-trust-config` (alpha.1): `webRuntime` → `webStartup`.

**Host RPC channel (our known workaround area)**
- `packages/client/connection/src/rpc-host.ts` changed heavily rc.2→rc.5 (+127 lines; `operator-peer.ts` removed, `peer.ts` added). Registration now uses `this.owner.get('webServer')?.` (lines 132/165/194) while route registration still does `owner.webServer.register(route)` (line 274). Whether the "context without webServer" failure is fixed in rc.5 is NOT documented — needs empirical probe. Our workaround: model-settings mounts own `/model-settings` prefix route on host `webServer` via nested `ctx.inject(['webServer'], …)`.

**Plugin seams in dsh (rc.5)**
- Cordis core (vendored): `vendor/cordis/src/registry.ts` (`Plugin` union, `Plugin.Base`, `ctx.plugin`/`ctx.inject`), `vendor/cordis/src/context.ts` (`Context.extend/isolate/intercept/get/set/provide/accessor/mixin`); docs `dsh/docs/cordis-api/context.md`, `events.md`, tutorials `dsh/docs/cordis-tutorial/`.
- `packages/boot/plugin-manager/src/` — `IncompatiblePlugin`, `ManagementError`, `PluginInfo`, `BundleInfo`, `InstallBundleOptions`, `parseInstallSpec`, tools `install_bundle`/`remove_bundle`.
- `packages/boot/app-boot/src/plugin-compatibility.ts` — `PluginCompatibility`, `evaluatePluginCompatibility`, `getDshRuntimeVersion`, `pluginCompatibilityWarning`; `package-meta.ts` — `readPluginMeta`; `profile-plugins.ts`; `index.ts:1153` — `auditStartupEntries` (startup activation audit; our boot-smoke `readOutput()` assertion rides on it).
- `packages/boot/plugin-market/` — NEW package rc.2→rc.5 (`src/index.ts`, marketplace search/install).
- `packages/boot/hmr/src/` — `package-manifest.ts`, `module-files.ts` (new), `index.ts` (+719 lines rc.2→rc.5).
- `packages/host/plugin-inventory/src/types.ts` — `PluginInventoryEntry`, `PluginEntryId`.
- `packages/extensions/` — `cordis-host-runner`, `cordis-client-runner`, `tool-cordis`, `ui-cordis`.

**Ready-URL contract** — unchanged on rc.5: tokenized `/?token=…` + 303 cookie exchange; our `READY_LINE` + `exchangeSession` in `tests-helpers/e2e/dsh.ts` hold.

**Dep/packaging facts (repo)**
- Our plugin packages declare `engines: { node: ">=24.0.0" }` (object, no `dsh` key) → readable manifest, peer rule applies. Catalog peers `^0.2.0-rc.2` (`pnpm-workspace.yaml:6-9`) semver-satisfy 0.2.1-rc.5.
- Caveat: exact-pinned deps drag 0.2.0-rc.2 copies into an rc.5 profile: `@deepseek-ai/dsh-home-paths: "0.2.0-rc.2"` (deps of dsh-attach-editor, dsh-global-queue), `@deepseek-ai/dsh-web: "0.2.0-rc.2"` (devDeps of dsh-web-search-ddgs). `catalog:` peers resolve only inside a pnpm workspace; the throwaway provisioned project under `.tmp/dsh-versions/<version>` (install `@deepseek-ai/dsh@<version>` + `dsh plugin --profile web add <localdir>`) is the real compatibility surface.
- Fresh homes per launch avoid the alpha.2 `already-installed` refusal; re-add into a kept home (`--keep`/`E2E_KEEP=1`) now fails → removal-first pattern is the documented migration.

## R2 — repo e2e infrastructure (agent run, 2026-10-31)

**Matrix entry point**
- `tests-helpers/e2e/dsh.ts:29` — `E2E_DSH_VERSIONS = ['0.2.0-rc.2']`; a version enters the matrix here; provisioning auto (`ensureDshVersion`, :91-114) under `.tmp/dsh-versions/<version>` (throwaway pnpm project, per-version lock, 180 s timeout; only exempt path from frozen-lockfile rule).
- Hardcoded `0.2.0-rc.2` defaults that do NOT follow the matrix: `dsh.ts:55` (launchDsh default), `dsh.ts:82` (resolveDshBinary default), `scripts/e2e-live.ts:88` (CLI default). `tests-helpers/e2e/live.ts` forwards version only when given (:13).
- `READY_LINE` (:27) + `exchangeSession` (:202-214, 303 + set-cookie) — contract unchanged on rc.5 (per R1).
- `E2E_KEEP=1` keeps temp home (:71); CLI `--keep` sets it. Fresh homes per launch.

**Version-matrixed suites**
- Boot smoke (vitest `describe.each`): model-settings `tests/e2e/server/boot.test.ts:12`, global-queue :12, **dsh-ghl :12** (a 5th plugin package exists, root AGENTS.md "Projects" list omits it; its package AGENTS.md "E2E: none yet (scaffold)" is stale), web-search-ddgs :11, attach-editor :14 (extra: `readOutput()` must not contain `did not activate`/`startup failed`).
- RPC lanes (vitest `describe.each`): model-settings `server/model-settings.test.ts:13` (listModels/saveModel/round-trips/autofill via local JSON fixture + `warmModel`), global-queue `server/rpc.test.ts:45` + `server/preset.test.ts:91` (session rows read from file storage in temp home), ghl `server/rpc.test.ts:20` (git init in temp home; error codes no-remote/internal).
- Playwright acceptance (no describe.each → `for…of E2E_DSH_VERSIONS` loops): global-queue `tests/e2e/acceptance.spec.ts:117`, ghl :52, attach-editor `tests/e2e/ui/acceptance.spec.ts:79`. **Exception**: model-settings `tests/e2e/acceptance.spec.ts:13` uses `E2E_DSH_VERSIONS[0]` — single version only, no loop.
- Not matrixed: web-search-ddgs `live-search.test.ts`/`backends.test.ts` (no dsh boot; uv-gated), image-editor e2e (no dsh).

**Version-conditional logic lives in plugin source (no test branches)**
- RPC workaround (host `rpc-host` register effect lacks `webServer` on 0.2.0-rc.2): nested `ctx.inject(['webServer'], …)` mounting own prefix route — model-settings `src/index.ts:308-321` (+ wire contract mirror :325-329, structural mirrors of `Context.webServer` :58-65 and `hmr` :70-98), global-queue `src/index.ts:260-266` + `src/rpc.ts:40-46`, ghl `src/index.ts:50-59` + `src/rpc.ts:55-61`. Fix status in rc.5 unprobed (R1).
- Settings seeding shape: `tests-helpers/e2e/dsh-fixture.ts:126-133` — dsh 0.2.0 imports `settings.yaml` once at boot (renames `.imported`, never watches), so fixtures write watched `.dsh/profiles/web/cordis.patch.yml`; `warmModel` (:86-106) polls plugin RPC with dead-baseURL local endpoint.
- RPC helper `dsh-fixture.ts:58-71` — `client-request` envelope → `envelope.result`; cookie attached (:74-77).

**Configs / scripts**
- vitest e2e configs: alias `@root/tests-helpers/*`; hookTimeout 180 s everywhere; test timeout 120 s — inconsistency: model-settings/ghl use `testTimeout` key, attach-editor/global-queue/web-search-ddgs use `timeout` (vitest ^4.1.8 catalog). No sharding.
- playwright configs (4 packages): workers 1, fullyParallel false, retries 1, timeout 30 s, expect 10 s, outputDir `.tmp/playwright/<package>`, chromium headless; per-file `test.setTimeout` overrides (180 s model-settings, 60 s others).
- ghl has `test:e2e` (vitest only) but no `e2e:live` despite playwright lane. image-editor `test:e2e` = playwright (pretest build), no dsh version.

**Compat gates outside matrix**
- Catalog peers `^0.2.0-rc.2` (`pnpm-workspace.yaml:6-9`) satisfy 0.2.1-rc.5 semver; exact-pinned deps drag old copies: `@deepseek-ai/dsh-home-paths: "0.2.0-rc.2"` (attach-editor, global-queue deps), `@deepseek-ai/dsh-web: "0.2.0-rc.2"` (web-search-ddgs devDeps).
- Docs: root `AGENTS.md:25-34` E2E paragraph; `CONTRIBUTING.md:20-41` lanes/binary chain ("0.2.0-rc.2 is the validated e2e baseline" :41); archived specs `.dumbspec/archive/e2e_version_matrix`, `shared_e2e_infra`, `2026-09-30_e2e-matrix-0-2-0` (peer-range rationale: `dsh plugin add` rejects plugins whose peers don't cover the runtime).

## R3 — version-sensitive inventory of our plugin packages (agent run, 2026-10-31)

**Compatibility gate reality (both versions)**
- Gate exists in rc.2 too (nested app-boot lib `evaluatePluginCompatibility`, peers-only, `semver.satisfies(runtime, range, {includePrerelease:true})`) and rc.5 (`dsh/packages/boot/app-boot/src/plugin-compatibility.ts:51-117`; `engines.dsh` alone decides when present; peers filtered to `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*`).
- `"catalog:"` peer ranges are NOT expanded in installed/link'd manifests (profile copies keep the literal string). `semver.satisfies("catalog:", …)` = false. Live proof: `~/.dsh/profiles/web/node_modules/@apkawa/dsh-ghl/package.json` peers literally `catalog:`; startup log `~/.dsh/logs/startup-…:10` `dsh: startup failed: 2 required plugins did not activate`; no compatibility.json exemptions.
- Verified semver: `^0.2.0-rc.2` satisfies `0.2.1-rc.5` with includePrerelease:true. Remedy options: concrete peer ranges (fixes both versions), `engines.dsh` (rc.5-only), `dsh plugin --profile web allow-version … --accept-risk`.
- Denied rows are skipped by the activation audit (`index.ts:1047`) → boot tests asserting absence of "did not activate" stay green while plugin silently absent (deny stderr: `disabling profile plugin …`).

**Manifests**
- model-settings: peers all `catalog:` (cordis, dsh-client-connection, dsh-client-modules, dsh-client-ui-slots, dsh-settings, schemastery, react); imports undeclared `@deepseek-ai/dsh-client-store` (host module table supplies it). ghl: peers `catalog:` incl. dsh-client-*/dsh-settings. global-queue/attach-editor: dep exact pin `@deepseek-ai/dsh-home-paths: 0.2.0-rc.2`; peers cordis+schemastery catalog:. web-search-ddgs: devDep exact pin `@deepseek-ai/dsh-web 0.2.0-rc.2`. No package has `engines.dsh`. image-editor: no dsh deps.
- Repo install resolves all `@deepseek-ai/dsh-*` to 0.2.0-rc.2; rc.5 vendors cordis 4.0.5 (catalog `^4.0.1` admits).

**Host seams vs rc.5**
- All consumed services exist in rc.5: webServer (`host/webserver/src/index.ts:366 register(route)`), hmr (`boot/hmr/src/index.ts:308`; `executing` private in rc.5 types but runtime field present), agents/sessions/sessionPersistence/sessionProjections/workspaceRegistry/agentDefaultModel/agentPresets, conversation, workspaces.
- rc.5 `rpc-host` registers via owner context `owner.webServer.register(route)` (`api/rpc-host/src/index.ts:259-276`) — rc.2 "context without webServer" bug likely fixed upstream; our own prefix routes valid either way (probe double-mount).
- Error codes: our bare `'internal'` (model-settings index.ts:331,413; ghl pins `internal`) vs rc.5 convention `gateway/internal` (`api/rpc/src/rpc.ts:56-62`); schema accepts any string code.
- web-search-ddgs seam intact (`ctx.web.registerSearchProvider`, web/src/index.ts:105); behavior delta rc.2→rc.5: provider id resolved per call (hot-switchable), `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` error path added.

**Client seams vs rc.5**
- All imported symbols/subpaths exist in rc.5 (dsh-client-store createSnapshotStore; slots register/inject API incl. priority rules; ui-primitives; settings mutate/describe; home-paths resolveDshHome; web types).
- Removed: slot `settings.plugin.item` → replaced by `settings.plugins.tab` (ui-settings-plugins client/index.ts:76-83). Our mirror `packages/dsh-model-settings/src/client/slot-contract.ts:13` is stale; dead code today (`CLIENT_ENABLED=false`).
- attach-editor shadow `conversation.input.attachments` priority -1 vs rc.5 shipped occupant priority 0, seat `kind:'single'` scope `session-maybe` (`ui-chat/src/client/contract/slots.ts:286`) — lower priority wins, renders alone; same-priority collision throws. Probe composer render.
- Module loader sink compatible (`client/modules/src/index.ts:563-568`); rc.5 platform module table = 10 names (`client/web/src/platform.ts:8-16`), our externals subset present.
- `dsh.client.inject` entry `@deepseek-ai/dsh-client-ui-slots` has no ./client export in both versions — inert no-op.
- reasoning.body (`rawText`/prepared `text`, rc.5): zero references in our plugins — untouched.

**Install/activation flow rc.5**
- `dsh plugin --profile web add <dir>`: preflight path-spec manifest → post-install gate → on incompatibility restore package.json+lockfile + `pnpm install --frozen-lockfile` repair, exit 1, stderr `dsh: installation rejected: …` + hint `allow-version … --accept-risk` (plugin-manager/src/operations.ts:480-535; apps/cli/src/plugin.ts:99-100).
- Ready-line + token→cookie 303 exchange identical on rc.5 (`bundle/web-app/src/index.ts:231`, `browser-auth.ts:279,291`) — helper contract holds.

**RISK LIST (empirical probes needed on rc.5)**
1. `catalog:` peers → add rejected / boot rows disabled (model-settings, ghl; possibly all packages if rc.2 gate checks all peers) → fix manifests to concrete ranges.
2. Silent denial passes boot assertions → probe UI surfaces + stderr, not only audit strings.
3. Stale `settings.plugin.item` mirror (dead code; retarget if enabling v1 card).
4. Attachment seat shadow priority on rc.5 single seat.
5. Native rpc-host vs our prefix-route workaround — double-mount check on rc.5.
6. Bare `internal` vs `gateway/internal` client routing.
7. Client bundle boot + HMR reload on rc.5 module table.
8. warmModel revision-bump wait on rc.5 HMR config-reload (fixture ≤30 s).
9. `pluginListed` stdout format on rc.5 (row present-but-disabled).
10. Exact pin `dsh-home-paths 0.2.0-rc.2` duplicate module instance beside rc.5 runtime.
11. Event-shape parity (turn/end reasons, agent/status) — live probe.
12. searchProvider per-call resolution + new unavailable error path.

## P1 — empirical probe: rc.5 provisioning + gate (Stage 1 run, 2026-10-31)

**Provisioning** — `.tmp/dsh-versions/0.2.1-rc.5` provisioned during the first boot run (`node_modules/.bin/dsh` reports 0.2.1-rc.5); no manual steps needed.

**Boot lane (attach-editor, describe.each)** — GREEN on both versions: 6/6 passed (26 s). `plugin add` exit 0 (fresh homes), `plugin ls` row present, no disabled marker; boot stderr never contained `disabling profile plugin` / `did not activate` / `startup failed` / `installation rejected` on either version. Activation evidence: 303 token exchange, GET / 200, served HTML references `@apkawa/dsh-attach-editor` + `.../client.js`.

**Gate truth (corrects R3 risk 1)** — rc.5 `dsh-app-boot` `unmetRequirements` (`lib/index.js:276-299`): peer deps are compatibility-checked ONLY for names `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`. Therefore packages whose dsh-peer set is empty (attach-editor, global-queue: cordis+schemastery `catalog:` only) are never semver-checked → `catalog:` peers are inert for them; the invalid-semver rejection path is unreachable. Consequence: the `catalog:` gate risk applies specifically to packages with `@deepseek-ai/dsh-*` peers = **model-settings, ghl** (need their own empirical probe before manifest fix).
- Live-home rc.2 evidence (R3) `startup failed: 2 required plugins did not activate` is consistent with model-settings + ghl being gate-denied on dsh-* peers.

**Latent** — `@deepseek-ai/dsh-home-paths@0.2.0-rc.2` is a plain dependency (never gate-checked); profile resolves it from repo install even under rc.5 runtime. Works today; widen pin to `^0.2.0-rc.2` anyway.

**Playwright acceptance drift (harness, not plugin)** — attach-editor acceptance: 3 passed (rc.2) / 3 failed (rc.5), identical error `the workspace chooser never became clickable`. rc.5 onboarding dialog is named `Get started` with buttons `Add API Key` / `Sign in`; spec dismisses rc.2 names (`Add an API key to get started` → `Configure later`). Version-agnostic dismiss (whichever dialog appears) + zenity workspace connect → identical plugin surfaces on both versions: guide entry attach-editor=1, tab `Annotate image`=1, pane=1, composer card + file input=1 (editor canvas idle on both). Fix belongs in acceptance specs (all packages that dismiss first-run dialogs). Probe scripts/logs: `.tmp/probe-rc5-boot.log`, `.tmp/probe-rc5-gate`, `.tmp/probe-rc5-acceptance.log`, `.tmp/probe-rc5-ui3.mjs`.

## P2 — red baseline: gate denies model-settings + ghl on BOTH versions (Stage 2 probe, 2026-10-31)

- All four lanes (model-settings boot/RPC, ghl boot/RPC) die in `beforeAll`: `dsh plugin --profile web add` exit 1, stderr `dsh: installation rejected: Plugin … is incompatible with dsh <ver>: requirements {"@deepseek-ai/dsh-client-*":"catalog:","@deepseek-ai/dsh-settings":"catalog:"}` (rc.5 wording `requirements`, rc.2 wording `peerDependencies`); `dsh: nothing was installed`; `plugin ls` row absent.
- Gate semantics (provisioned installs): peers named `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` checked with `semver.satisfies(runtime, range, {includePrerelease:true})`; `workspace:^|~|*` map to runtime version; `catalog:` → false → unmet.
- Activity proof (temp-home `allow-version` exemption only): both plugins install, boot clean, RPC answers on both versions — `POST /model-settings/listModels` → 200 `{"result":{"ok":true,"value":[]}}`; `POST /ghl/detectRepo` → 200 `{"ok":false,"error":{"code":"no-workspace",…}}`. Runtime behavior compatible; only manifests are the problem.
- Startup-denial mode (installed + revoked exemption): stderr `dsh: skipping profile bundle "<pkg>": Error: Plugin … is incompatible …` (NOT `disabling profile plugin …`); RPC then 405 empty body.
- Failure mode in our lanes = install-rejected. Green path: concrete peer ranges (`^0.2.0-rc.2` etc. matching catalog values) in peerDependencies. Recording: `.tmp/probe-red-baseline.md`, `.tmp/probe-gate.log`, `.tmp/probe-activity.mjs`, `.tmp/probe-disable.mjs`, lane logs.

## P3 — RPC channel probe rc.5 vs rc.2 (Stage 3 run, 2026-10-31)

- rc.5 RPC host lives in `@deepseek-ai/dsh-client-connection` (`packages/client/connection/src/rpc-host.ts`) — no `api/rpc-host` package at rc.5. Plugin-channel registration `owner.effect(() => owner.webServer.register(route))` with `owner = this.ctx` (:104-112, :253-277) still throws `cannot get property "webServer" without inject` — **the host bug persists on rc.5** (identical code in published libs: rc.5 :871, rc.2 :656; cordis 4.0.4→4.0.5 changed nothing). Upstream ask unchanged.
- **No conflict**: our own prefix routes (`/model-settings`, `/global-queue`, `/ghl`) mount cleanly alongside native `/api`, `/connect`, `/plugins`, SPA fallback — `webserver: duplicate route` never fires on either version; startup stderr clean.
- rc.5 native surface: `/api` carrier functional (gateway dispatch reaches `gateway/internal`), `/connect` new on rc.5 (401 unauthenticated; absent on rc.2); `/rpc/...` does not exist (405/404); plugin channels via `/api/<channel>/...` → 404.
- Wire contract facts (both versions): plugin-local unknown endpoint → `{"ok":false,"error":{"code":"internal",…}}` (NOT `gateway/internal`); envelope must have `method` equal to endpoint else `gateway/bad-request`; channel pattern `/^\/[A-Za-z0-9._~-]+$/`, `/api` reserved.
- **Verdict: no code adaptation required.** Workaround stays; boot/RPC lanes green on both versions. Evidence: `.tmp/rpc-probe/` (report*.json, startup logs, cleanup-list.txt).

## P4 — Acceptance lanes red baseline + fixes (Stage 4 run, 2026-11-01)

- Full playwright sweep before Stage 4 fixes: rc.5 fails in ALL four packages — first-run dialog renamed: rc.2 `Add an API key to get started` (dismiss `Configure later`) vs rc.5 `Get started` (buttons `Add API Key`/`Sign in`, dismiss `Close`); the undismissed modal masks the workspace chooser (`the workspace chooser never became clickable`, mask intercepts pointer events).
- rc.5 nav drift: sidebar exposes `Plugins`/`Automation tasks`/`More`, NO `Settings` button; settings reachable via `Account menu` popover → menuitem `Settings` → unnamed settings dialog with nav buttons `General`/`Models`/`Model settings`/`Built-in plugins`/`Agent presets`/`Close`. URL routes `/settings`, `/plugins` serve empty bodies. Plugin renders no testids; its section evidence is the empty-state text `No OpenAI-compatible routes configured.` rc.2 cross-check: sidebar `Settings` button exists; same `Model settings` nav button shape.
- Version-independent product gaps (red on rc.2 too, pre-existing): global-queue — carried-row drag never dimmed/reordered (self-drop skipped, dim applied to wrong row); Edit/dblclick edit affordance never rendered because the file-seeded fixture row was adopted by the watcher on an unrelated `agent/status` wake and flipped to `interrupted` before the pane fetched. ghl — `IssuePane` checked `error !== null` before `repo === null`, so failed detection (RPC failure envelope, store keeps `repo = null`) rendered `ghl-error` instead of `ghl-missing-repo`.
- Fixes: specs dismiss `Get started` via `Close` alongside rc.2 dialog (all four specs); model-settings `openSettings()` helper (sidebar button if present, else account-menu popover path); global-queue drop maps carried-item index without self-drop special-case, `.shifted` rows opacity 0.4, store `intake` set gates watcher to this-instance items (foreign file writes run after restart — README documents trade-off); ghl pane checks `repo === null` first. All four lanes green on both versions (attach-editor 6/6, model-settings 2/2, global-queue 44/44, ghl 2/2).

## S6 — Final full green sweep + ddgs throttle stabilization (Stage 6 run, 2026-11-01)

- Full sweep after rebuilding all five packages: every dsh-matrix lane green on BOTH `0.2.0-rc.2` and `0.2.1-rc.5` — model-settings boot 2×2 + RPC 8 + acceptance 1×2; attach-editor boot 3 + acceptance 3; global-queue boot/rpc/preset 20 + playwright acceptance 22 (~10.7 min); ghl boot+rpc 12 + acceptance 2; web-search-ddgs boot matrix 4 + live-search 2 + backends 3. No gate markers (`installation rejected`, `skipping profile bundle`, `did not activate`, `startup failed`, `exited early`) anywhere. Logs: `.tmp/e2e-sweep/`.
- Residual (version-independent): ddgs live lanes hit DDG-side intermittent empty results — `ddgs exited with code 1: DDGSException: No results found.` Probes: duckduckgo throttles in runs of 5-12 consecutive failed attempts, lift after tens of seconds; bing fails as isolated attempts; yandex clean. Concurrent lane runs (parallel vitest files) double the DDG load — sequential runs are calmer.
- Fix (test lanes only, product code untouched): retry the same search — duckduckgo 12 attempts / 5 s backoff, bing+yandex 4 attempts / 2 s backoff; only the `No results found` signature retries, timeouts/malformed output surface immediately; assertion strength unchanged. Re-runs green (live-search 2/2, backends 3/3, boot 4/4). Commit `c1a6212`.
