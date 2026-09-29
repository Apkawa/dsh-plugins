# fix_0.1.2-rc1 — research findings

Context collection for: dsh 0.1.2-rc.1 fails to import loader entry for
`@apkawa/dsh-model-settings` —
`require("@deepseek-ai/dsh-client-runtime/client") missed the module table`
(not a platform seed word, not a materialized module, no registered package
factory). Workaround: remove broken plugin entries from
`~/.dsh/profiles/web/package.json` (or delete `~/.dsh/profiles/web/`).

Findings are appended as discovered (English, internal artifact).

## 1. Error origin (dsh)

dsh checkout: HEAD detached at tag `dsh-v0.1.2-rc.1` (commit `a66e470204` "release(dsh): 0.1.2-rc.1"), clean tree.

The user-visible message is two wrapped layers:

1. **Outer wrapper** — `dsh/vendor/loader/src/config/entry.ts:24-27`, `updateError(stage, options, cause)`:
   ```ts
   return new Error(`failed to ${stage} loader entry ${options.id} (${options.name}): ${detail}`, { cause })
   ```
   Called with `stage: 'import'` from `Entry._init()` (line 282, after `this.parent.tree.import(this.options.name, ...)` rejects) and from `Entry.update()` (line 220, on a `name`-change re-import). `options.id` is the random loader entry id (`65fa33dc`); `options.name` is the package specifier (`@apkawa/dsh-model-settings`).

2. **Inner throw** — `dsh/packages/client/modules/src/client/system.ts:208-211`, inside the closure returned by `ClientModuleSystem.makeRequire()` (lines 200-213). The synchronous `require` handed to plugin factories resolves in exactly three branches:
   ```ts
   if (this.seed.has(spec)) return this.seed.get(spec)              // platform seed word
   const id = stripClientSuffix(spec)
   const record = this.loadCache.get(id)                            // materialized module
   if (record !== undefined) return record.exports
   if (this.factories.has(id)) return this.materialize(id).exports // registered package factory
   throw new Error(`client-modules: require("${spec}") missed the module table — ...`)
   ```
   - **"module table"** = the `ClientModuleSystem` state: `seed` (Map, built at line 84 from `options.staticModules`), `loadCache` (materialized `ClientModuleRecord`s), `factories` (registered bundle factories).
   - **Platform seed word** = a key of the `seed` map, i.e. the `PLATFORM_MODULES` list in `dsh/packages/client/web/src/platform.ts:8-13`:
     `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`. `PRELOADED_CLIENT_EXTERNALS` (lines 16-17) is empty in 0.1.2-rc.1.
   - **Materialized module** = an id present in `loadCache`: the bootstrap module (constructor, system.ts:92-99) plus any graph row whose factory has run (`materialize()`, lines 173-192).
   - **Registered package factory** = an id in the `factories` map, added by `register()` (lines 114-120) when a dynamic bundle executes `window.__ModuleLoader__.load({id, factory})`. Rows are fetched on demand by `arriveGraphRow()`/`arrive()` (lines 123-170) over the boot graph (`graphRows`, parsed from `window.__DSH_BOOT__` by `parseBootManifest` in `dsh/packages/client/modules/src/client/manifest.ts:167-256`).
   - `stripClientSuffix` (manifest.ts:156-158) strips a trailing `/client` so `require("X/client")` resolves against graph row id `X`.

   The system is constructed by `createClientModuleSystem()` in `dsh/packages/client/modules/src/client/index.ts:38-51` (`staticModules: options.staticModules`), and cordis reaches it via the internal contract: the vendored Loader's `EntryTree.import` → `internal.import` (manifest.ts header, lines 1-30).

**Why the plugin's require fails on 0.1.2-rc.1**: the plugin's client bundle requires `@deepseek-ai/dsh-client-runtime/client`. In 0.1.2-rc.1 that specifier is (a) not a `PLATFORM_MODULES` seed word (the closest seed is the new `@deepseek-ai/dsh-client-store`), and (b) can only be answered by a dynamic graph row if some manifest declares it as a `dsh.client.external` request that the host composes into the boot graph. The dsh repo in 0.1.2-rc.1 contains no `@deepseek-ai/dsh-client-runtime` package at all (the package was removed — see §2), so no supplier row exists → all three branches miss → throw.

## 2. Version delta (dsh 0.1.1-rc.2 → 0.1.2-rc.1)

Checkout is at tag `dsh-v0.1.2-rc.1` (`a66e470204`); `dsh-v0.1.1-rc.2` is available as a git tag.

**The `@deepseek-ai/dsh-client-runtime` package was removed.** In 0.1.1-rc.2 it lived at `packages/client/runtime` with a `./client` export (`src/client/index.ts`: SlotRegistry, SessionRuntime, ConversationEventRegistry, …; `createSnapshotStore` in `src/client/contract/store.ts`). Its `dsh.client` manifest was `platform: 'web'`, `"immediately": true`, inject: `dsh-client-connection`, `dsh-typert-registry`, `dsh-api-remotes`.

Key commits between the tags:

- `1b535f611c` "refactor(client): extract Store and renderer Slot infrastructure" — adds `packages/client/store`, package `@deepseek-ai/dsh-client-store` ("React-free observable and snapshot-store contracts with the shared Zustand/Immer engine"; exports `createSnapshotStore` at `src/index.ts:103`, `defineStore` at 217; deps immer/zustand).
- `be531688f3` "refactor(client): migrate consumers and remove Runtime" — deletes `packages/client/runtime` entirely (incl. `src/client/index.ts`).
- `5549b9add5` "fix(client): preload injected module factories", `5bbaf168d9` "perf(client-modules): batch startup plugin scripts", `83463aa896` "feat(client): use bounded plugin combo URLs", `47bf44a5bb` "fix(client-modules,webserver,webworker-runtime): preserve batched boot across transports", `dc92793f10` "fix(client): align domain split with repository gates".

File-level deltas that matter for module resolution:

- `packages/client/web/src/platform.ts` (the whole diff):
  - `PLATFORM_MODULES` **gains** `'@deepseek-ai/dsh-client-store'` (8 seed words; no runtime).
  - `PRELOADED_CLIENT_EXTERNALS`: `['@deepseek-ai/dsh-client-runtime/client']` → **`[]`**.
- `packages/client/modules/src/index.ts` (node half, 683 changed lines):
  - `PARSER_PRELOAD_IDS`: `[CLIENT_MODULES_ID, CLIENT_RUNTIME_ID]` → `[CLIENT_MODULES_ID]` — the runtime bundle is no longer parser-preloaded (0.1.1-rc.2 line 224: `const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID] as const`).
  - Boot graph restructured from a flat entry list + preload scripts into **batches** with `bootstrap`/`application` phases; content-addressed combo URLs (`buildCombo`/`comboUrl`/`partitionComboRecords`, `MAX_COMBO_URL_BYTES = 3 * 1024`, 12-char hash revs); per-source package resolution (`ClientPackageSource` map, `initialRevisionNonce`).
  - `serveBundle` still 405s non-GET/HEAD on `/plugins` in both versions (0.1.1-rc.2 lines 529-531; 0.1.2-rc.1 lines 1002-1007) — not a new regression.
  - Declaration scan unchanged in spirit: `parseDshClient` (line 201), `external: decl.external ?? []` (line 767).
- `packages/client/modules/src/client/system.ts` (client half, 53 changed lines):
  - `arrive()` keyed by URL (batch-shared script transport) instead of by row id.
  - `arriveGraphRow()` **newly fetches `inject` package rows** before the consumer (0.1.1-rc.2 fetched only `external` requests; the inject loop was added by `5549b9add5`) — but an inject name with no graph row is silently skipped (lines 165-168).
  - `invalidate(id, rev?)` + `atRevision()`/`reloadUrls` for single-row HMR reloads.
