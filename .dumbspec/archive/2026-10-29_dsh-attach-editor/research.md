# Research — dsh-attach-editor

Findings are facts from the repo + read-only `dsh/` checkout (HEAD `639ed01539`, tag `dsh-v0.2.0-rc.2`).

## R1 — Plugin package anatomy (from `packages/dsh-global-queue`)

- `package.json` (`packages/dsh-global-queue/package.json:17-31`): `exports: { ".": "./lib/index.js", "./client": "./lib/client/index.js" }`, plus metadata
  ```json
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-modules",
                 "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-sidebar-right",
                 "@deepseek-ai/dsh-client-ui-workspace"] }
  }
  ```
  `files: ["lib", "cordis.patch.yml"]`, deps only `@deepseek-ai/dsh-home-paths@0.2.0-rc.2`; peers `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`; dev-only `react`, `lightningcss`, `tsdown`, `typescript`, `vitest`, `@playwright/test`.
- Host half registration row = `cordis.patch.yml`:
  ```yaml
  - insert:
      - id: global-queue
        name: '@apkawa/dsh-global-queue'
  ```
  consumed by `dsh/packages/boot/plugin-manager/src/index.ts:548,:741`. Install: `dsh plugin --profile web add github:apkawa/dsh-plugins#path:/packages/<name>`. Host changes need a full `dsh web` restart; client-only changes a page reload.
