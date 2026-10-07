# research — 2026-10-04_dsh-global-queue

Context collection only (superficial scan). Findings appended per research item.

Research items:
- [x] R1: plugin package structure (how `packages/dsh-model-settings` is built/registered; host + client halves)
- [x] R2: right sidebar implementation in the Web GUI (Workspace files / New terminal; tab mechanism) — 0.2.0-rc.2 has a full dockkit tab system
- [x] R3: Send message button + context-menu extension point — covered by R2 (no slot on button; closest: conversation.input.right; dockkit TabMenu pattern)
- [x] R4: sessions: tracking, active/idle detection, start/continue a session from host, session statistics
- [x] R5: global (cross-workspace) storage + host-side RPC/webServer capabilities for a plugin
- [x] R6: shared e2e/test infra for a new plugin (covered by R1)

## R1 — plugin package structure (2026-10-04)

Repo wiring:
- `pnpm-workspace.yaml`: `packages: - packages/*` — a new package is picked up automatically.
- Root `package.json` is private; optional per-package `pnpm --filter` shims only (ddgs has none) — no root edit required for a new plugin.
- `pnpm-lock.yaml` is committed; new package → frozen `pnpm install` (store dir `./.cache/pnpm/v11`) rewrites it.
- Root `AGENTS.md` `## Projects` gets a one-line bullet per package.
- Shared e2e: `tests-helpers/e2e/dsh.ts` (`launchDsh`/`stopDsh`, `resolveDshBinary`, `ensureDshVersion`, `E2E_DSH_VERSIONS = ['0.2.0-rc.2']`; links the package into a throwaway home's `web` profile via `dsh plugin --profile web add <package-dir>`); `tests-helpers/e2e/dsh-fixture.ts` (vitest lane: `startDsh`, `pluginListed`, `rpc()` over the client wire shape); `tests-helpers/e2e/live.ts` (playwright lane); `scripts/e2e-live.ts` (manual CLI, `--package` required, `--port` 3081).

Reference package `packages/dsh-model-settings` (host + client):
- `package.json`: `name: @apkawa/dsh-model-settings`, `main: lib/index.js`, `exports` for `.` (host) and `./client` (browser bundle), `dsh.bundle.patch: ./cordis.patch.yml`, `dsh.client: { inject: [dsh-client-connection, dsh-client-modules, dsh-client-ui-slots], platform: "web" }`, `files: ["lib", "cordis.patch.yml"]`; peers = cordis + schemastery + 3 client packages + dsh-settings + react.
- `cordis.patch.yml`: YAML list, one row `- insert: - id: model-settings, name: '@apkawa/dsh-model-settings'`.
- `src/index.ts` (host): `export const name = 'model-settings'`, `makeRpcHandler`, settings watcher → autofill, self-mounted `/model-settings` prefix route on host `webServer` via nested `ctx.inject(['settings'], sctx => sctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: CHANNEL, handler }), …)))`.
- `src/client/index.ts`: `export const inject = ['slots', 'connection', 'remote']`; `apply(ctx)` registers `ctx.slots.inject('settings.section', …)` entries (`ctx.slots.register({ name, id, order, label, inject: () => face }, Component)`).
- `tsconfig.json` (host, `outDir: lib`, `rootDir: src`, excludes client/tests, maps `@root/tests-helpers/*`); `tsconfig.client.json` (noEmit, `jsx: react-jsx`, DOM libs, maps `@deepseek-ai/dsh-client-store` into `dsh/packages/client/store` for types); `tsdown.config.ts` (client bundle `src/client/index.ts` → `lib/client.js`, CJS browser, externals = platform module table, banner `window.__ModuleLoader__.load({ id: '…', factory: … })`, CSS inlined via lightningcss).
- `vitest.config.ts` / `vitest.e2e.config.ts` (e2e adds `@root/tests-helpers` alias, 120 s timeouts); `playwright.config.ts` (acceptance lane, output `.tmp/playwright/<pkg>`).
- Test lanes: `tests/unit/{server,client}/*.test.ts`, `tests/e2e/server/*.test.ts` (`describe.each(E2E_DSH_VERSIONS)` boot smoke), `tests/e2e/acceptance.spec.ts`.

Reference package `packages/dsh-web-search-ddgs` (host-only minimal): package.json minus client/tsdown/playwright; peers = cordis + schemastery only; `src/index.ts`: `name = 'web-search-ddgs'`, `inject = ['web']`, zod `Config`, `apply(ctx, config)` registers on `ctx.web.registerSearchProvider(…)`.

Registration (host):
- Installability: `package.json` declares `dsh.bundle.patch` → `cordis.patch.yml` (only manifest requirement).
- Install: `dsh plugin --profile web add <path>` (pnpm forwarder in `dsh/apps/cli/src/plugin.ts`) → installs into `$DSH_HOME/profiles/web`, `reconcilePlugins` appends package name to `dsh.profile.bundles` in profile package.json.
- Composition: profile composer (`dsh/packages/boot/app-boot/src/profile.ts`) applies each bundle's patch list; loader derives the host half from the package `.` export (`lib/index.js`), which must export Cordis face: `name`, optional `inject`, optional zod `Config`, `apply(ctx, config?)`.

Registration (client / Web UI):
- `package.json` `dsh.client` block: `platform: "web"`, `inject: [package names]` (factory-arrival order edges), optional `external`/`immediately`; bundle from `exports["./client"]` (`lib/client.js`).
- Delivery: `@deepseek-ai/dsh-client-modules` (`dsh/packages/client/modules/src/index.ts`, `src/client/manifest.ts`) scans installed packages for `dsh.client`, composes `window.__DSH_BOOT__` boot graph (rows: id/url/rev/inject/external), injects into web shell HTML; browser loads combo script; bundle runs as `window.__ModuleLoader__.load({ id, factory })`.
- UI entry: client `apply(ctx)` registers React components into slot registry (`ctx.slots.register` under `ctx.slots.inject('settings.section', …)`); services via `ctx.get('connection')` / `ctx.get('remote')` declared in `export const inject`.

Client↔host channel (confirmed):
- Plugin-owned RPC channel mounted as a prefix route on host `webServer` (NOT the built-in `rpc-host` service — broken host-side on 0.2.0-rc.2: register effect's context lacks `webServer`; that is why model-settings self-mounts).
- Host mount: nested `ctx.inject(['settings'], sctx => sctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register({ kind: 'prefix', path: '/model-settings', handler: (req, res) => handleChannelRequest(store, req, res)) }))`.
- Handler mirrors the dsh carrier: validates `client-request` envelope (zod), endpoint = pathname after prefix, dispatches `makeRpcHandler(store)(endpoint, payload)`, answers `{ type: 'server-response', rpcId, result }`, result `{ ok: true, value }` | `{ ok: false, error: { code, message, details } }` (closed-code contract, `'internal'` catch-all).
- Client caller: `connection.rpc.call(CHANNEL, endpoint, payload)` on `ConnectionHandle` from `@deepseek-ai/dsh-client-connection/client` → `POST /model-settings/<endpoint>` with `{type:'client-request', rpcId, method, payload}` envelope (`dsh/packages/client/connection/src/client/rpc.ts`).
- e2e helper `tests-helpers/e2e/dsh-fixture.ts` `rpc()` speaks the same wire shape — channel testable without a browser.
- Reverse events: client listens on `remote` service's forwarded `settings/document-updated(ns, revision)` events (dsh event forwarding, not plugin channel).

New package `packages/dsh-global-queue` checklist:
- Host-only minimal set: `package.json` (`@apkawa/dsh-global-queue`, `main: lib/index.js`, exports `.`, `dsh.bundle.patch`, files, peers cordis+schemastery, devDeps typescript/vitest, scripts build/typecheck/test/test:e2e/e2e:live), `cordis.patch.yml` (`- insert: - id: global-queue, name: '@apkawa/dsh-global-queue'`), `src/index.ts` (Cordis face `name = 'global-queue'`, `inject`, zod `Config`, `apply`), `tsconfig.json`, `vitest.config.ts`, `vitest.e2e.config.ts`, `tests/unit/server/*.test.ts`, `tests/e2e/server/boot.test.ts`, `AGENTS.md`, `README.md`; root: frozen `pnpm install` (lockfile), one bullet in root `AGENTS.md` `## Projects`.
- Client half additions: `src/client/index.ts` (`inject = ['slots', 'connection', …]` + `apply(ctx)` registering slot entries), `tsconfig.client.json`, `tsdown.config.ts`, `package.json` `exports["./client"]` + `dsh.client` block + react/tsdown/lightningcss/@playwright/test devDeps, `playwright.config.ts`, `tests/e2e/acceptance.spec.ts`.

Scripts (from package dir, never bare `tsc` for typecheck):
- `pnpm build` (host `tsc` → `lib/`; client via `tsdown`, `clean: false` so it must not wipe tsc output); `pnpm typecheck`; `pnpm test` (unit); `pnpm test:e2e` (real isolated `dsh web` 0.2.0-rc.2, DSH_HOME under `.tmp/dsh-e2e-*`; + `pnpm exec playwright test` with a client half); `pnpm e2e:live` (manual throwaway, port 3081).
- Host changes need a full `dsh web` restart; client-only changes need a page reload.

Unresolved (R1):
- Exact minimal `dsh.client.inject` list (model-settings declares `[dsh-client-connection, dsh-client-modules, dsh-client-ui-slots]`; a new plugin should declare only what it consumes — validated in `dsh/packages/client/modules/src/index.ts`).
- Self-mounted prefix route is a workaround for the 0.2.0-rc.2 `rpc-host` bug; standard `connection.rpc.handle(channel, handler)` is upstream-intended but broken host-side on rc.2.
- `dsh.client.external` / `immediately` optional, unused by repo packages.
- `hmr` service read in model-settings is specific to its in-event settings writes; not needed generally.

## R2 — right sidebar in dsh 0.2.0-rc.2 (2026-10-04)

NOTE: the `dsh/` checkout is now at 0.2.0-rc.2 (branch `0.2.0-rc.2`). Earlier 0.1.2-rc.1 findings (single `details` slot, no tabs) are SUPERSEDED.

Right sidebar (right column) in 0.2.0-rc.2:
- Owned by `@deepseek-ai/dsh-client-ui-sidebar-right` (`dsh/packages/client/ui-sidebar-right/`).
- Frame column = slot `rightbar` (single, root scope) declared in `dsh/packages/client/ui-layout/src/client/index.ts`; `RightbarRoot` registered into it (`ui-sidebar-right/src/client/index.ts`, apply ~168-210).
- Per-session seat = slot `rightbar.session` (single, session scope), filled by `RightbarSeat` (`ui-sidebar-right/src/client/shell/SidebarRight.tsx`). The seat renders:
  - tab bodies via `renderSlot('sidebar.right.pane.tab', …)`
  - tab titles via `renderSlot('sidebar.right.pane.tab.title', …)`
  - tab right-click menu items via `renderSlot('sidebar.right.tab.menu.item', …)` (SidebarRight.tsx:334-335, wired as TabPanel's renderTabMenuItems).
- Collapsed-rail expand button `ExpandButton` registered into `conversation.session.header.corner`.
- "Workspace files" / "New terminal" are NOT a static panel list — they are guide-page capsules contributed by tab types:
  - "Workspace files": `ui-sidebar-files` (`dsh/packages/client/ui-sidebar-files/src/client/definition.tsx`, guide entry id 'workspace', commandId 'workspace.files'; locale `guide.title` = "Workspace files" in ui-sidebar-files/src/client/locales.ts:49).
  - "New terminal": `ui-sidebar-terminal` (`dsh/packages/client/ui-sidebar-terminal/src/client/index.ts`, guide entry id 'new'; locale `new` = "New terminal" in locales.ts:33).

Tab system (dockkit):
- `dsh/packages/client/ui-dockkit/` provides types: `TabRecord { id, kind, contentId, title }`, `PaneNode`/`SplitNode`, `LayoutState` (recursive split tree + floating panes), `DockMode 'push'|'fullscreen'`, components `TabLayout`/`TabPanel`/`TabMenu` (src/contract/types.ts; src/components/TabPanel.tsx).
- State owner: per-session store `createSidebarRightStore()` (`ui-sidebar-right/src/client/stores.ts`); `SidebarRightState { bySession: Record<SessionId, SurfaceState> }`, `SurfaceState { layout: LayoutState, expanded, history }`. Controller `createSidebarRightController` (service.ts:90-126) syncs cross-session `openTabs` inventory and `tabDomain`.
- Tab types register in TWO stages (header comment of ui-sidebar-right/src/client/index.ts):
  1. `ctx.sidebarRightTabs.register(SidebarRightTabDefinition)` into `SidebarRightTabRegistry` (tab-registry.ts). Definition fields (tab-registry.ts:93-138): `id` (unique impl id — becomes the keyed slot key), `kind` (openTab discriminator), `multiple`, `keepMounted`, `patterns` (resource-address globs), `canOpen(address)` veto, `title(address)`, `guide` entries (`SidebarRightGuideEntry { id, order, title, description?, icon?, commandId? }`). Resolution is VS Code editor-resolver style: glob claim + canOpen + priority bands (extension > builtin > fallback) + registration order (tab-registry.ts:258-279). Service provided via `ctx.reflect.provide('sidebarRightTabs', tabs)` (index.ts:150).
  2. Keyed slot registrations under the same id: body into `sidebar.right.pane.tab`, title into `sidebar.right.pane.tab.title` (both keyed, session scope; declared in contract/slots.ts:50-78).
- Body receives `useTabInfo` hook through the slot's inject face (tab-info.ts:29-55): `{ sidebar: {expanded, fullscreen}, panel: {id}, tab: TabRecord & { visible, navigation: {address, params, revision}, signal, actions: {bindCommands, openResource, openTab, close}, refreshShortcut } }`.
- Guide tab: kind 'guide', address `sidebar://<kind>` (contract/seed.ts:36-46); each type's `guide` array feeds the guide page; entries render through keyed slot `sidebar.right.tab.guide.entry`.
- Public service `ctx.sidebarRight` = ISidebarRight (service.ts:200-259): `openResource(address, {paneId, preferNewPane, revealIfOpened, replaceTab, params})`, `openTab(kind, options)`, `close(tabId)`, `active()`, `isExpanded()`, `toggleExpanded()`, `focus(tabId)`, `split(paneId?)`, `float(tabId, rect?)`, `dock(paneId)`, `registerCloseHandler(kind, fn)`, plus `openTabs`, `tabDomain`, `mounted`, `tabsIn(sessionId)`.
- Worked sketch for a third-party plugin tab type:
  ```ts
  const ID = 'com.example/mypane'
  ctx.sidebarRightTabs.register({ id: ID, kind: 'mypane', priority: 'extension',
    title: () => t('title'), guide: [{ id: 'open', order: 30, title: () => t('guide') }] })
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale: NS }, Body))
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, Title))
  ctx.sidebarRight.openTab('mypane')
  ```
  (ui-sidebar-documentpreview is the in-repo live proof of this exact pattern.)

Slot ids relevant to UI extension (0.2.0-rc.2):
- ui-layout: `sidebar` (single/root, left column), `main` (keyed/root, center), `rightbar` (single/root, OCCUPIED by ui-sidebar-right — plugins do not register here), `shell.overlay` (list/root), `shell.leading` (single/root).
- ui-sidebar-right: `rightbar.session` (single/session), `sidebar.right.pane.tab` (keyed/session, tab bodies, key = type id), `sidebar.right.pane.tab.title` (keyed/session, tab chip titles), `sidebar.right.tab.guide` (chain/session, whole-guide replacement), `sidebar.right.tab.guide.entry` (keyed/session, one guide capsule), `sidebar.right.tab.menu.item` (list/session, extra tab right-click menu items; owner props {tab, dismiss}).
- ui-sidebar: `sidebar.toggle.badge`, `sidebar.brand.mark`, `sidebar.brand.name`, `sidebar.panellist` (list), `sidebar.workspaces`, `sidebar.settings`, `sidebar.footer.action` (list).
- ui-workspace: `conversation.hero.workspace.directoryFlow`, `sidebar.workspaces.directoryFlow`, `sidebar.session.row.leading` (list), `sidebar.session.row.hover` (list), `sidebar.workspaces.session.menu.item` (session row context menu), `sidebar.workspaces.session.row.action` (list).
- ui-conversation: `main.conversation`, `conversation.session`, `conversation.header`, `conversation.session.header`, `.lineage`, `.actions`, `.utilities`, `conversation.header.leading`, `conversation.session.header.corner`, `conversation.view` (list), `conversation.composer` (chain), `conversation.hero.*`, `conversation.input.dock` (list), `conversation.input.overlay` (list), `conversation.composer.dock` (list), `conversation.input.left` (list), `conversation.input.right` (list), `conversation.input.activity` (single), `conversation.composer.bar` (single), `conversation.input.attachments`, `conversation.input.plan`, `conversation.input.permission`, `conversation.input.model`, `conversation.content` (+ nested).
- ui-chat: `conversation.chat.node` (keyed), `conversation.message.images`, `conversation.chat.commandview` (keyed), `conversation.chat.turnTail` (list).
- ui-tool: `tool.call.toolview` (keyed), `tool.call.images`. ui-approval: `conversation.approval.detail`. ui-user-questions: `conversation.plan-review.actions` (list).
- ui-settings: `settings.launcher`, `settings.trigger`, `settings.header`, `settings.action` (list), `settings.close`, `settings.section` (list), `settings.plugins.tab` (list), `settings.onboarding` (list), `settings.general.item` (list).
- ui-sidebar-files: `sidebar.right.tab.files.actions` (list). ui-sidebar-documentpreview: `sidebar.right.tab.document` (+ .actions, .unpreviewable, .action, .office.pdf).

Send button + context menu (R3 covered here):
- Send button is a plain `<button>` in `dsh/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:476-495`, rendered by ComposerBar (registered into slot `conversation.composer.bar`). `onClick={onPrimary}` is package-internal. NO `onContextMenu`, NO slot on the button itself.
- BUILT-IN queue behavior already exists: while the addressed agent is busy, the primary button relabels to "Queue" (`input.send.queue`) or "Steer" (`input.send.steer`) and its click queues/steers the draft. (Our global queue is a different feature — naming must not clash.)
- No extension point attaches a context menu to the button. Closest composer extension slots (all list, session scope): `conversation.input.right` (controls right of input row — model selector seat), `conversation.input.left`, `conversation.composer.dock` (row below input), `conversation.input.overlay`. None registered into by a plugin today. A true right-click menu on the Send button requires an upstream InputBar change (add onContextMenu + an item slot).
- In-repo right-click menu pattern to emulate: dockkit `TabPanel.tsx:308` — right-click on a tab chip opens `TabMenu`; extra items contributed through slot `sidebar.right.tab.menu.item` (wired at SidebarRight.tsx:334-335). Menu primitives `Menu`/`MenuSurface` live in ui-primitives.

App state for plugin components (0.2.0-rc.2):
- `useSessions` (session list + selection, global) — ui-session/src/client/index.ts (~158).
- `useSession`, `sessionId: SessionId`, `useProjection` (session scope; session-maybe variants) — ui-session index.ts:163-179.
- `useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>` (global) — ui-workspace/src/client/index.ts:70.
- `usePanelInfo: HostObservable<PanelInfo>` (global) — ui-layout.
- `useStore`, `renderSlot`, `renderFactorySlot`, `t` — standard kit (ui-slots / ui-renderer; `t` present when a registration declares `locale:`).
- Layout service `ctx.layout` = ILayout (`ui-layout/src/client/service.ts:28-54`): `panelInfo`, `selectPanel`, `beginNavigation`, `toggleSidebar`, `openRightbar(track, fullscreen)`, `closeRightbar()` (replaces 0.1.2-rc.1 openDetails/closeDetails).
- Rightbar service `ctx.sidebarRight` (ISidebarRight, see TABS) — every entry into the column (guide entries, file tree, tool rows) funnels through openResource/openTab.

Unresolved (R2/R3):
- No direct slot on the Send button for a right-click "Add to queue" menu; closest = `conversation.input.right`/`conversation.input.left` list slots (no plugin registered into them today). A context menu on the button itself needs an upstream InputBar change.
- `SidebarRightTabInjected` / `SidebarRightTabMenuOwnerProps` re-exported from ui-sidebar-right /client entry, but a plugin reaches the body's data only through the `useTabInfo` hook (inject face).

## R4 — sessions from the host side, dsh 0.2.0-rc.2 (2026-10-04)

Session model:
- Sessions are event-sourced, append-only logs; the log is the source of truth.
- Live store: `SessionStore` = `ctx.sessions` (`dsh/packages/core/session/src/index.ts`): `create/prepare/enter/announce/get(id)/list()` (every LIVE session, cross-workspace) /`fork/flush`; events `'session/created'`, `'session/disposed'`, `'session/event'` (payload `(session, event)`), `'session/flush'`.
- `SessionHeader` (`packages/core/session/src/types.ts`): `{ version, id, createdAt /* epoch ms */, cwd?, parentSession?, isSeeded, origin?: 'subagent', delegationDepth?, agentPreset? }`.
- `SessionEvent`: `{ seq, time /* epoch ms */, data, ignorable? }`; key types: `turn/start`, `turn/end` (data.reason: completed|aborted|blocked|error|max-tokens|interrupted|forked), `step/start|end`, `user/message`, `assistant/message`, `tool/call|result`, `session/title`, `model/selection`.
- `SessionId` = branded string (randomUUID pattern in `packages/acp/acp/src/session.ts`).
- Durable store: `SessionPersistence` = `ctx.sessionPersistence` (`packages/session/session-persistence/src/index.ts`): `create/open/flush/stat(id) -> { header, revision, eventCount?, sizeBytes? }`, `list()` = EVERY stored session, cross-workspace.
- On-disk (JSONL): `<root>/<projectKey(cwd)>/<encoded id>/<generation log>` (`packages/session/session-persistence-jsonl/src/format.ts`); zstd frames.
- Live-preferred corpus: `SessionQueryEngine` = `ctx.sessionQuery` (`packages/session-query/session-query/src/index.ts:106`): `listSessions()` -> `SessionRecord { header, live, persisted }`, `readSession(id)`, `readTitle(id)`, `listEvents(id)`, `observeSession(id)`, `searchSessions()`. Optional service (backend-provided); BFF reads it via `ctx.get('sessionQuery')` (`packages/api/session-controller/src/list.ts:170`).
- Agent id === session id (`AgentRegistry` = `ctx.agents`).

Active/idle:
- `Agent.status: 'idle' | 'running'` (`packages/core/agent/src/runtime-types.ts:109`); `'agent/status'` event on every transition, payload `{ agent, status }`, subscribe with plain `ctx.on('agent/status', …)` (pattern: `packages/compaction/compaction-basic/src/index.ts:178`).
- `agent.whenIdle(): Promise<void>`.
- Durable: turn open iff `turn/start` without matching `turn/end`.
- "No session in any workspace is active" = `ctx.agents.list().every(a => a.status === 'idle')`; same derivation as the BFF `running` flag (`packages/api/session-controller/src/list.ts:114`).
- Secondary: `SessionActivity` / `'workspace/session-activity'` (`packages/workspace/workspace/src/types.ts:51`) — activity families turn/job/subagent/schedule.

Start/continue (reference: ACP package, `packages/acp/acp/src/session.ts`, injects `['agents', 'llm', 'sessionPersistence', 'sessions']`):
- NEW session: `ctx.agents.create(options)` -> `AgentHandle { agent, dispose() }` (`packages/core/agent/src/index.ts:391`): `{ sessionId /* caller-preallocated */, parentAgent?, meta: { cwd /* validated absolute path — links session to workspace */, … }, inheritedEventCount?, seed?, agentOptions?, signal?, setup? }`.
- CONTINUE persisted: `ctx.agents.resume({ resumeSessionId, … })` (`packages/core/agent/src/index.ts:410`); pre-check `ctx.sessionPersistence.stat(id)`; reject `header.origin === 'subagent'`, `parentSession` set, cwd mismatch (ACP pattern).
- CONTINUE live: `ctx.agents.get(id)` -> Agent, then queue a prompt.
- PROMPT: `agent.followup(message)` queues a UserMessage and wakes the agent; message = `createUserMessage({ content: TextBlock[], source: { kind: 'user' } })` from `@deepseek-ai/dsh-llm` (`packages/llm/llm/src/message.ts:246`; usage `packages/acp/acp/src/session.ts:291-299`). Other verbs: `send`, `steer`, `inject`, `cancel`.
- COMPLETION: `agent.whenIdle()` and/or `ctx.on('session/event', (s, e) => e.type === 'turn/end' …)` with `e.data.reason`.
- `setup` composes, never drives — drive only after `create()` resolves.

Statistics:
- `sessionStats` projection (`packages/session/session-stats/src/types.ts`): `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }` — folded over the complete durable log; unit `'sessionStats'`.
- `tokenUsage` projection (`packages/llm/token-meter/src/projection.ts:13`): `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` (durable cumulative); per-call `TokenUsage` on `assistant/message` events.
- Read: `ctx.sessionProjections.stateOf(session, key)` / `.snapshot(session, keys?)` -> `{ asOfSeq, values }` (`packages/session/session-projection/src/index.ts`).
- Cold sessions: `ctx.sessionProjectionCache.cachedSnapshot(header, keys?)` (`packages/session/session-projection-cache/src/index.ts:161`) — zero-I/O last durable checkpoint rows ("possibly stale, never wrong"); BFF uses it (`packages/api/session-controller/src/list.ts:146-159`).
- Message count: fold `user/message`+`assistant/message` from the log, or `ctx.sessionQuery.listEvents(id)`.
- Wall time: `SessionEvent.time` epoch ms; `header.createdAt` epoch ms; BFF `sessionListMetadata` projection keeps `{ blank, lastPromptAt }`. NO single "total duration" field — derive createdAt → last event time, or `llmMs + toolMs` as activity-time proxy. NO cost field anywhere — tokens only.

Workspaces:
- `WorkspaceRegistry` = `ctx.workspaceRegistry` (`packages/workspace/workspace/src/index.ts:115`): `create(path, title?)`, `get(id)`, `list()`, `delete(id)`, `resolveByPath(path)`, `attachSession`, `pinSession`, …
- `Workspace` (`packages/workspace/workspace/src/types.ts:63`): `{ id /* branded randomUUID */, path /* canonical fs.realpath */, title, createdAt, updatedAt, sessionIds: readonly SessionId[] }`.
- Session ↔ workspace: session belongs to the workspace whose canonical `path` equals the session header `cwd` (membership header-validated). "Start a session in workspace W" = `resolveByPath(path)` (or list) then `agents.create({ meta: { cwd: W.path } })`.

Cordis inject names for a session-driving host plugin:
- `agents` (AgentRegistry), `sessions` (SessionStore), `sessionPersistence`, `sessionProjections`, `sessionProjectionCache`, `sessionQuery`, `workspaceRegistry`, `llm`. Events need NO injection: `ctx.on('agent/status')`, `ctx.on('session/event')`, `ctx.on('session/disposed')`, `ctx.on('agent/disposed')`.
- ACP's authoritative pattern: `['agents', 'llm', 'sessionPersistence', 'sessions']`.
- Optional-service reads: `ctx.get(name)`; declared injections: `ctx.<name>`.

Web UI deep-link:
- Navigation is in-app state, NOT a URL: `ctx.uiWorkspace.openSession(sessionId)` (`packages/client/ui-workspace/src/client/navigation.ts:200`); no hash/route scheme for sessions exists. Queue UI addresses a session by SessionId and calls `uiWorkspace.openSession(id)` from the browser half.

Unresolved (R4):
- `CreateAgentOptions.agentOptions` (model selection) not fully enumerated — start with defaults.
- No cost field anywhere; tokens only.
- `session-query` lives at top-level `packages/session-query/` (group dir).
- `cachedSnapshot` only needed for sessions neither live nor resumed.

## R5 — global (cross-workspace) storage + host-side RPC (2026-10-04)

Global storage:
- dsh has NO per-plugin data directory. Precedent for host-side dotfiles: `.credentials.yaml` directly under `$DSH_HOME`.
- Chosen location for the queue: `$DSH_HOME/.global-queue.json`, file mode `0o600`.
- DSH_HOME resolution: `resolveDshHome()` from `@deepseek-ai/dsh-home-paths` (env `DSH_HOME` > `~/.dsh`). Config-expression default: `!!js dshHomePath('…')`.
- Atomic persistence: `withFileLock` + `writeFileAtomic` from `@deepseek-ai/dsh-atomic-write` (cross-process lock + tmp-file/rename write). Both `@deepseek-ai/dsh-atomic-write@0.2.0-rc.2` and `@deepseek-ai/dsh-home-paths@0.2.0-rc.2` are published and already present in the repo `pnpm-lock.yaml` (pinned rc versions — declare exact `0.2.0-rc.2` in `dependencies`, frozen install).

Host-side RPC:
- Covered by the R1 "Client↔host channel (confirmed)" section: self-mounted prefix route on the host `webServer` (the built-in `rpc-host` effect is broken host-side on 0.2.0-rc.2), client calls `connection.rpc.call(CHANNEL, endpoint, payload)` → `POST /<channel>/<endpoint>` with the `client-request` envelope; e2e-testable without a browser via the `rpc()` helper in `tests-helpers/e2e/dsh-fixture.ts`.

## R6 — shared e2e/test infra (2026-10-04)

Covered by R1 ("shared e2e" + "New package checklist" + "Scripts" bullets): `tests-helpers/e2e/{dsh,dsh-fixture,live}.ts`, `scripts/e2e-live.ts`, version matrix `E2E_DSH_VERSIONS = ['0.2.0-rc.2']`, isolated homes under `.tmp/dsh-e2e-*`, provisioned versions under `.tmp/dsh-versions/<version>`.