- `packages/bundle/web-app/cordis.patch.yml`: 0.1.1-rc.2 had a browser-roster row `- id: client-runtime / name: '@deepseek-ai/dsh-client-runtime'` (lines 176-177); 0.1.2-rc.1 has **no client-store row** (the store is a static platform seed, not a loader entry).
- `packages/boot/app-boot/src/profile.ts` (553 changed lines): module-proxy symlinks (`ensureModuleProxy`, `ensureProfileSymlink`, `ownedPackageNames`), new `PROFILE_MODULE_FALLBACK_DIR = '.dsh-module-fallback'`, `ProfileTemplate` with `patchReload` (`'live' | 'startup'`, default `'live'`), `healProfilesModuleFallback` rework; commits incl. `42378a987e`, `1477d5b9ef`, `ab4e65ba82`, `47a46e4cca`, `a16822944b`, `2c9da6eb5b`. The plugin-entry flow (deps → `dsh.profile.bundles` → patch layer → loader entries) is unchanged in both versions.

**Conclusion:** the specifier `@deepseek-ai/dsh-client-runtime/client` lost every supplier. On 0.1.1-rc.2 its factory was parser-preloaded (`PARSER_PRELOAD_IDS` + the in-tree `client-runtime` web-app row with `immediately: true`) and registered in `factories` before the plugin materialized — so the plugin's `require(...)` hit branch 3 (registered factory) even though the plugin declares no `dsh.client.external`. On 0.1.2-rc.1 the package, its row, and the preload entry are all gone; the store engine survived only as the new static seed `@deepseek-ai/dsh-client-store` (different specifier). No branch can answer the old specifier → the §1 throw.

## 3. Plugin side (declaration / build)

`packages/dsh-model-settings/package.json`:

- name `@apkawa/dsh-model-settings`, **version `0.1.0`**; exports `.` → `lib/index.js` (host) and `./client` → `lib/client.js`; `files: ["lib", "cordis.patch.yml"]`.
- `dsh.bundle.patch: "./cordis.patch.yml"` — this is what makes `reconcilePlugins` mount it as a profile bundle layer.
- `dsh.client`: `{ inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots'], platform: 'web' }` — **no `external` field**, no `immediately`.
- peerDependencies: `@deepseek-ai/cordis ^4.0.1`, `@deepseek-ai/dsh-client-connection ^0.1.0-rc.7`, `@deepseek-ai/dsh-client-runtime ^0.1.0-rc.7`, `@deepseek-ai/dsh-client-ui-slots ^0.1.0-rc.7`, `@deepseek-ai/dsh-settings ^0.1.0-rc.7`, `schemastery ^3.18.1`, `react ^18.2.0` (same in devDependencies).

`packages/dsh-model-settings/cordis.patch.yml` (whole file): one inserted row — `id: model-settings`, `name: '@apkawa/dsh-model-settings'`.

`packages/dsh-model-settings/tsdown.config.ts`:

- entry `client: ./src/client/index.ts` → `outDir: 'lib'`, format `cjs`, platform `browser`, target `es2024`, `clean: false` (tsc host output shares `lib/`).
- `entryFileNames: 'client.js'`; banner/footer wrap the bundle as `window.__ModuleLoader__.load({ id: '@apkawa/dsh-model-settings', factory: (require) => { ... return module.exports; } });` — the lazy CJS registration contract.
- `external: CLIENT_EXTERNALS` where `CLIENT_EXTERNALS = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']` (line 25). The local `PLATFORM_MODULES` copy (lines 11-22) is: react, react/jsx-runtime, react-dom, react-dom/client, cordis, `dsh-client-ui-slots`, **`dsh-client-web-react`**, `dsh-client-ui-primitives`, **`dsh-client-ui-attachment`**, **`dsh-client-schema-form`** — i.e. it matches **neither** dsh tag's actual seed list (those three names don't appear in 0.1.1-rc.2 or 0.1.2-rc.1 `platform.ts`; they match the `^0.1.0-rc.7` peer era), and it has no `dsh-client-store`. The operative line for this bug is the appended `@deepseek-ai/dsh-client-runtime/client`.
- CSS: the `dsh-css-inline` tsdown plugin (lightningcss, `[hash]_[local]`) injects `<style data-plugin>` tags at factory execution (vendored per `docs/ai/ui-guideline.md` §2 from dsh's `packages/client/tsdown.client.ts`).

Source imports of the removed package:

- `src/client/index.ts:13` — value import `{ createSnapshotStore, type ClientContext, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'`.
- `src/client/controller.ts:15` — same value import.
- `src/client/EffortButton.tsx:12`, `src/client/reasoning-controller.ts:21` — type-only imports (erased at bundle time).

Built artifact present in-tree: `lib/client.js` (625 lines, CJS). The only non-baseline external require is line 7: `let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");`.

Build facts (`packages/dsh-model-settings/AGENTS.md`): `pnpm build` = `tsc -p tsconfig.json` (host → `lib/`) then `tsdown` (client bundle into the same `lib/`); `pnpm typecheck` runs both tsconfigs; restart rules: host changes → full `dsh web` restart, client-only → page reload.

## 4. Profile materialization (`~/.dsh/profiles/web/package.json`)

- `dsh plugin --profile <name> <args...>` is a thin **pnpm forwarder** (`dsh/apps/cli/src/plugin.ts`): `initProfile` if missing → run `pnpm <args>` in the profile dir → `reconcilePlugins` (lines 59-90). Reconcile reads the post-install manifest; every dependency that resolves (via `resolveBundleDir`) to a package declaring `dsh.bundle` is **appended to `dsh.profile.bundles`** in dependency order; bundle-less deps warn; bundle entries no longer in dependencies are removed (template bundles are exempt).
- A profile is `$DSH_HOME/profiles/<name>/` with `package.json` (private, `name: 'dsh-profile-<name>'`, real `dependencies` written by pnpm, plus `dsh.profile.bundles` / `dsh.profile.patchReload`), its own `cordis.patch.yml` (`PROFILE_PATCH_FILENAME`, profile.ts:44), and pnpm-managed `node_modules`.
- `loadProfile` (`dsh/packages/boot/app-boot/src/profile.ts:805-844`): auto-inits from `PROFILE_TEMPLATES`; reads `dsh.profile.bundles`; resolves each bundle via `resolveBundleDir` (line 778); a listed bundle without a `dsh.bundle` manifest fails loud (lines 832-835); builds ordered layers `{packageName, packageDir, patchPath, patches}` and appends the profile's own user layer.
- `composeEntries` (profile.ts:854-861): `applyEntryPatches` over the empty root in layer order → the effective loader entry list. **The plugin row reaches the Loader only because `reconcilePlugins` put the plugin package into `dsh.profile.bundles`** (it declares `dsh.bundle.patch`), which loads its `cordis.patch.yml` and inserts the `model-settings` entry.
- The node half (`packages/client/modules/src/index.ts`) then scans the live Loader entries for packages with a `dsh.client` declaration (`parseDshClient`, line 201; `external: decl.external ?? []`, line 767) and composes the `window.__DSH_BOOT__` graph (+ batched preload rows, lines 517-522); bundles are served from `/plugins` (`serveBundle`, 405 on non-GET/HEAD at line 1004).
- **Why the workaround works:** removing the plugin entries from `profiles/web/package.json` (dependencies + `dsh.profile.bundles`) drops the patch layer → no `model-settings` entry in the tree → no client graph row → the failing factory import never happens. Deleting the whole profile dir forces re-init from the template (no plugin deps).

## 5. Known related facts (docs / AGENTS / archives)

- **E2E pins:** root `AGENTS.md` and `packages/dsh-model-settings/AGENTS.md` — boot smoke suites run the matrix `0.1.1-rc.2` + `0.1.2-rc.1`; RPC/acceptance lanes are **pinned to 0.1.1-rc.2 "until the 0.1.2-rc.1 405 is fixed (`.dumbspec/current/fix_0.1.2-rc1`)"**.
- **The documented 405** (separate host bug, same task): `.dumbspec/archive/e2e_version_matrix/research.md` — in-session `POST /model-settings/*` on 0.1.2-rc.1 returns 405, "host plugin apply-ordering; documented-deferred, owned by `.dumbspec/current/fix_0.1.2-rc1`"; it blocks the model-settings RPC suite on 0.1.2-rc.1. `.dumbspec/archive/playwright_e2e_tests/plan.md:62` — root cause: the plugin's channel is never registered because `ctx.get('connection')` is undefined at apply (profile plugins apply before the web-app `client-connection` row activates); proposed plugin-side workaround `ctx.inject(['settings','connection'])`; user decision: the host-side bug goes to task `fix_0.1.2-rc1`. The 405 fallback itself is `dsh/packages/host/frontend-static/src/index.ts:124-130` (non-GET/HEAD without a matching named route → 405) — so an unregistered RPC path lands in the static fallback. Note the `serveBundle` 405 on `/plugins` (both versions) is a different endpoint and not the one blocking RPC.
- **`docs/ai/key-moments.md`:** §1 plugin architecture (host/client split; `reconcilePlugins` appends newly-bundled deps to `dsh.profile.bundles`); §8 RPC carrier contract; install-mechanism note (a plugin is installable via `dsh plugin add` only with a `dsh.bundle.patch` declaration + shipped `cordis.patch.yml`); restart rules (client-only → page reload, host → full restart).
- **`docs/ai/ui-guideline.md` §2:** how CSS reaches the plugin bundle (the `dsh-css-inline` tsdown plugin vendored from dsh's `packages/client/tsdown.client.ts`) and the bundle-purity rule: value-imports of `@deepseek-ai/*` allowed only from the platform baseline ("react, cordis, ui-slots, web-react, ui-primitives, runtime/client, …") — the note still lists `runtime/client` as baseline; it is stale for 0.1.2-rc.1.
- **Archived tasks:** `.dumbspec/archive/model-settings/`, `v1/`, `v2/` contain no mentions of `dsh-client-runtime`, externals drift, or the 405 (grep empty). No prior note on this import failure.
- **Current task files:** `draft.md` (verbatim error + workaround) and `spec.md` (open questions 1-4, now answered by §2-§4 above).

## 6. Deep investigation — createSnapshotStore API parity (Stage 1)

### 6.1 Old package `@deepseek-ai/dsh-client-runtime/client` (tag dsh-v0.1.1-rc.2)

`packages/client/runtime/package.json` exports map:
- `.` → `lib/index.js` (types `lib/types/index.d.ts`)
- `./invariant` → `lib/invariant.js`
- **`./client` → `lib/client.js`** (types `lib/types/client/index.d.ts`)
- `./src/*`, `./package.json`
- deps: `immer ^10.1.1`, `zustand ~4.4.7` (the store engine lived inside this package).

`src/client/index.ts` (the module behind `./client`) is the browser runtime entry. Relevant re-exports:

```ts
// Runtime owns the snapshot store; ui-renderer only binds it to React.
export { createSnapshotStore, defineStore, shallowEqual } from './contract/store.ts'
export type {
  EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore,
} from './contract/store.ts'
...
/** Client-side Cordis context after declaration merging. */
export type ClientContext = Context   // Context imported from '@deepseek-ai/cordis'
```

It also carries `declare module '@deepseek-ai/cordis'` augmentation adding
`slots`, `conversationEvents`, `conversationViews`, `sessions`, `workspaces` to `Context`,
plus `declare module '@deepseek-ai/dsh-typert-protocol'` (`TypertContextMap.agent`) and
`@deepseek-ai/dsh-client-ui-slots` augmentations (SessionStandardProps/SessionMaybeStandardProps/GlobalStandardProps),
and the Cordis plugin values `inject = ['connection', 'typert', 'remote', 'remote.commands']` and `apply(ctx: Context)`.

Old `src/client/contract/store.ts` — exact definitions:

```ts
export interface ObservableSnapshot<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }

export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  update(mutator: (draft: T) => void): void
  set(next: T): void
}

export function createSnapshotStore<T>(
  init: T, opts?: { flush?: 'raf' | 'sync'; persist?: { name: string } }): SnapshotStore<T> { ... }
```

Engine: `zustand/vanilla` `createStore` + `subscribeWithSelector` middleware, immer `produce`
in `update()`, hand-rolled localStorage persist (`attachPersistence`), dev deepFreeze in `set()`.
Also exports `defineStore<T, A extends ActionsDecl<T>>(decl: StoreSpec<T, A> & { actions: A & ActionsDecl<T> }): EngineStoreHandle<T, A>`,
`shallowEqual(a, b)` (zustand/shallow), and re-exported contract types
`ActionsDecl, BakedActions, BoundActions, StoreFactory, StoreHandle, StoreInstance, StoreSpec` from `@deepseek-ai/dsh-client-ui-slots`.

### 6.2 New package `@deepseek-ai/dsh-client-store` (tag dsh-v0.1.2-rc.1)

`packages/client/store/package.json` exports map — **no `./client` subpath**:
- `.` → `lib/index.js` (types `lib/types/index.d.ts`)
- `./src/*` → `src/*`
- `./package.json`
- deps: `immer ^10.1.1`, `zustand ~4.4.7` (same ranges as the old runtime package); peer: cordis.

Default entry `src/index.ts` exports (values): `createSnapshotStore` (line 103),
`defineStore` (line 217), `shallowEqual` (line 67), `notifySubscribers` (line 46, new).
Types: `SnapshotStore` (line 27, identical shape to old), `ObservableSnapshot`
(re-exported from `src/contract.ts`), `EngineStoreInstance` (line 177), `EngineStoreHandle` (line 183),
plus re-exports from `src/contract.ts` (lines 20-24): `ActionsDecl, BakedActions, BoundActions,
DefineStore, HandleOf, MaybeSnapshotSelectorHook, ObservableSnapshot, PropsStore,
SnapshotSelectorHook, StoreDecl, StoreFactory, StoreHandle, StoreInstance, StoreSpec`.

Signature (src/index.ts:103-104) — textually identical to the old one:
```ts
export function createSnapshotStore<T>(
  init: T, opts?: { flush?: 'raf' | 'sync'; persist?: { name: string } }): SnapshotStore<T>
```

Behavioral deltas vs old `contract/store.ts` (public signature unchanged):
1. Subscriber callbacks are now wrapped per-listener in try/catch via `notifySubscribers`
   (`console.error('[client-store] subscriber failed: …')`); old code invoked listeners directly,
   so a throwing subscriber propagated. (src/index.ts:111-116, 146-158 vs old direct `fn()` calls.)
2. `devFreeze` now uses immer `freeze(value, true)` (deep freeze) instead of the old hand-rolled
   recursive `Object.freeze` loop. (src/index.ts:169-172.)
3. `src/contract.ts` absorbed the ui-slots contract types locally (old re-exported them from
   `@deepseek-ai/dsh-client-ui-slots`); also added `notifySubscribers` and the hook types
   (`SnapshotSelectorHook`, `MaybeSnapshotSelectorHook`) to the re-export surface.

**No `ClientContext` export.** The old `export type ClientContext = Context` (cordis `Context`
after the runtime's declaration merging) has no home in the store package. The 0.1.2-rc.1
convention (used by ui-agent-preset, ui-approval, ui-attachment, locale, …, and the dsh
cookbook) is `import type { Context as ClientContext } from '@deepseek-ai/cordis'`
(e.g. `packages/client/ui-agent-preset/src/client/index.ts:27`). The old runtime's
`declare module '@deepseek-ai/cordis'` merges moved to the owning packages: `slots: SlotRegistry`
now declared in `packages/client/ui-renderer/src/client/index.ts:33-44`; `connection` in
`packages/client/connection/src/rpc-host.ts:51-56`. The plugin's own `apply(ctx)` consumes
`ctx.get/inject/effect` (cordis base) and `ctx.slots` (ambient merge — requires ui-renderer's
d.ts in the program, or a structural mirror).

### 6.3 Seed wiring: what `require('@deepseek-ai/dsh-client-store')` returns at runtime (0.1.2-rc.1)

- `packages/client/web/src/platform.ts:8-13`: `PLATFORM_MODULES = ['react', 'react/jsx-runtime',
  'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']`
  and `PRELOADED_CLIENT_EXTERNALS = []` (empty, lines 16-17).
- `packages/client/web/src/seed.ts:14` — `import * as ClientStore from '@deepseek-ai/dsh-client-store'`;
  line 33 — `'@deepseek-ai/dsh-client-store': ClientStore` inside `getStaticModules()`
  (line 23), the only table the loader shares (`staticModules`), handed to the module system at
  `packages/client/web/src/boot.ts:70` — `moduleLoader.create({ boot: win.__DSH_BOOT__, staticModules: getStaticModules(), … })`.
- So a dynamic plugin bundle's `require('@deepseek-ai/dsh-client-store')` resolves to the shell's
  namespace object for the store package's default entry: named value exports
  `createSnapshotStore`, `defineStore`, `shallowEqual`, `notifySubscribers` (types erased).
  `dsh/packages/client/web/package.json` devDependencies include `@deepseek-ai/dsh-client-store`
  (workspace) — the shell imports it statically; `apps/web/vite.config.ts` has NO `external`
  setting, so immer/zustand are inlined into the shell bundle by Vite.

Old-world contrast (0.1.1-rc.2): `@deepseek-ai/dsh-client-runtime/client` was NOT a static-table
key — it sat in `PRELOADED_CLIENT_EXTERNALS` (old `platform.ts:16-18`), and
`packages/client/modules/src/index.ts:226-229` defined
`PARSER_PRELOAD_IDS = ['@deepseek-ai/dsh-client-modules/client', '@deepseek-ai/dsh-client-runtime']`:
the runtime's ordinary `lib/client.js` bundle ran as a parser-blocking head script before the
Vite shell and registered its exports into the module table (queue mode,
`bootInjections`, index.ts:239-263). The runtime package's own package.json carried
`dsh.client { inject, platform: 'web', immediately: true }` — it was a Loader entry, not a seed.

### 6.4 immer / zustand

- Old: `@deepseek-ai/dsh-client-runtime` deps `immer ^10.1.1`, `zustand ~4.4.7`; the plugin
  externalized `@deepseek-ai/dsh-client-runtime/client`, so those libs lived inside the
  runtime bundle (tsdown client externals = PLATFORM_MODULES + PRELOADED + declared, never
  immer/zustand).
- New: `@deepseek-ai/dsh-client-store` deps are the identical ranges (`immer ^10.1.1`,
  `zustand ~4.4.7`); the checkout's built `packages/client/store/lib/index.js` still imports
  `zustand/vanilla`, `zustand/middleware`, `zustand/shallow`, `immer` as external ESM imports —
  resolved and inlined by the apps/web Vite build (no externals in vite.config.ts) into the
  shell bundle that owns the seed table entry.
- Verdict: immer/zustand are **not** a new runtime requirement for the plugin in either world —
  the engine (with its zustand/immer) always lives in a dsh-owned bundle (old: preloaded
  runtime `lib/client.js`; new: the web shell via `getStaticModules`). The dependency declaration
  merely moved from `dsh-client-runtime` to `dsh-client-store`, both inside the dsh distribution
  (not the profile's pnpm graph). The built `store/lib/index.js` keeping bare `zustand/*`/`immer`
  imports matters only if something consumed the lib artifact directly (Vite does, from the
  store package's own node_modules).

### 6.5 Parity verdict

Plugin needs: `createSnapshotStore` (value), `ClientContext` (type), `SnapshotStore` (type).

| Need | 0.1.1-rc.2 (`…/dsh-client-runtime/client`) | 0.1.2-rc.1 (`@deepseek-ai/dsh-client-store`) | Compatible? |
|---|---|---|---|
| `createSnapshotStore` | `createSnapshotStore<T>(init: T, opts?: { flush?: 'raf' \| 'sync'; persist?: { name: string } }): SnapshotStore<T>` from `./client` (re-export of `contract/store.ts`) | Identical signature, default entry `.` | **Yes — identical public signature.** Diffs: per-subscriber try/catch (`notifySubscribers`), immer-based `devFreeze` (deep, same intent). Neither diff is visible to the plugin's usage (single caller, own subscribers, no reliance on listener errors propagating or on freeze internals). |
| `SnapshotStore` type | `interface SnapshotStore<T> extends ObservableSnapshot<T> { update(mutator: (draft: T) => void): void; set(next: T): void }` | Byte-identical declaration (store `src/index.ts:27-38`); `ObservableSnapshot` also identical (store `src/contract.ts:4-13`) | **Yes — identical.** |
| `ClientContext` type | `export type ClientContext = Context` (cordis `Context` + runtime's ambient merges: `slots`, `conversationEvents`, `conversationViews`, `sessions`, `workspaces`; plus `agent` in `TypertContextMap`, `slots/changed`/`connection/reset` events) | **Not exported by the store package (nor by any single package).** Ecosystem convention: `import type { Context as ClientContext } from '@deepseek-ai/cordis'`. The plugin's consumed members: `ctx.get/inject/effect` = cordis base; `ctx.slots` = ambient merge now living in `ui-renderer/src/client/index.ts:33-44` (its d.ts must be in the program for `ctx.slots` to typecheck, or the plugin mirrors it structurally). | **Yes for the plugin as written, with one caveat:** the bare cordis `Context` alias works because the plugin only uses base methods + `ctx.slots`; availability of `ctx.slots` shifts from "guaranteed by importing the runtime d.ts" to "ambient, program-dependent" (same pattern every 0.1.2-rc.1 dsh client plugin uses). The old alias carried extra merged members the plugin never used. |

Other differences, listed exhaustively:
- **Specifier/subpath:** old `./client` subpath has no counterpart; the new package's exports are only `.`, `./src/*`, `./package.json`. The plugin's import would become `import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'` (value import of the default entry).
- **New package surface is smaller in one direction, larger in another:** the old `./client` module exported the whole browser runtime (SlotRegistry, SessionRuntime, WorkspaceRuntime, registries, conversation contracts, `inject`/`apply` plugin values, module augmentations). The new store package exports only the store engine + framework-neutral contracts, plus additions: `notifySubscribers`, `SnapshotSelectorHook`, `MaybeSnapshotSelectorHook`, `PropsStore`, `StoreDecl`, `StoreFactory`, `HandleOf`, `BoundActions`, `DefineStore` (absorbed from ui-slots into `src/contract.ts`).
- **Runtime module-table membership:** old specifier was answered by a parser-preloaded dynamic bundle (runtime `lib/client.js` as a Loader entry with `immediately: true`); new specifier is a static-table key seeded shell-side (`getStaticModules()`). Either way a dynamic plugin's `require` of the specifier resolves to that module's namespace object — the lookup shape is unchanged; only the supplier changed.
- **Contract-type provenance:** old re-exported `ActionsDecl/BakedActions/…` from `@deepseek-ai/dsh-client-ui-slots`; new defines them locally in `src/contract.ts` and re-exports. Type structures are equivalent (the new package's README/AGENTS describe the same contracts); no impact on the plugin (it imports none of them).
- **Build-config fact (plugin side, already in §2):** the plugin's own tsdown config hard-codes a local `PLATFORM_MODULES` copy plus the appended `@deepseek-ai/dsh-client-runtime/client` external (`packages/dsh-model-settings/tsdown.config.ts:11-25`); for a 0.1.2-rc.1 build that list must read the new seed list (add `@deepseek-ai/dsh-client-store`, drop the runtime/client entry). In 0.1.2-rc.1 no `dsh.client.external` declaration is needed for the store — it is already in the implicit baseline (`packages/client/tsdown.client.ts:406-413`: externals = PLATFORM_MODULES + PRELOADED_CLIENT_EXTERNALS (empty) + declared).

### 6.6 Exact per-version import specifiers for a dual-version plugin

- **dsh 0.1.1-rc.2:** `import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'` and `import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'` (status quo; specifier is a parser-preloaded dynamic row, external via the plugin tsdown `CLIENT_EXTERNALS` append).
- **dsh 0.1.2-rc.1:** values from `@deepseek-ai/dsh-client-store` (default entry; no `/client`), and `ClientContext` as `import type { Context as ClientContext } from '@deepseek-ai/cordis'` (cordis is a platform seed in both versions; type-only, erased at bundle time — no runtime request). The value specifier `@deepseek-ai/dsh-client-store` must be in the plugin build's external list (it is in dsh's implicit baseline at 0.1.2-rc.1, so no `dsh.client.external` declaration is required at runtime; the plugin tsdown just needs it in its `external` array).

## 7. Deep investigation — npm registry availability (Stage 1)

Read-only checks against the public npm registry (no installs, no store writes). All evidence below is from the exact URLs queried.

### 7.1 `@deepseek-ai/dsh-client-runtime`

- **URL:** `https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-runtime` — HTTP 200, 41 623 bytes. **Exists.**
- **dist-tags:**
  ```json
  {"latest": "0.0.1-rc.1", "next": "0.1.1-rc.2"}
  ```
- **Full version list** (11 versions):
  `0.0.1-rc.1`, `0.0.1-rc.2`, `0.0.1-rc.3`, `0.0.1-rc.5`, `0.1.0-rc.2`, `0.1.0-rc.3`, `0.1.0-rc.6`, **`0.1.0-rc.7`**, **`0.1.0-rc.8`**, `0.1.1-rc.1`, `0.1.1-rc.2`
- **No stable `0.1.0` was ever published** (only prereleases; no `0.1.0` / `0.1.1` stable tags either).

**Does `^0.1.0-rc.7` match any published version? YES — exactly two.**

`^0.1.0-rc.7` expands to `>=0.1.0-rc.7 <0.2.0`. Per the node-semver prerelease rule, a prerelease version satisfies a comparator set only if some comparator in the set carries a prerelease tag on the **same `[major, minor, patch]` tuple**:

| published version | tuple | satisfies `^0.1.0-rc.7`? | why |
|---|---|---|---|
| `0.1.0-rc.7` | (0,1,0) | **YES** | equal to the lower bound; same tuple, prerelease comparator present |
| `0.1.0-rc.8` | (0,1,0) | **YES** | `>= 0.1.0-rc.7`, `< 0.2.0`; same tuple |
| `0.1.1-rc.1` | (0,1,1) | **NO** | no comparator has a prerelease on tuple (0,1,1) — prereleases of a *different* minor are excluded |
| `0.1.1-rc.2` | (0,1,1) | **NO** | same as above |
| `0.1.0-rc.2` … `0.1.0-rc.6`, `0.0.1-rc.*` | — | NO | below the lower bound |

**Best (highest) match: `0.1.0-rc.8`.** So `pnpm install @deepseek-ai/dsh-client-runtime@^0.1.0-rc.7` resolves to `0.1.0-rc.8` from the registry — the specifier is installable. (The `latest` dist-tag points at `0.0.1-rc.1`, so a *bare* `latest` install would be wrong; a pinned/caret install is what the plugin's peer range actually performs.)

**Published package.json of the best match `0.1.0-rc.8`** (from the same registry metadata, `versions["0.1.0-rc.8"]`):

- `name`: `@deepseek-ai/dsh-client-runtime`
- `version`: `0.1.0-rc.8`
- **`exports` — `./client` IS present:**
  ```json
  {
    ".":           { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*":     "./src/*",
    "./client":    { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./invariant": { "types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js" },
    "./package.json": "./package.json"
  }
  ```
- **`dependencies`:** `immer ^10.1.1`, `zustand ~4.4.7` (both present; `0.1.0-rc.7` additionally carried `react ^18.2.0` and a set of `@deepseek-ai/dsh-*@^0.1.0-rc.7` runtime deps).
- `peerDependencies`: cordis `^4.0.1` plus `@deepseek-ai/dsh-*` peers at `^0.1.0-rc.8` (llm, agent, tools, session, commands, llm-retry, attachment, invariants, api-remotes, host-apiproxy, session-title, typert-protocol, typert-registry, client-connection, session-projection).
- `files`: `null` in the registry metadata (no explicit files field; inclusion is default).
- `dist`: tarball `https://registry.npmjs.org/@deepseek-ai/dsh-client-runtime/-/dsh-client-runtime-0.1.0-rc.8.tgz`, integrity `sha512-wW/nktO/GVbGO/k163NlyJab/rK4D6xS5EL0bhYw4ojF1mxmWfrb3RUEYR5LcEUpFx/yXUHsUSgeO1ezmgIrvw==`.

**Tarball entry list** (fetched, 163 126 bytes, `tar -tzf`): top level is `package/` containing `LICENSE`, 4 READMEs, `package.json`, and `lib/` with `client.js`, `index.js`, `invariant.js` plus `lib/types/**` (incl. `lib/types/client/index.d.ts` and the full client contract/store type trees). **`lib/client.js` and its types are present in the artifact** — the `./client` subpath resolves to a real shipped file.

`0.1.0-rc.7` (the exact version named in the peer range) shows an identical `exports` shape (same `./client` → `lib/client.js`) and deps `immer ^10.1.1`, `react ^18.2.0`, `zustand ~4.4.7` plus `@deepseek-ai/dsh-*@^0.1.0-rc.7` runtime deps.

### 7.2 `@deepseek-ai/dsh-client-store`

- **URL:** `https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-store` — HTTP 200, 14 805 bytes. **Exists — it is published** (contrary to the "static platform seed, not expected to be an npm install" assumption in the candidate framing).
- **dist-tags:** `{"latest": "0.1.2-alpha.2", "alpha": "0.1.3-alpha.2", "next": "0.1.2-rc.1"}`
- **Versions (6):** `0.1.2-alpha.2`, `0.1.2-alpha.3`, `0.1.2-alpha.4`, `0.1.2-alpha.5`, **`0.1.2-rc.1`** (dist-tag `next`), `0.1.3-alpha.2` (dist-tag `alpha`). All six are themselves prerelease versions on tuples `(0,1,2)`/`(0,1,3)`, so **none of them satisfies the plugin's `^0.1.0-rc.7` range** (prerelease rule: no comparator carries a prerelease on those tuples). For context: the plugin's peer `^0.1.0-rc.7` is declared for `dsh-client-runtime`, not `dsh-client-store`; the store's `0.1.2-rc.1` (its `next` tag) is the release aligned with dsh 0.1.2-rc.1.

### 7.3 Org sanity check (one line each)

- `@deepseek-ai/dsh-client-connection` (`https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-connection`): **exists**, 17 versions (`0.0.1-rc.1` … `0.1.1-rc.2`, `0.1.2-alpha.*`, `0.1.2-rc.1`, `0.1.3-alpha.2`); latest `0.0.1-rc.1`, next `0.1.2-rc.1`.
- `@deepseek-ai/dsh-client-ui-slots` (`https://registry.npmjs.org/@deepseek-ai%2Fdsh-client-ui-slots`): **exists**, 17 versions, same list as connection; latest `0.0.1-rc.1`, next `0.1.2-rc.1`.

### 7.4 Factual verdict for candidate A

**Candidate A (declare `dsh.client.external: ['@deepseek-ai/dsh-client-runtime/client']` so the host composes a boot-graph row served from the npm package materialized in the profile) — FEASIBLE at the registry level, with caveats:**

1. **Registry availability: satisfied.** `@deepseek-ai/dsh-client-runtime` is published; `^0.1.0-rc.7` resolves to `0.1.0-rc.8` (only `0.1.0-rc.7` and `0.1.0-rc.8` match); the published artifact contains the `./client` export (`lib/client.js` + `lib/types/client/index.d.ts`) and its own deps (`immer`, `zustand`) are npm-installable.
2. **Caveat (host side, not registry-side):** feasibility of *serving* that row from a profile node_modules depends on dsh 0.1.2-rc.1's boot-graph/host actually composing a dynamic external row for the old specifier and resolving it via the profile's package resolution — a behavior question about the dsh host in §5, not about npm. The registry facts do not contradict it.
3. **Caveat (artifact age):** `0.1.0-rc.8` is from the 0.1.0 line; it is *the* version the peer range resolves to, but it predates 0.1.1-rc.2's runtime (`0.1.1-rc.2` exists as the `next` tag and would NOT match `^0.1.0-rc.7`). If the 0.1.2-rc.1 host's dynamic-external machinery expects a runtime-era contract matching its own protocol, serving the 0.1.0-era bundle is a contract-compat question for Stage 2; the registry check itself passes.

## 8. Deep investigation — dsh.client.external semantics (Stage 1)

Source: read-only inspection of `dsh` at tags `dsh-v0.1.1-rc.2` (b150a551b8) and `dsh-v0.1.2-rc.1` (a66e470204). Files: `packages/client/modules/src/index.ts` (node half), `packages/client/modules/src/client/manifest.ts` (wire contract), `packages/client/modules/src/client/system.ts` (client module system), `packages/client/web/src/{platform,boot}.ts`, `packages/bundle/web-app/cordis.patch.yml`, `scripts/verify-client-packages.ts`.

### 8.1 Declaration shape (both tags — identical)

`parseDshClient(pkgName, pkg.dsh?.client)` — input: the `dsh.client` object from the package's package.json; output: `DshClientDeclaration` (or `null`).

- 0.1.1-rc.2 `index.ts:126-146`:

```ts
const platform = requiredString(pkgName, 'dsh.client.platform', decl.platform)
if (platform !== 'web') throw new Error(`client-modules: ${pkgName} dsh.client.platform must be "web"`)
const inject = optionalStringArray(pkgName, 'dsh.client.inject', decl.inject)
const immediately = optionalBoolean(pkgName, 'dsh.client.immediately', decl.immediately)
const external = optionalStringArray(pkgName, 'dsh.client.external', decl.external)
return { platform, ...(inject !== undefined ? { inject } : {}), ...(immediately !== undefined ? { immediately } : {}), ...(external !== undefined ? { external } : {}) }
```

- 0.1.2-rc.1 `index.ts:201-221`: identical field set (`platform` required `web`, `inject?`, `immediately?`, `external?`); 0.1.2 additionally returns `undefined` for `platform !== 'web'` packages instead of throwing (`"not a web client package — no client row"`).
- `external` is `optionalStringArray` → **array of bare strings (exact specifiers)**, no objects. `optionalStringArray` (0.1.1 `manifest.ts:119-133`, 0.1.2 `manifest.ts:149-162`) rejects non-array and non-string entries.
- Shape of a specifier: any exact specifier, **with or without a trailing `/client`**. `DshClientDeclaration.external` doc (0.1.1 `index.ts:55-61`, 0.1.2 `index.ts:57-63`): *"Exact module-table requests beyond the implicit client baseline. Any specifier is valid, including subpaths such as `<pkg>/client`; each importing package declares its own exceptional requests. A type-only import is not a request because the transform erases it before resolution. Absent means the package uses only the baseline externals."*
- Only trailing `/client` aliases the package row: 0.1.1 `manifest.ts:134-141` `stripClientSuffix` (`/<client>` suffix → drop) and `modules/README.md:15` (0.1.1): *"only a trailing `/client` aliases a package row, and there is no provider-alias declaration"*.

**Real in-repo examples — 0.1.2-rc.1 only** (no `dsh.client.external` appears in any 0.1.1-rc.2 package.json):

- `packages/api/session-controller/package.json:45-53`:
  ```json
  "dsh": { "client": {
    "external": [ "@deepseek-ai/dsh-api-gateway/client" ],
    "inject": [ "@deepseek-ai/dsh-api-gateway" ],
    "platform": "web" } }
  ```
- `packages/api/workspace-controller/package.json:41-50`: same `external: ["@deepseek-ai/dsh-api-gateway/client"]`, `inject: ["@deepseek-ai/dsh-api-gateway", "@deepseek-ai/dsh-client-connection"]`, `platform: "web"`.
- Contrast, 0.1.1-rc.2 `packages/client/runtime/package.json` (`dsh.client`): `inject: [connection, typert-registry, api-remotes]`, `platform: "web"`, `immediately: true`, **no `external`**. (Same for api-gateway in both tags: inject + platform + immediately, no external.)

The baseline (things a bundle may require WITHOUT declaring them) = `PLATFORM_MODULES` (static seed keys) + `PRELOADED_CLIENT_EXTERNALS` (dynamic rows):

- 0.1.1-rc.2 `web/src/platform.ts:8-18`: `PLATFORM_MODULES = ['react','react/jsx-runtime','react-dom','react-dom/client','@deepseek-ai/cordis','@deepseek-ai/dsh-client-ui-slots','@deepseek-ai/dsh-client-ui-primitives']`; `PRELOADED_CLIENT_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client']`.
- 0.1.2-rc.1 `web/src/platform.ts:8-18`: `PLATFORM_MODULES = ['react','react/jsx-runtime','react-dom','react-dom/client','@deepseek-ai/cordis','@deepseek-ai/dsh-client-store','@deepseek-ai/dsh-client-ui-slots','@deepseek-ai/dsh-client-ui-primitives']`; `PRELOADED_CLIENT_EXTERNALS = []` (empty).
- `packages/client/AGENTS.md:75-83` (0.1.1): *"A request has two possible suppliers. A dynamic package supplies its own row; `PLATFORM_MODULES` supplies an exact static-table key. There is no `dsh.client.provide` alias protocol."* 0.1.2 AGENTS.md adds (item 6): *"Unsatisfied — no row, no seed — throws loudly at require time."*

### 8.2 Row composition (node half) — the supplier is the external package's OWN row, never synthesized

**Central fact (both tags):** the node half composes graph rows ONLY for packages that are **active Loader entries** (cordis plugin entries, `entry.fiber !== undefined && !entry.disabled`). It never walks a package's `dsh.client.external` to create rows for the named specifiers. `external` on a row is carried through verbatim and used only for (a) module-graph ordering and (b) the client-side fetch scheduling. There is no `resolveBundleDir`; supplier resolution happens when E's *own entry* is reconciled:

- 0.1.1-rc.2 `index.ts:388-391` (activation): dirty names seeded from `this.ctx.loader.entries().map(entry => entry.options.name)`; `reconcileDirty()` → `processOne(name)` (`index.ts:482-499`) re-checks `entry.options.name === entryName && entry.fiber !== undefined && !entry.disabled` then `resolveMeta(entryName)`.
- 0.1.2-rc.1 `index.ts:942-972` (`reconcilePackage`): same loader-entry guard.

Supplier (bundle) resolution for row E:
- 0.1.1-rc.2: `resolvePkgJson = spec => require.resolve(spec + '/package.json')` with `require = createRequire(ctx.baseUrl)` (`index.ts:307-311`, comment: *"the config tree's package.json, whose package.json declares every composed plugin as a dependency"*), then `resolveMeta(name)` (`index.ts:429-463`): `pkgPath = resolvePkgJson(name)`; `pkg.exports['./client']` (string or `{default}`) → `clientPath = join(dirname(pkgPath), clientRel)`; `statSync(clientPath)`; `rev = shortHash(readFileSync(clientPath))`. So E's bundle comes from **E's installed location in the profile's node tree** (config-tree resolution), and E must expose `exports['./client']`.
- 0.1.2-rc.1: `resolveMeta(loaderName, baseUrl)` (`index.ts:738-773`) → `locatePkgJson(loaderName, baseUrl)` (`index.ts:786-821`): first `ctx.loader.internal.resolveSync(loaderName, ctxBaseUrl)` (the profile's active ESM loader resolution), then `nearestPackage(moduleUrl, loaderName)` (`index.ts:823-847`) walks up to the nearest `package.json` whose name matches; fallback `createRequire(baseUrl).resolve(loaderName + '/package.json')`. Same `exports['./client']` → `clientPath` logic.

Row fields written (`graphRow`, 0.1.1 `index.ts:167-176`, 0.1.2 `index.ts:417-426`):
```ts
{ id, url, rev, ...(inject?.length ? { inject } : {}), ...(immediately === true ? { immediately } : {}), ...(external.length > 0 ? { external } : {}) }
```
- `url`: 0.1.1 `/plugins/<id>/client.js?rev=<rev>` (served by `servePlugin`, `index.ts:540-565`); 0.1.2 combo URL `/plugins/??<id>/client.js&rev=<rev>` (`index.ts:700-703`, `comboUrl`, served by `servePlugin` `index.ts:1008-1018`).
- `rev`: 0.1.1 = `shortHash` of bundle bytes; 0.1.2 = opaque nonce at compose time (`allocateInitialRevision`, `index.ts:559-564`), content hash only after rebuild (`framedHash`).
- `external` written verbatim from `meta.external = decl.external ?? []` (0.1.1 `index.ts:458`, 0.1.2 `index.ts:767`).

Ordering among existing rows (`orderByModuleGraph`):
- 0.1.1 `index.ts:188-220`: edges from `entry.inject` and `entry.external`; an external name resolves to a row via `rowsById.get(name) ?? rowsById.get(stripClientSuffix(name))`; **if no row answers, no edge is added — no node-side error**; self-request throws (`'a row must not declare its own package in dsh.client.external'`, line 217-219); synchronous cycles throw.
- 0.1.2 `index.ts:438-470`: same (self-request throws at 459-461).

**Missing-package behavior (node side): silent — no row.**
- 0.1.1-rc.2: unresolvable `require.resolve` → catch → `pkgMeta.set(E, null)` → `processOne` returns false → E simply has no row; the failure surfaces later in the browser (see 8.3). `dsh.client.platform !== 'web'` or no `dsh` → null → no row. Missing `exports['./client']` or missing bundle file → **loud** aggregate `ClientPackageCompositionError` at activation (0.1.1 `index.ts:229, 265-277`), `console.warn` in steady state (`index.ts:338-340`).
- 0.1.2-rc.1: `locatePkgJson` returns undefined → null → no row (silent); missing client export / unreadable bundle → loud `ClientPackageCompositionError` aggregate at activation (`index.ts:490-524`), warn in steady state (`index.ts:958-964`).
- The build-time gate `scripts/verify-client-packages.ts` (present in both tags; heavily reworked between them) is what rejects "missing suppliers, self-requests, and synchronous request cycles" **at repo build time** (`AGENTS.md:81` both tags) — it has no runtime effect and does not apply to external plugins.

### 8.3 Client-side arrival — trigger points and ordering guarantee

Wire: `window.__DSH_BOOT__` parsed by `parseBootManifest` (0.1.1 `manifest.ts:147-192`, 0.1.2 `manifest.ts:173-241`); row ids dedupe-checked in the system constructor (`duplicate graph entry` throw — 0.1.1 `system.ts:77-80`, 0.1.2 `system.ts:86-89`). Rows indexed into `graphRows` by id (bare package name; a row's id never carries `/client`).

`arriveGraphRow(row, ...)` is the only place externals are acted on:

- 0.1.1-rc.2 `system.ts:128-144`:
  ```ts
  for (const request of row.external) {
    const id = stripClientSuffix(request)
    if (this.seed.has(request) || this.loadCache.has(id)) continue
    const dependency = this.graphRows.get(id)
    if (dependency !== undefined) await this.arriveGraphRow(dependency, next)
  }
  await this.arrive(row)
  ```
  (No inject handling — `inject` is "informational graph edge" in 0.1.1, `manifest.ts:45`.)
- 0.1.2-rc.1 `system.ts:144-170` (changed by **5549b9add5** "fix(client): preload injected module factories"): adds `visited` dedupe, and **after** the external loop:
  ```ts
  for (const packageName of row.inject) {
    const dependency = this.graphRows.get(packageName)
    if (dependency !== undefined) await this.arriveGraphRow(dependency, [], visited)
  }
  await this.arrive(row)
  ```

**Who triggers it (both tags, three trigger points):**
1. **P's activation/import** — the vendored cordis Loader reaches plugin code via `EntryTree.import` → `internal.import` (`vendor/loader/src/config/tree.ts:152-155`, both tags: `return await this.ctx.loader.internal.import(name, this.ctx.baseUrl!, {})`); `ClientModuleSystem.import(specifier)` does `await this.arriveGraphRow(row)` **then** `return this.materialize(id).exports` (0.1.1 `system.ts:189-204`, 0.1.2 `system.ts:215-230`). Boot creates every graph entry: `web/src/boot.ts:113-135` `runPluginBoot` (`loader.create({name})` per row, both tags; `loader.internal = this.modules` at line 116).
2. **Stage-one prefetch of the `immediately` tier** — `web/src/boot.ts` `prefetchImmediateTier` (0.1.1 lines 97-111, 0.1.2 lines 104-110): `this.manifest.plugins.filter(row => row.immediately).map(row => this.modules.prefetch(row.id).catch(...))`; `prefetch` → `arriveGraphRow` (0.1.1 `system.ts:206-212`, 0.1.2 `system.ts:232-238`). 0.1.1 skips this tier when a transport `loadBundle` seam is present; 0.1.2 does not.
3. **HMR** — `packages/client/hmr/src/client/index.ts:116` (`await modLoader.prefetch(id)` after `invalidate`, both tags).

**Ordering guarantee:** YES — an external's factory is registered before P's factory can `require(E)`: `arriveGraphRow(P)` awaits each external (recursively: E's externals first, then `arrive(E)` which fetches/executes E's script and registers its factory) before `arrive(P)`, and P's factory only runs in `materialize(id)` after `arriveGraphRow` returned. `arrive()` short-circuits (`if (this.loadCache.has(id) || this.factories.has(id)) return` — 0.1.1 `system.ts:117`, 0.1.2 `system.ts:129`) so already-registered factories are never fetched twice. Materialization of E is still lazy: P's factory's `require(E)` triggers it recursively via `makeRequire`/`materialize` (0.1.2 `system.ts:200-213`; 0.1.1 `system.ts:178-187`).

**What happens for an external E that has NO graph row** (E not an active loader entry, or unresolvable on the node side — e.g. a pure npm dependency): the external loop finds `graphRows.get(id) === undefined` and **does nothing** (no fetch, no node-side error, no client-side error at arrival). The failure is **loud at require time**, inside P's materialization: 0.1.1 `system.ts:197-202` / 0.1.2 `system.ts:222-228`:
```ts
throw new Error(`client-modules: missed the module table for "${specifier}" — `
  + 'not a platform seed word, not a materialized module, '
  + 'and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)')
```
(0.1.1 wording: `cannot resolve ... not a seed word, not a materialized module, and not a row in the boot graph (the runtime mirror of the bundle purity gate)`.)

### 8.4 Seed-name-as-external (both tags — same behavior)

If E is a `PLATFORM_MODULES` seed word and a package declares it in `dsh.client.external`:

- **Node half:** `orderByModuleGraph` looks for a *row* with that name (`rowsById.get(name) ?? rowsById.get(stripClientSuffix(name))`); seed words have no rows → no edge, **no error, no duplicate row** (seeds never become rows — they come from `staticModules` at `create()`, 0.1.1 `system.ts:74`, 0.1.2 `system.ts:84`).
- **Client half:** `arriveGraphRow` skips it — `if (this.seed.has(request) || this.loadCache.has(id)) continue` (note: seed check is on the **exact un-stripped** specifier). `require(E)` hits the seed branch first — `if (this.seed.has(spec)) return this.seed.get(spec)` (0.1.1 `system.ts:180`, 0.1.2 `system.ts:207`).
- Result: **harmless no-op** — no duplicate, no override, no error. The seed check is exact-key: a seed `S` declared as `S/client` would NOT be recognized as a seed (`seed.has('S/client')` false; no row for `S`) and would fail at require.
- **Dual-version implication (fact only):** if the *new* seed name is unknown to an *old* dsh (neither seed nor row there), the old client has no supplier for it: no arrival, and `require` throws the loud "missed the module table" error. The only in-graph supplier an old host can offer for a new specifier is a graph row for a package that is an **active loader entry** in that profile declaring `dsh.client` (`platform: "web"`).

### 8.5 0.1.1-rc.2 duplicate-supplier case for `@deepseek-ai/dsh-client-runtime`

Setup: in 0.1.1-rc.2 runtime is **both** a parser-preloaded row and (if a plugin declares it `external`) a composed graph row:
- `PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID]` (`index.ts:229`); `bootInjections` emits parser-blocking `script-src` rows for them: `const preload = PARSER_PRELOAD_IDS.map(id => graph.entries.find(entry => entry.id === id))` (`index.ts:265-267`), plus `script-src` rows for the `immediately` tier (line 263-264) — the row must exist in the composed graph (it does: runtime is a web-app entry, `packages/bundle/web-app/cordis.patch.yml` `- id: client-runtime, name: '@deepseek-ai/dsh-client-runtime'`; it also declares `immediately: true`).
- Its `lib/client.js` registers a factory via `window.__ModuleLoader__.load({id, factory})`; before `create()` this queues into `pendingQueue` (`manifest.ts` facade), drained by the constructor into `register()` (`system.ts:89-101`), i.e. `factories.set('...dsh-client-runtime', factory)`. Registration is registered-but-not-materialized (the bundle body is the factory closure; only the modules bootstrap module is materialized at `create`).
- `register()` collision behavior (`system.ts:104-110`):
  ```ts
  if (this.bootstrapIds.has(id) || this.factories.has(id)) {
    throw new Error(`client-modules: duplicate factory registration for "${id}"`)
  }
  this.factories.set(id, reg.factory)
  ```
  (`register` also strips `/client`, so `.../client` and the bare name share one key.)

If a plugin P declares `external: ['@deepseek-ai/dsh-client-runtime/client']` under 0.1.1-rc.2:
- `arriveGraphRow(P)` → external loop → `dependency = graphRows.get('...dsh-client-runtime')` (row exists) → `arriveGraphRow(runtimeRow)` → `arrive(runtimeRow)` → **short-circuit**: `if (this.loadCache.has(id) || this.factories.has(id)) return Promise.resolve()` (`system.ts:117`) — the factory is already registered by the parser preload. **No re-fetch, no second bundle execution, no second `register()`, no throw, no overwrite. Harmless.**
- The only way to hit the loud "duplicate factory registration" is a *genuine* second execution of the bundle (e.g. a script re-run without `invalidate()`); HMR is built around this: `hmr/src/client/index.ts:111` — "Invalidate MUST precede prefetch: a live factory makes prefetch a no-op and re-registration a loud duplicate" (`invalidate` deletes factory+record, `system.ts:214-219`).
- Materialization is memoized in `loadCache`, so even a later legitimate re-`arrive` (after invalidate) registers exactly one fresh factory and materializes once per lifetime.

**Tag delta summary relevant to the fix:** in 0.1.2-rc.1 the `client-runtime` entry is gone from `packages/bundle/web-app/cordis.patch.yml` (roster no longer lists `@deepseek-ai/dsh-client-runtime`; the package no longer exists in the repo), `PARSER_PRELOAD_IDS` is `[CLIENT_MODULES_ID]` only (`index.ts:476`), `PRELOADED_CLIENT_EXTERNALS` is empty, and `PLATFORM_MODULES` gains `@deepseek-ai/dsh-client-store`. Consequently, under 0.1.2-rc.1 the standard profile's boot graph has **no row for `@deepseek-ai/dsh-client-runtime`**, so a plugin bundle value-importing `@deepseek-ai/dsh-client-runtime/client` (as `packages/dsh-model-settings/src/client/{index.ts:13,controller.ts:15}` do) has no in-graph supplier: no arrival on P's import, and the loud require-time miss — regardless of whether the plugin lists it in `dsh.client.external` (the node half composes no row for it, because it is not an active Loader entry of the profile; `external` alone creates no row in either tag).

## 9. Stage 1 decision — chosen mechanism (B: runtime dual-require)

Evidence base: §6 (API parity), §7 (npm registry), §8 (external semantics).

**Decision: mechanism B — runtime dual-require with a shadowed `require` in the tsdown banner.**

- **Why not A (external declaration of the old specifier):** §8.2 — `dsh.client.external` alone composes NO row in either tag; a row exists only for an *active cordis Loader entry*. Making the old specifier answerable under 0.1.2-rc.1 would require the plugin's `cordis.patch.yml` to carry an extra entry row for `@deepseek-ai/dsh-client-runtime` AND the profile's node_modules to materialize the 0.1.0-era npm package (§7: best peer match `0.1.0-rc.8`) — i.e. executing a 0.1.0-era client bundle under the 0.1.2-rc.1 client protocol (URL-keyed arrivals, combo URLs), plus a duplicate entry for the same package name on 0.1.1-rc.2 (the in-tree web-app patch already registers `client-runtime`). More moving parts, cross-era protocol risk, unknown duplicate-entry behavior.
- **Why B:** each dsh version is served by its own first-class supplier — 0.1.2-rc.1: the new static seed `@deepseek-ai/dsh-client-store` (§6/§8.4: seeds are answered by branch 1 of `makeRequire`; no row or external needed); 0.1.1-rc.2: the old parser-preloaded factory (§8.5: factory registered before plugin materialization). §6 proves `createSnapshotStore`/`SnapshotStore` are signature-/byte-identical across the two packages, and `ClientContext` reduces to plain cordis `Context` (type-only, erased at bundle time — the old specifier's d.ts stays in devDependencies for type-checking, no runtime effect).
- **Mechanism sketch (implementation detail for Stage 3):**
  - Source: value-import `createSnapshotStore` from `@deepseek-ai/dsh-client-store` (`src/client/index.ts:13`, `src/client/controller.ts:15`); type imports (`ClientContext`, `SnapshotStore`) stay on the old specifier (erased at build).
  - `tsdown.config.ts`: `CLIENT_EXTERNALS` gains `@deepseek-ai/dsh-client-store` (replacing the dead specifier); the stale local `PLATFORM_MODULES` copy is synced to the union of both tags' real seed lists (8 words — the old 7 + `dsh-client-store`, per §6.3/§8.1).
  - Banner: after `factory: (require) => {`, shadow the parameter:
    ```js
    var __nq = require;
    var require = function (spec) {
      if (spec === '@deepseek-ai/dsh-client-store') {
        try { return __nq(spec) } catch (e) { return __nq('@deepseek-ai/dsh-client-runtime/client') }
      }
      return __nq(spec)
    };
    ```
    The tsdown-emitted bundle code (hoisted `require("@deepseek-ai/dsh-client-store")` calls, §3) then executes against the wrapper. On 0.1.1-rc.2 the seed miss throws synchronously (plain JS `throw` from `makeRequire`, §8.3 — catchable) and the wrapper falls back to the old specifier, whose factory is parser-preloaded (§8.5).
  - Fallback direction matters: under 0.1.2-rc.1 the seed hit means the fallback never runs; under 0.1.1-rc.2 the fallback specifier is the *only* supplier, so no other mapping is needed.
- **Residual risks (verified in Stage 2/3 e2e, not assumed):**
  1. the banner `var require` shadowing survives tsdown emit and binding scoping as reasoned (var re-declaration of a function parameter is legal JS; bundle code follows the banner in the same function scope);
  2. no other bundled require routes through the wrapper with side effects (exact-spec mapping only; everything else passes through unchanged);
  3. the npm peer `@deepseek-ai/dsh-client-runtime` auto-installed into a 0.1.2-rc.1 profile must stay inert — verify its published package.json declares no `dsh.bundle` (else `reconcilePlugins` would add a stray bundle layer, §4).
- **Rejected C** (version-gated double build): heaviest option; unnecessary once B is verified green on both lanes.