- Client bundle build: `packages/dsh-global-queue/tsdown.config.ts` — `entry: { client: './src/client/index.ts' }`, `outDir: 'lib'`, `format: 'cjs'`, `platform: 'browser'`, `target: 'es2024'`, `dts: true`, `external: PLATFORM_MODULES` (local copy of dsh baseline: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives` — note: omits `@deepseek-ai/dsh-client-ui-dockkit`), `noExternal: id => isExternal(id) ? undefined : true` (everything else bundled privately).
- CSS: `.module.css` → `lightningcss.transform({cssModules:{pattern:'[hash]_[local]'}})` + default class map; plain `.css` → default string; both prepend a `<style data-plugin="<PLUGIN_ID>/<basename>">` injector (`tsdown.config.ts:38-49,73-89`). Styles are claimed per plugin and removed on cleanup (`dsh/packages/client/modules/src/client/system.ts:71-81`, `entry-lifecycle.ts:26-33`).
- Module-loader envelope (`tsdown.config.ts:91-98`): banner/footer wrap the bundle in
  `window.__ModuleLoader__.load({ id: PLUGIN_ID, factory: (require) => { ... return module.exports; } })`.
- dsh load path: `dsh/packages/client/modules/src/index.ts:836-857` requires a `./client` export (else throws `client-modules: ... declares dsh.client but exports no "./client" bundle`); row shape `:480-489`; boot reads `window.__DSH_BOOT__` + `window.__ModuleLoader__` (`dsh/packages/client/web/src/boot.ts:57-76`). Served resource must be `${row.id}/client.js`; chunks must match `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` (`system.ts:39,60`).
- Bundle protocol: `ClientBundleRegistration { id, chunk?, factory: (require: ClientBundleRequire) => Record<string, unknown> }` (`dsh/packages/client/modules/src/client/manifest.ts:309-328`).
- Activation: `dsh/packages/client/web/src/boot-client.ts:36-57` creates one loader entry per manifest row; `assertEntriesActive` rejects with `web boot: N entr(ies) did not activate` (`:66-89`) listing `pending (waiting for service(s): …)`.
- `dsh.client.inject` edges are informational only (preflight display / HMR diff), they do not sequence activation; activation order is Cordis `inject` waiting on services.

## R2 — Right-sidebar tab API (two-stage)

Stage 1 — tab type in `dsh/packages/client/ui-sidebar-right/src/client/tab-registry.ts`:
```ts
export interface SidebarRightTabDefinition {   // :94-139
  readonly id: string; readonly kind: string
  readonly multiple?: boolean; readonly keepMounted?: boolean
  readonly patterns?: readonly string[]; readonly priority?: 'extension'|'builtin'|'fallback'
  readonly canOpen?: (address: string) => boolean
  readonly title: (address: string) => string
  readonly guide?: readonly SidebarRightGuideEntry[]
}
register(definition): () => void               // :253
```
Throw messages: `sidebarRight: tab type id "${id}" is already registered` (:258), `tab kind "${kind}" is already registered` (:261), `no registered tab type claims "${address}"` (:392). Only one `extension` + one `builtin` per kind may coexist (:181-183); higher band wins.

Stage 2 — React body under the keyed seat `sidebar.right.pane.tab` (`contract/slots.ts:59-64`, `kind: 'keyed'`, `scope: 'session'`, `hookContext: TabHookContext`, `inject: SidebarRightTabInjected`). Render site: `shell/SidebarRight.tsx:211` `renderSlot(seat, {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext })`; fallback renders `data-sidebar-right-unavailable` (:233). `keepMounted` retains the tab (:198).

Hook context (`tab-info.ts:11-21`): `{ shortcuts, tabId, title, fullscreen, active, signal: AbortSignal, actions: SidebarRightTabActions, useStore, useTabNavigation }`. `SidebarRightTabInfo` (`contract/slots.ts:164-184`): `{ sidebar: {expanded, fullscreen}, panel: {id}, tab: TabRecord & { visible, navigation, signal, actions } }`. Tab-local facts are reachable ONLY via the bound `useTabInfo()` hook — never as props (`tab-info.ts` comment).

Programmatic open: `ISidebarRight` (`service.ts:186-259`) — `mounted: ObservableSnapshot<SessionId|undefined>`, `openResource(address, options?)`, `openTab<K extends string>(kind, options?)`, `close(tabId)`, `active()`, `isExpanded()`, `toggleExpanded()`, `focus(tabId)`, `split(paneId?)`, `float(tabId, rect?)`, `dock(paneId)`. `placeTab` throws `sidebarRight: no tab type is registered as "${kind}"` (:405); `multiple: true` kinds get `${pageAddress(kind)}/${randomUUID()}` (:406). Placement options: `paneId?`, `preferNewPane?`, `revealIfOpened?`, `replaceTab?` (:122-131). Params maps are compile-time extensible, nothing validates them at runtime (`contract/params.ts:23-51`).

Service wiring (`ui-sidebar-right/src/client/index.ts`): `inject = ['slots','layout','locale','resources','sessions','uiSession','shortcuts']` (:83); `ctx.reflect.provide('sidebarRightTabs', tabs)` (:150) and `'sidebarRight'` (:151) are built at apply top level, never inside an effect — doing so from another plugin's apply stalls browser boot silently (:102-108 comment).

Slot API (`dsh/packages/client/ui-renderer/src/client/registry.ts`): `inject(key, callback: () => SlotInjectionEffect): () => void` (:209), `SlotInjectionEffect = (() => void) | Iterable<() => void, void, void>` (:117); registration into another package's slot MUST be `ctx.slots.inject(name, () => ctx.slots.register(...))` — bare `register` into an undeclared slot throws at load. `SlotComponent<P> = (props: P) => ReactNode` (:404).

Plugin call sites (`packages/dsh-global-queue/src/client/index.ts`):
```ts
export const inject = ['connection','slots','sidebarRight','sidebarRightTabs','uiWorkspace']  // :123
ctx.effect(() => sidebarRightTabs.register({ id: TAB_ID, kind: TAB_KIND, title: () => 'Show queue',
  guide: [{ id: 'show-queue', order: 40, title: () => 'Show queue', description: () => '…' }] }), …)  // :139-149
ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
  { name: 'sidebar.right.pane.tab', key: TAB_ID, inject: () => ({ openSession }) }, QueuePane)), …)  // :153-157
```
Composer seat `'conversation.input.right'` (`ui-conversation/src/client/contract/slots.ts:203`, rendered `InputBar.tsx:454`) — plugin registers `{ name, id, order, inject }` with a component (:162-167).
Programmatic open needs retry: subscribe `sidebarRight.mounted`, call `openTab(kind)`, on throw `setTimeout(() => open(sessionId), 0)` because the session surface is adopted during the render the `mounted` change precedes (:172-190).

Derived props = five shares (`ui-slots/src/index.ts:601-610`): runtime props + renderSlots + renderFactories + store + `InjectFace<I>` + matched share + locale. Session-scope standard props: `useSession`, `sessionId`, `useProjection` (`ui-session/src/client/index.ts:163-171`); global: `useSessions`, `useSessionStatus`, `useSessionRetainInfo` (:156-160); `useWorkspaces` (`ui-workspace/src/client/index.ts:68-70`); conversation adds `useConversation`, `useInput: SnapshotSelectorHook<InputState>`, `inputActions: InputActions` — optional (`ui-conversation/.../slots.ts:249-269`).

## R3 — React / styling constraints

- React `^18.2.0` catalog → resolved `react@18.3.1`; React identity is SHARED via `PLATFORM_MODULES`, not bundled (`dsh/packages/client/web/src/platform.ts:8-14`).
- Types resolve via tsconfig path mapping to provisioned dsh tree (`.tmp/dsh-versions/0.2.0-rc.2/…`), not declared deps (`packages/dsh-global-queue/tsconfig.client.json:14-20`).
- Icons from `@deepseek-ai/dsh-client-ui-primitives` (`IconEditOutlineRegular` etc., `size={16|12}`).
- dsh styling rule (client AGENTS.md): CSS Modules + `clsx`, semantic `--dsw-*` tokens, no literal colors, no component library, no Tailwind; product-visible strings belong in a locale dictionary (not enforced for external plugins — global-queue hardcodes English copy).
- Plugins re-declare seams locally as structural mirrors (no dsh client deps declared): `ConnectionHandle`, `Snapshot<T>`, `SlotRegistryFace`, `SidebarRightFace`, `SidebarRightTabsFace`, `UiWorkspaceFace` (`src/client/index.ts:16-82`); services read via `ctx.get(name)` in apply (:130-134).

## R4 — Lifecycle / E2E facts

- Every contribution is an effect owned by the plugin fiber; plugin unload cancels pending waits and removes contributions. `slots.register` returns an idempotent disposer (:1151-1152).
- HMR/replacement: `invalidate(id, rev?)` (`system.ts:462-478`), `ClientEntries.invalidateForReplacement` + `prefetch` (`entries.ts:20,178-179`), `tearDownEntryFiber`, `removeOwnedStyles`.
- Live probing needs `pnpm --filter <pkg> bundle` first — registry serves `lib/client.js`, not sources.
- `E2E_DSH_VERSIONS = ['0.2.0-rc.2']` (`tests-helpers/e2e/dsh.ts:29`); `launchDsh`/`stopDsh`, READY regex `dsh web: (http://…)`, READY_TIMEOUT 90s, PROVISION_TIMEOUT 180s; artifacts `.tmp/dsh-e2e-*`, `.tmp/dsh-versions/<version>`, `.tmp/playwright/<package>`.
- Acceptance anchors in global-queue: `[data-sidebar-right-expand]`, `[data-sidebar-right-guide-entry="global-queue"]`, `getByRole('tab', { name: 'Show queue' })`, plugin testids `global-queue-*`.

## R5 — Repo constraints

- Frozen pnpm installs only — **no `pnpm add`, no `--no-frozen-lockfile`** (exception: auto-provisioned throwaway projects under `.tmp/dsh-versions/<version>`). Cache: `pnpm_config_store_dir=./.cache/pnpm/v11`.
- `pnpm typecheck` from package dir; `pnpm build` = `tsc -p tsconfig.json` (host → `lib/`) then `tsdown` (client → `lib/client/index.js`).
- Temp in `.tmp/`, caches in `.cache/`; isolated `DSH_HOME` in tests; never `playwright install`.
- No runtime import between feature plugins (types via `import type`, behavior via injected services, UI via slots). No `ctx` in components, no hand-made subscription machinery.

## Open threads

- Attachment rendering / preview / replacement seams in dsh composer (R6, pending).
- Renderer choice under the frozen-lockfile constraint (R7, pending).

## R6 — Attachment model and composer seams (dsh checkout)

**Draft model** (`packages/client/ui-conversation/src/client/contract/slots.ts:27-46`):
```ts
export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment
export interface ComposerImageAttachment { readonly kind: 'image'; readonly id: DraftAttachmentId
  readonly previewUrl: string; readonly file: File; readonly width?: number; readonly height?: number }
export interface ComposerFileAttachment { readonly kind: 'file'; readonly id: DraftAttachmentId; readonly file: File }
```
- No base64 in the draft; image preview = `URL.createObjectURL(file)` (`ui-conversation/src/client/service.ts:74-81`), revoked on removal; `width/height` filled by async `probeDimensions` (:314). `DraftAttachmentId = Branded<'DraftAttachmentId'>` (`contract/input.ts:161`), minted with `randomUUID()`.
- `InputState` (`contract/input.ts:254-269`) holds `attachmentIds` only — the `File` objects live in `ConversationController.draftAttachments: Map<DraftAttachmentId, ComposerAttachment>` (`service.ts:160`) plus `fileUploads: SnapshotStore<Record<string, DraftFileUpload>>` (:159). Service name `'conversation'` (:185).
- `DraftFileUpload` (`contract/slots.ts:49-56`): `uploading | ready(receiptId, FileAttachmentRef) | error(message)`.

**InputActions** (`input/facade.ts:123-135`, exposed as `SessionMaybeStandardProps.inputActions`):
`captureInsertion()`, `insertText(text, span)`, `setDraft(text)`, `addAttachments(ids)`, `removeAttachment(id)`, `pruneAttachments(ids)`, `submit()`. `addAttachments`/`removeAttachment` refuse while `phase === 'adjudicating' | 'submitting'` (:220-254).

**Insertion gestures** — all converge on `ComposerBarInjected.addFiles` (`ui-conversation/src/client/apply.ts:460-498`): paperclip → `keyboard?.openFilePicker()` (`skeleton/InputBar.tsx:230`) → hidden `<input type="file">` (`input/editor/view-binding.ts:88-97`); paste via Lexical `PASTE_COMMAND` (`input/editor/keymap.ts:159-185`) → `handlers.intakeFiles(files, directories)`; document drop via `ui-attachment/src/client/drop-events.ts:30-87`. Images and path-less files → `conversation.createDrafts(sessionId, uploads)`; path-bearing files become `@path` mention chips instead (`draft/mentions.ts:31-53`). On failure drafts are released (`conversation.releaseDraftAttachments`).

**Image bytes stay browser-local until send**: base64 only at submit (`service.ts:576-582`, `encodeImage(file)` → `{ mediaType, data }`; accepted png/jpeg/webp/gif, :602-604). File-kind uploads go to `/api/session/uploadFileBinary` (`packages/client/file-upload/src/protocol.ts:3-9`, `http-route.ts:22-58`).

**Rendering**: rail slot `conversation.input.attachments` (`contract/slots.ts:209-213`, `kind: 'single'`, `scope: 'session-maybe'`, owner `ComposerAttachmentsOwnerProps` — `attachments`, `canAcceptDrop`, `onAddFiles`, `onRemoveAttachment`, `uploads`, `onRetryFile`, `dropLimits`, :58-77). Occupant injected by **ui-attachment** (`ui-attachment/src/client/index.ts:22-33`). Image item = thumbnail `<button onClick={() => setPreview(attachment)>` + remove button (`ui-attachment/src/client/ComposerAttachments.tsx:74-93`); preview is **component-local state** (:24) rendered as `<ImageLightbox src={preview.previewUrl} labels={lightboxLabels(t)} onClose={closePreview}/>` (:98-105). `ImageLightbox` (`ui-primitives/src/ImageLightbox.tsx`, exported at `ui-primitives/src/index.ts:113-114`) = portal dialog, mask click closes, Escape + focus trap, props `{ src, alt, labels: {dialog, close}, onClose }` — **no children, no slots**.
- **No testids** in ui-attachment; identification by CSS-module classes + aria-labels (`t('image.openOriginal')`, `t('image.remove', {name})`).

**Slot verdict (a) UI near preview:** NOT available — no preview seats; `ImageLightbox` has no children/slots; preview state is local. Available seams: **replace `conversation.input.attachments`** (single cell — a registration replaces the shipped presentation, catalog example at `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:746-783`), or additive seats `conversation.input.dock` (owner `InputZone { session, input }`), `conversation.input.overlay`, `conversation.input.left/right`, `conversation.composer.dock`, or take over `conversation.composer` (chain, :187). Also `conversation.message.images` (:1133) / `conversation.trajectory.images` (:1509) / `tool.call.images` (:3994) can be replaced (without one, images are omitted — must reimplement or reuse `MessageImages` logic).

**Slot verdict (b) replace attachment before send:** content is frozen at submit (`sendSession` serializes after the click, `service.ts:229-294,259-263`), so pre-send replacement IS possible client-side. No public "replace X with Y": composable pieces are `conversation.createDrafts(sessionId, files)` (public, :309-326 — image → object-URL draft + dimension probe; file → immediate upload), `releaseDraftAttachment(s)`, `inputActions.addAttachments(ids)` (append at end, no in-place swap). Validated intake (image limits, directory refusal, toast, rollback) lives in `apply.ts:460-498` and is reachable via `ComposerBarInjected.addFiles` or a replacing rail's `onAddFiles`; calling `createDrafts` directly bypasses validation. File drafts must reach `status:'ready'` before send (:241-247, submit gated by `uploadsPending`, `InputBar.tsx:84-86`); image drafts gated by `modelSupportsVision` + host `imageLimits` (`InputBar.tsx:392-396,466-480`).
- After send there is no client mutation path (queue edits accept text only, `api/session-controller/src/commands.ts:433-439`).
- Reusable UI: `ImageLightbox`, `ImagePreview`, `FileCard`/`AttachmentRail`/`DropOverlay` exist, but cross-plugin runtime imports are forbidden by dsh export discipline — shared controls live only in `ui-primitives`. **No image-edit UI exists anywhere in dsh.**

## R7 — pending

Renderer choice under the frozen-lockfile constraint; standalone package tooling (test page + vitest) — being researched.

## R7 — Dependency budget and tooling for `packages/image-editor`

**Catalog** (`pnpm-workspace.yaml:2-17`): `packages: packages/*` only (tests-helpers/, scripts/, examples/ are NOT workspace members). Catalog entries: `@deepseek-ai/cordis ^4.0.1`, `@deepseek-ai/dsh-client-{connection,modules,ui-slots,settings} ^0.2.0-rc.2`, `@deepseek-ai/schemastery ^3.18.1`, `@playwright/test ^1.62.1`, `@types/node ^22.20.0`, `@types/react ~18.3.1`, `lightningcss ^1.32.0`, `react ^18.2.0`, `tsdown ^0.22.2`, `typescript ^6.0.3`, `vitest ^4.1.8`. **No `react-dom`, no `clsx`, no canvas library in the catalog.**

**Resolved versions** (`pnpm-lock.yaml:7-50`, `node_modules/.pnpm` = 132 entries): react 18.3.1, @types/react 18.3.31, typescript 6.0.3, tsdown 0.22.14 (rolldown 1.2.5), lightningcss 1.33.0, vitest 4.1.11 (vite 8.2.2), @playwright/test 1.62.1 (+playwright 1.62.1, playwright-core 1.62.1), @types/node 22.20.1, cordis 4.0.1, schemastery 3.18.4.

**NOT available (absent from lockfile AND node_modules):**
- `fabric`, `konva`, `react-konva`, node `canvas` — zero matches
- `react-dom` / `react-dom/client` — zero matches in lockfile ⇒ React cannot render in a standalone page
- `clsx` — absent
- `jsdom`, `happy-dom` — vitest OPTIONAL peers only, not installed ⇒ no DOM-environment unit tests
- `@vitest/browser-playwright`, `@vitest/ui`, `@vitest/coverage-*` — optional peers, not installed
- **Any new dependency**: `AGENTS.md:30` "frozen pnpm installs only — no `pnpm add`, no `--no-frozen-lockfile`". Lockfile importers (`pnpm-lock.yaml:52-224`) list exactly 5 packages (`.` = `{}` at :54, `packages/utils` at :213). A NEW importer (`packages/image-editor`) is itself a lockfile change ⇒ needs an explicit user-approved lockfile update, even if it only references `catalog:` entries.
- `playwright install` — forbidden; chromium build 1234 pre-cached in `~/.cache/ms-playwright`.

**Plain-library template in repo:** `packages/utils` (`@apkawa/utils`) — the only non-plugin workspace package: devDeps only `@types/node`, `typescript`, `vitest`; scripts `build: tsc -p tsconfig.json`, `test: vitest run`, `typecheck: tsc -p tsconfig.json --noEmit`; `vitest.config.ts` node env, `include: ['tests/**/*.test.ts']`; layout `src/{index.ts,log.ts}` + `tests/log.test.ts`, one tsconfig.

**Plugin template:** `packages/dsh-global-queue` scripts (:55-61): `build: tsc -p tsconfig.json && tsdown`, `test: vitest run`, `test:e2e: vitest run --config vitest.e2e.config.ts`, `e2e:live: node ../../scripts/e2e-live.ts --package <name>`, `typecheck: tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json`. tsconfigs: `target es2024`, `module esnext`, `moduleResolution bundler`, `ignoreDeprecations "6.0"`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, `types: ["node"]`, `outDir lib`, `rootDir src`, `paths: {"@root/tests-helpers/*": ["../../tests-helpers/*"]}`; client tsconfig adds `jsx: react-jsx`, `lib: [ES2024, DOM, DOM.Iterable]`, `types: []`, `noEmit`, and maps `react` types by direct path into `node_modules/.pnpm/@types+react@18.3.31` (@types/react is NOT a devDep there — frozen installs).
- vitest configs run **environment: node** (`vitest.config.ts`, `vitest.e2e.config.ts`); package AGENTS.md: "React, no jsdom — pure logic lives in the `.ts` file that is unit-tested".

**HTML/standalone pages:** zero repo-tracked `.html` files; the only browser-executable artifacts are `lib/client/index.js` bundles that require the dsh module loader. So a standalone test page is NEW ground: build an ESM browser bundle with `tsdown` (drop the `__ModuleLoader__` banner, `external: []`) and serve it over http (ES modules do not load over `file://`; repo convention from the skills docs is `python3 -m http.server` on `127.0.0.1:8123`, artifacts in `.tmp/`). No repo script serves static files today.
- Playwright configs have **no `webServer` and no `baseURL`** (`packages/dsh-global-queue/playwright.config.ts:2-3` comment) — the URL comes from the spec itself; `testDir './tests/e2e'`, `testMatch '**/*.spec.ts'`, `workers: 1`, chromium headless, output `.tmp/playwright/<package>`. `@root/…` imports in `.spec.ts` work because Playwright 1.62.1 resolves tsconfig `paths`.
- `tests-helpers/e2e/dsh.ts` `launchDsh` requires `lib/index.js` and runs `dsh plugin --profile web add` (:141-160) ⇒ a zero-dsh package cannot use `launchDsh`; only bare `@playwright/test` works for it.

**Browser APIs:** repo packages/tests use none (`rg` exit 1 for canvas/OffscreenCanvas/Image/toBlob/createObjectURL/FileReader). Precedents exist only in read-only `dsh/`: canvas-2d render loop (`ui-sidebar-documentpreview/src/client/pdf/pdf.tsx:116,164,172,203`), `URL.createObjectURL(new Blob(...))` (`file-upload/src/client/runtime.ts:246`, `ui-conversation/.../historical-images.ts:117`), `FileReader` encode (`ui-conversation/src/client/service.ts:124-127`), `<img>` render (`ui-attachment/src/MessageImage.tsx:160`). `toBlob` / `OffscreenCanvas`: zero matches in `dsh/packages`.

**Consequence for the editor engine:** Fabric.js / react-konva are NOT installable under the frozen-lockfile rule; react-dom is absent, so a React-based editor cannot render standalone. The editor must be a framework-agnostic vanilla TS canvas-2d implementation (no npm deps, no React), mounted by the plugin inside a React tab body via a plain mount/unmount API.
