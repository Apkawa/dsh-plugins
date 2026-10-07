# Research: 2026-10-05_global-queue-improvements

Context gathering for the 6 dsh-global-queue improvements (see draft.md). Research is superficial: files, dependencies, fixed constraints, existing solutions. No design, no solutions.

Research items:

- R1: dsh-global-queue client UI — "Add to queue" button, the 2 extra buttons after click, queue panel styles (items 1, 3, 6)
- R2: dsh-model-settings styling reference — button-with-icon patterns (item 1)
- R3: right sidebar "Start" tab — "Workspace files" / "New terminal" entries (item 2)
- R4: queue state machine — queued → running transition, no-activity case (item 4)
- R5: session creation + "open session" link — new session vs continuation (item 5)
- R6: e2e infra + fake provider — `profiles/web/cordis.patch.yml` on 0.2.0 (item 5)

---

## R1 — dsh-global-queue client UI (items 1, 3, 6)

All paths under `packages/dsh-global-queue/` unless noted.

**Client wiring (`src/client/index.ts`)**
- `index.ts:113-117` — registers right-sidebar tab: `sidebarRightTabs.register({ id: '@apkawa/dsh-global-queue', kind: 'global-queue', title: () => 'Show queue' })`.
- `index.ts:121-125` — tab body via `slots.inject('sidebar.right.pane.tab', …)`; injects `{ openSession: (id) => uiWorkspace.openSession(id) }` into `QueuePane`.
- `index.ts:130-134` — composer control: `slots.inject('conversation.input.right', …)` registers `AddToQueue` (id `global-queue-add`, order 10).
- Slot `conversation.input.right` is `{ kind: 'list'; scope: 'session' }` (`dsh/packages/client/ui-conversation/src/client/contract/slots.ts:203`). It renders **only inside a live session** (`dsh/.../skeleton/InputBar.tsx:452-454`) — the control never appears in the hero/no-session state.

**AddToQueue (`src/client/AddToQueue.tsx`)**
- `AddToQueue.tsx:24-38` — component: reads `draft` via `useInput`, `workspacePath` via `useWorkspaces` (workspace whose `sessionIds` includes current `sessionId`), local `open` state.
- Markup `:40-56`: main `<button data-testid="global-queue-add">Add to queue</button>` only toggles `open`; when open, a `<span role="menu" className="absolute">` with two menu items:
  - `data-testid="global-queue-add-current"` → `choose(props.sessionId)` (continuation, `targetSessionId = sessionId`).
  - `data-testid="global-queue-add-new"` → `choose(null)` (new session; host watcher creates it).
- `choose` (`:30-38`): no-op on empty draft/unknown workspace; RPC `add { text, workspacePath, targetSessionId }`; then `inputActions.setDraft('')` + `refresh()`.
- Contract mirrored in `tests/e2e/acceptance.spec.ts:40-53, 227-237`.

**QueuePane (`src/client/QueuePane.tsx`)**
- `QueuePane.tsx:11-24` — pane: local `items` from shared store, `reorder`/`remove` RPCs.
- `:26` empty state; `:27-40` list of `Row`s.
- `Row` `:51-131`: draggable row (`data-testid="global-queue-row"`, HTML5 DnD reorder), inline edit (`global-queue-edit`, Enter/blur commits `editText` RPC), status label (`global-queue-status`, raw `queued|running|done|interrupted`), Remove button, stats (`global-queue-stats`, `format.ts:10-15`), and "open session" link `:117-128` — only when `item.sessionId !== undefined`; it calls injected `uiWorkspace.openSession(sessionId)` (href `#`, `preventDefault`).

**Styling state (item 6)**
- **No CSS file in the package**, no CSS imports, no inline styles. Only class names: `relative inline-flex` (AddToQueue.tsx:41) and `absolute` (:46) — **inert**: the dsh app has no Tailwind (no tailwind in `dsh/package.json`); it styles via **CSS modules + `clsx` + `--dsh-*` design tokens** (e.g. `dsh/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css:314` `.add` for the composer `+` button, imported in `InputBar.tsx:41`). Hashed CSS-module names mean the plugin's Tailwind-style classes match nothing; the "menu" renders inline in flow, not as an overlay.
- Everything else is bare elements keyed only by `data-testid` (`global-queue-pane/row/status/edit/stats/open`, `global-queue-add*`). Net: unstyled default browser controls.
- Full DOM-hook contract (no styling hooks) documented in `tests/e2e/acceptance.spec.ts:15-59`.

**Composer context (item 3)**
- Standard props for session-scope slots (`dsh/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:1106-1122`): `sessionId`, `useInput`, `inputActions`, `useWorkspaces`, plus `useSessions`, `useChat`, etc. Plugin consumes only `sessionId`, `useInput`, `inputActions.setDraft`, `useWorkspaces`.
- `InputState` (`dsh/.../ui-conversation/src/client/contract/input.ts:255-269`): `draft`, `attachmentIds`, `draftRev`, `phase` (`plain|adjudicating|claimed|submitting`), `claim?`, `occurrences`, `queue` (per-session inbox). **No "New session" vs "continuation" signal** in the input state.
- "New session" in dsh is a **sidebar action**, not composer state: `dsh/packages/client/ui-sidebar/src/client/SidebarRoot.tsx:259-277` (`css.newSession` button → `startSession()`), also `HeaderLeadingControls.tsx:28-46`.
- So the only ambient signals are `sessionId` + `useWorkspaces` + `useInput`; the current "new vs continuation" choice is made purely by the second menu button.

**Not determined (R1)**
1. How a Cordis client plugin bundle can load its own CSS (no convention found in `cordis-client-runner`) — RESOLVED by R2.
2. Live DOM verification of the inert classes.
3. Exact on-screen visual state (no screenshot taken).

## R2 — dsh-model-settings styling reference (item 1)

**How model-settings ships CSS**
- `packages/dsh-model-settings/src/client/ReasoningSection.tsx:17` — `import css from './reasoning-section.module.css'`; classes applied as `css.<name>`. Ambient types in `src/client/css-modules.d.ts`.
- `packages/dsh-model-settings/tsdown.config.ts` — vendored **`dsh-css-inline`** plugin (mirrors `examples/tmp/dsh-stickers/tsdown.config.ts`) + `lightningcss` devDep: each `*.module.css` is compiled (`cssModules: { pattern: '[hash]_[local]' }`, minified) and replaced by a virtual module that (a) injects `<style data-plugin="@apkawa/dsh-model-settings" data-plugin-css="<tagId>">` into `document.head` at factory execution (deduped, HMR-safe) and (b) exports the local→hashed class map. Plain `.css` gets the same treatment.
- No `clsx` dependency — one `css.*` class per element; `docs/ai/ui-guideline.md` advises a local `cx(...parts)` helper over a new dep.
- Host side only *books* the tag: `dsh/packages/client/modules/src/client/system.ts:71-81` (`claimStyles`), `manifest.ts:374-375` (ids stored for removal on unload). No host-side stylesheet API for static plugins. `cordis-client-runner`'s `styles.insert(css)` (`evaluator.ts:78-112`) is for dynamic model-authored packages only — not applicable.

**Key enabler for restyling (item 1): platform externals**
- `dsh/packages/client/web/src/platform.ts:8-14` — `PLATFORM_MODULES` = react, react/jsx-runtime, react-dom, react-dom/client, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, **`@deepseek-ai/dsh-client-ui-primitives`** (+ dockkit). model-settings' tsdown external list matches.
- **A plugin can import shared ui-primitives directly** (`Button`, icons, `Tooltip`, `StateDot`, …) with shared identity — no bundling/copying. `clsx` is NOT a platform module → vendor a tiny local `cx` if needed.

**Styled-button examples**
- model-settings primary capsule: `ReasoningSection.tsx:225-227` + `reasoning-section.module.css:153-165` (h36 r18, `--dsw-alias-button-primary-fill/-hover`); dense secondary `:168-181` (h28 r14, border `--dsw-alias-border-l2`); focus ring `:189-197` (`box-shadow: 0 0 0 2px var(--dsw-alias-border-l3)`); CSS-drawn chevron `:221-234` (border-right/bottom rotated, transition 120ms).
- dsh shared `Button` atom: `dsh/packages/client/ui-primitives/src/Button.tsx:27-35` — `variant: 'primary'|'ghost'|'outline'|'toolbar'`, `size: 'md'|'sm'`, `icon?: ReactNode` (leading 16px), `clsx(css.button, css[variant], css[size], className)`; CSS in `Button.module.css` (`.md` h36, `.sm` h28 r`--dsw-radius-sm`, `.primary`/`.outline`/`.icon` 16px).
- Icon pattern: `dsh/packages/client/ui-primitives/src/icons/index.tsx:37-52` — hand-written SVG React components, `viewBox 0 0 16 16`, `stroke="currentColor"`, `size` prop (default 16), Regular (1) / Medium (1.3) weight exports. Small one-off glyphs inlined in the component (e.g. InputBar send/stop `InputBar.tsx:476-495`).
- Composer `+` icon button: `InputBar.tsx:421-432` (`css.add`, 28px circle, `IconPlusOutlineMedium size={14}`).

**Design tokens to reuse (`--dsw-alias-*` family, `dsh/packages/client/ui-theme/src/styles/design-platform.css`)**
- Text: `--dsw-alias-label-primary/-secondary/-tertiary/-caption/-dimmed/-primary-foreground`
- Borders: `--dsw-alias-border-l1…l4` (l2 cards/inputs, l3 outline buttons + focus ring)
- Surfaces: `--dsw-alias-bg-layer-1/2/3`; interaction: `--dsw-alias-interactive-bg-hover/-active`
- Buttons: `--dsw-alias-button-primary-fill/-hover`, `-info-fill/-hover`, `-tool-bar-fill/-hover`, `-ghost-active-*`, `-contrast-fill`
- State: `--dsw-alias-state-error-primary/-secondary`, `-success-primary`, `-warn-primary`, `-business-primary`, `-idle-primary`
- Scrollbars: `--dsw-alias-scrollbar-bg-l1/l2`, `-hover-l1/l2`
- Radius: `--dsw-radius-xs/sm/md/lg/xl/panel` (4/8/12/16/20/28); elevation: `--dsw-elevation-stroke(-color)`, `-panel/-prominent/-soft`; focus: `--dsw-focus-ring-color/-width`
- Settings design language (docs/ai/ui-guideline.md): body 14/22, caption 12/18; capsule h36 r18 (md) / h28 r14 (dense); inputs h32 r8; cards border-l2 r12 pad 12–14; gaps 4/8/12; focus ring 2px border-l3; `corner-shape: round` with pills; reduced-motion guard.
- `--dsh-*` app-layout tokens are NOT a plugin-facing family — stick to `--dsw-alias-*` + `--dsw-radius-*`/`--dsw-elevation-*`.

**Not determined (R2)**
- InputBar `.add`/`.chip` hover rules between lines 328–355.
- Icon rendering inside non-Button ui-primitives (`Menu`, `SegmentedControl`).
- `dsh-css-inline` treatment of plain non-module `.css` (only `.module.css` used today).
- Purity-gate behavior for type-only `@deepseek-ai/*` imports (presumed allowed).

## R2b — `docs/ai/ui-guideline.md` (user-designated UI reference; items 1, 6)

Doc: 166 lines, written for the browser half of a dsh plugin; first consumer `ReasoningSection` (v2). Sections: 1 design system location, 2 CSS→bundle plumbing, 3 settings design language numbers, 4 token cheat-sheet, 5 patterns, 6 do/don't, 7 as-built.

**Hard rules (do/don't, `docs/ai/ui-guideline.md:114-133`)**
- Do: CSS Modules next to the component + local `cx()`; presentation only in CSS (inline only for local custom props); colors/shadows/fonts only via `--dsw-alias-*` + theme tokens; `box-sizing: border-box` on every control (app has no global reset); focus visible; reduced-motion honored.
- Don't: literal colors/hex (incl. `var(--x, #hex)` fallbacks; static `--dsw-static-*` not for components); theme selectors in plugin CSS; global/`:global` selectors without reason; component libs/Tailwind/new deps (clsx → local helper); own page-padding (panel provides padding/scroll).
- Focus = `outline: none` + `box-shadow: 0 0 0 2px var(--dsw-alias-border-l3)`; disabled = `opacity: 0.4` + `cursor: default`; motion only via `--ds-ease-in-out` + duration tokens.
- Authoritative on disputes: `dsh/docs/web-styling.md` (39 lines) — CSS Modules + clsx, no libs/Tailwind; menus must use `Menu` or wrap in `MenuSurface` (`:26`); elevated surfaces: `border: 0` + `box-shadow: var(--dsw-elevation-*)`, never border+shadow together (`:25`); neutral borders 0.5px (`:29`).

**Numbers for the three queue surfaces**
- Compact composer button: sm capsule h28 r14 pad `0 10px` 12/18 (`:57`); `Button` primitive variants `primary|ghost|outline|toolbar`, `icon` = leading 16px slot (`dsh/packages/client/ui-primitives/src/Button.tsx:23`, `Button.module.css:71-77`).
- Menu/dropdown: doc `:61` says bg `--dsw-specific-menu`, shadow `--dsw-shadow-lv3`, r12, item min-h 40 r10, hover `interactive-bg-hover`; pattern source `Menu.module.css` (`:106`). **Drift:** current `Menu.module.css` items are min-h 34 / `--dsw-radius-md` / card `--dsw-elevation-prominent`. `Menu.module.css` details: `.list` absolute `top: calc(100% + 4px)`, `min-width: 144px` (`:28-35`), `.portal` z-1100 (`:41-46`), `.sideTop`/`.alignEnd` (`:49-57`), `.item` 13/20 gap 6 pad 6/8 (`:95-110`), `.denseList`/`.compactList` (`:124-161`), `.itemIcon` 14px `--dsw-alias-menu-icon` (`:168-176`), `.separator` (`:253-257`).
- Scrollable list: `overflow-y: auto` + `max-height`, themed scrollbar `--dsh-scrollbar-thumb(-hover): var(--dsw-alias-scrollbar-bg-l2/-hover-l2)` (`:72-74`); exemplar `.candidateList` (`ModelsSection.module.css:685-694`: gap 2, max-h 320, rows r-md, label flex gap 8 pad 6/8); row pattern "title+desc+control" (`examples/tmp/ui-status-label/src/client/StatusLabelRow.module.css`: gap 8, hairline `border-l2`, title 14/22, desc 12/18); status via `state-error/success/warn-*` tokens.
- Scrollable container + panel: hairlines `border-l2`; cards border-l2 r12 pad 12–14; gaps 4/8/12; body 14/22, caption 12/18.

**Build plumbing (confirmed)**: `dsh-css-inline` tsdown plugin + `lightningcss` devDep (reference config `examples/tmp/dsh-stickers/tsdown.config.ts`); `src/client/css-modules.d.ts` needed; purity gate — value imports only from PLATFORM_MODULES (react, cordis, dsh-client-store, ui-slots, **ui-primitives**, …).

**Gaps (relevant)**
- Doc never mentions **icons** (no icon set/embedding rules; fallback: `ui-primitives/src/icons/` SVG catalog, `Button`/`Menu` icon slots).
- Doc never mentions **right sidebar/tabs** — no conventions for a right-panel list tab (unlisted primitives: `SegmentedTabs`, `StateDot`, `Pill`, `Tag`).
- Menu item geometry conflict (doc 40/r10 vs current `Menu.module.css` 34/r-md) — `web-styling.md` resolves material to `Menu`/`MenuSurface` but not the numbers.
- `Input.module.css` uses `border-l4` while doc §3 says l2 (drift).
- No max-width guidance for a narrow sidebar list panel (720px is settings-scoped).

## R3 — right sidebar "Start" tab (item 2)

**Where it lives** — package `dsh/packages/client/ui-sidebar-right/`:
- Frame/seat: `shell/SidebarRight.tsx:1-29` (`RightbarSeat`, frame owns column geometry); seat registrations in `index.ts:204-243` (slots `rightbar`, `rightbar.session`, `conversation.session.header.corner` → `ExpandButton`).
- Start tab = regular tab type, kind `guide`: `contract/seed.ts:36` (`GUIDE_KIND = 'guide'`, address `sidebar://<kind>`); definition `tabs/guide/definition.ts:9,20-26` (`GUIDE_ID`, `priority: 'builtin'`, title `t('tab.guide.title')` = `'Start'`, `locales.ts:84`); body registered at `index.ts:252-268` into keyed slot `sidebar.right.pane.tab` under `GUIDE_ID`.
- Appears when all tabs closed: every action runs the dockkit settle planner (`stores.ts:182-200`, `planSettle(..., makeTab)`); `defaultSeed` (`contract/seed.ts:26-33`) seeds the guide kind; `canCloseTab` returns false for the guide as the only tab (`stores.ts:69-72`) — Start reappears as last survivor.
- Body: `tabs/guide/GuideBody.tsx:88-112` — chain host `sidebar.right.tab.guide`; fallback = list of entry capsules.

**How "Workspace files" / "New terminal" work — extension point, NOT hardcoded**
- Each tab type contributes entries via the `guide` field of `SidebarRightTabDefinition` passed to `ctx.sidebarRightTabs.register(...)`.
- Shape: `tab-registry.ts:62-83` — `SidebarRightGuideEntry { commandId?, id, order, title: () => string, description?, icon?: ComponentType<IconProps> }`; `SidebarRightTabDefinition.guide?` at `:137-138` ("Omit to stay off it"). Registry flattens to `SidebarRightGuideBox` (+kind, providerId), sorted by `order`, notifies subscribers (`:407-413`, `:270-280`).
- "Workspace files": `dsh/packages/client/ui-sidebar-files/src/client/definition.tsx:15,18,25-39` — `guide: [{ id: 'workspace', commandId: 'workspace.files', order: 10, title, description, icon: GuideArtworkFiles }]`; registered in `index.ts:81`.
- "New terminal": `dsh/packages/client/ui-sidebar-terminal/src/client/index.ts:71-74` — `guide: [{ id: 'new', order: 20, … icon: PluginArtworkTerminal }]`; optional custom card via keyed slot `sidebar.right.tab.guide.entry` under the type's `id` (`index.ts:86-93`, `TerminalGuide.tsx:55-82`). Browser builtin: order 30.
- Rendering: `GuideBody.tsx:95-108` — `renderSlot('sidebar.right.tab.guide.entry', { entryId, kind, title, description }, { entryKey: entry.providerId, fallback: <EntryBox/> })`; default `EntryBox` capsule `:48-75` (`data-sidebar-right-guide-entry={entry.kind}`, icon+title+description+shortcut).

**What the plugin needs (item 2) — one field, no host changes**
- The plugin's registration (`packages/dsh-global-queue/src/client/index.ts:113-117`) already calls `sidebarRightTabs.register({...})`; adding `guide: [{ id: 'show-queue', order: 40, title: () => 'Show queue', description?, icon? }]` is the entire change. `guide` is on the public `SidebarRightTabDefinition` (`tab-registry.ts:138`, exported from package face `index.ts:56-63`). Entries are reactive (registered later → appears automatically). Custom card optional via keyed slot; `commandId` optional (shows shortcut).
- Caveats: entry `id` unique per provider (throws, `tab-registry.ts:256`); titles are thunks (localization = register own locale namespace; plugin currently hardcodes `() => 'Show queue'`).

**Click behavior**
- `GuideBody.tsx:104-105` — `onPick: tab.actions.openTab(selected.kind, { replaceTab: true })` — the guide is a doorway: picking opens that type in the guide's place.
- Wiring: `tab-domain.ts:200-202` → `place()` (`:166-174`) → `SidebarRightController.openTabIn` (`service.ts:358-361`) → `placeTab` (`:398-447`, resolves type for kind, address `sidebar://<kind>`).
- Dedupe: one tab per page kind per pane; re-open focuses existing tab (`stores.ts:22-27`).
- Host service API: `ctx.sidebarRight.openTab(kind, options?)` (`service.ts:186,210-216`, options `:174-177`); the queue plugin already uses it at `packages/dsh-global-queue/src/client/index.ts:144` (`sidebarRight.openTab(TAB_KIND)`).

**Not determined (R3)**
- Exact `order` convention (builtins use 10/20/30; any non-colliding value works).
- **Whether the pinned `0.2.0-rc.2` release has the `guide` field** — research was against the current `dsh/` checkout (may be newer than the pinned e2e version). Verify during R6/e2e.
- `commandId`/shortcut display for plugin-registered commands (no plugin-side example found).

## R4 — queue state machine, queued → running (item 4)

All paths under `packages/dsh-global-queue/` unless noted.

**Storage**: single JSON file, `$DSH_HOME/.global-queue.json` (`src/index.ts:26`, `src/queue/store.ts:20-21`); sync read-modify-write under `<file>.lock` (`store.ts:83-89, 103-111, 158-167`). Statuses: `queued|running|done|interrupted` (`src/queue/types.ts:1`). `add()` appends `queued` (`store.ts:28-42`); `update(id, patch)` is the only status API (`store.ts:69-81`).

**Transitions (all in `src/queue/watcher.ts`)**
- `queued → running` — `executeNext` `:85` after successful dispatch (`followup`/`resume`/`create`).
- `queued → interrupted` — `:67` (target session neither live nor persisted), `:80` (dispatch threw).
- `running → done` — `completeSession` `:112-115` on `turn/end` reason `completed`; `running → interrupted` on any other `turn/end` reason, and boot recovery `:122-125` (running item whose session has no live agent).
- `executeNext` `:60-86`: first `queued` in file order (`:61`), resolve target (`:64-69`), dispatch (`:75-82`), mark running with session id (`:85`).
- Gate: `checkForNext` `:88-91` — `if (isGloballyFree()) executeNext()`; `isGloballyFree` `:51` = every live agent idle, **zero agents counts as free** (empty `.every` → true).

**Triggers — exactly three, all in `start()` `:121-129`**
1. `deps.events.onAgentStatus(checkForNext)` — host `agent/status` (subscribed `src/index.ts:167-169`); fires only on status *transition* (`dsh/packages/core/agent-loop/src/agent.ts:145-152`).
2. `deps.events.onSessionEvent(completeSession)` — host `session/event` (`src/index.ts:170-179`); `completeSession` `:98-119` handles `turn/end` for the matching running item, falls through to `checkForNext()` when none matches (`:102-104`) or after completing (`:118`) — so any session event re-runs the check.
3. Boot: `checkForNext()` directly (`:128`).

**ROOT CAUSE of item 4 — the `add` RPC never wakes the watcher**
- `src/rpc.ts:108-117` — `add` dispatch only calls `store.add(...)`; channel mounted with the store alone (`src/index.ts:118`, `rpc.ts:36-43`). No watcher reference, no "queue changed" signal (no file watcher, no store callback).
- No-agent case: no agents → no `agent/status`, no `session/event`, ever → `checkForNext` never runs again → item sits `queued` forever. The gate would pass (`isGloballyFree` true for zero agents); the missing piece is the *trigger*.
- Boot contrast: items present at boot are processed (`start()` calls `checkForNext()`); unit tests exploit this (`tests/unit/server/watcher.test.ts:110-124` adds item before `watcher.start()`). **No test covers "add after start with zero live agents".**

**Secondary gap (explains item 5's "new session" half) — text never delivered for `create`/`resume`**
- `watcher.ts:71-78`:
  ```ts
  const sessionId = target === null ? randomUUID() : target
  if (live !== undefined) live.followup({ content: [{ type: 'text', text: item.text }], source: { kind: 'user' } })
  if (live === undefined && target !== null) deps.agents.resume({ resumeSessionId: target })
  if (target === null) deps.agents.create({ sessionId, meta: { cwd: item.workspacePath } })
  ```
  `item.text` used **only** in the `live`/followup branch. `followup` is dsh's only message intake (`dsh/packages/core/agent-loop/src/agent.ts:163-165`).
- Adapter is fire-and-forget: `src/index.ts:147-150` — `void ctx.agents.create({ sessionId, meta: { cwd } }).catch(log)` returns `{ agent: { id: sessionId } }` immediately; real `create` is `Promise<AgentHandle>` (`dsh/packages/core/agent/src/index.ts:391`). Item marked `running` before/without the agent existing; failed create only logged.
- Consequence: a `target === null` item that reaches `running` starts no turn → no `turn/end` → never `done`/`interrupted`. A freshly created agent starts `idle` with **no** `agent/status` emission (initial phase, `agent.ts:135`) → no re-trigger even on success.

**Client status visibility**
- No push channel. Module-level snapshot store `src/client/index.ts:74-96` (`subscribe`, `getItems`, `refresh` = RPC `list` + notify listeners). `callRpc` `:67-72` wraps `connection.rpc.call('/global-queue', …)`.
- Consumers: `QueuePane.tsx:12-17` (subscribe on mount + one refresh), refresh after pane mutations (`:20-24`, `:69`) and after add (`AddToQueue.tsx:34-37`); only auto refresh at load is `apply`'s `void refresh()` (`client/index.ts:159`). Host-side status changes invisible until next user-driven refresh.

**Not determined (R4)**
- Full `session/event` type map (`dsh/packages/core/session/src/known-event-types.ts`) and `turn/end` `reason` semantics.
- `ctx.agents.create` failure modes beyond the logged catch.
- Whether `agents.list()` includes other plugins'/processes' agents (globally-free semantics).
- e2e coverage of the no-activity `add` scenario (RPC lane tests assert round-trip only).

## R5 — session creation + "open session" link (item 5)

**Dispatch paths (`watcher.ts:63-82`)**
- `target === null` → `sessionId = randomUUID()`, `deps.agents.create({ sessionId, meta: { cwd } })` — **no prompt delivered** (text only in the `live.followup` branch; `resume` path also starts with no prompt — same gap as `create`).
- `watcher.ts:85` — item marked `running` with the sessionId immediately; fire-and-forget adapter (`src/index.ts:147-150`) returns a fake handle `{ agent: { id: sessionId } }`.

**What `agents.create` does in dsh**
- `dsh/packages/core/agent/src/index.ts:391-401` — pure delegation to the loop factory; `dsh/packages/core/agent-loop/src/index.ts:652-666` — prepares/persists the session, publishes a running-but-idle `Agent` (source `'startup'`); **no turn starts** ("setup composes, never drives").
- Session IS in the query corpus (`dsh/packages/session-query/session-query/src/corpus.ts:61-80`) and the client catalog receives it: host emits `api-session/added` on `session/created`/`agent/created` (`dsh/packages/api/session-controller/src/index.ts:167-178`), client merges via `handleSessionAdded` (`.../client/index.ts:116`, `.../client/sessions/manager.ts:642-647`).
- **No workspace registration**: `CreateAgentOptions` (`dsh/packages/core/agent/src/index.ts:63-88`) has no workspace field; `attachSession` is only invoked by the session command controller.

**Why the new session is invisible (two independent filters)**
- Ungrouped: `dsh/packages/client/ui-workspace/src/client/tree.ts:26-32` — group = workspace membership only; bare-created session → `UNGROUPED_KEY` bucket (trails all groups, `WorkspaceBrowser.tsx:333`).
- Blank: `tree.ts:238-257` — `if (session.blank && session.id !== current) return false`; blank = no `turn/start` ever (`dsh/packages/api/session-controller/src/list.ts:49,82,115`). No text delivered → no turn → always blank → filtered out.
- Continuation works because that session already exists in the current workspace and is not blank.

**Why "open session" link doesn't work**
- `dsh/packages/client/ui-workspace/src/client/navigation.ts:200-201, 375-382` — `openSession` = `replaceMain` → `sessions.retain(target)`; `dsh/packages/api/session-controller/src/client/sessions/manager.ts:135-144` — `resolveTarget` **throws** `sessions.retain: unknown session ${id}` when the id is in neither local instances, catalog, nor subagent addresses. The throw lands unhandled in the React `onClick` → no navigation, no feedback.
- Real race window: the watcher publishes `sessionId` to the queue immediately (`watcher.ts:85`) while host create is fire-and-forget; the `api-session/added` frame must be delivered + merged first. Clicks in that window throw.

**Workspace-attached creation path (the host pattern)**
- `dsh/packages/api/session-controller/src/commands.ts:105-144` — remote `sessions.create`: `workspaceRegistry.get(request.workspaceId)` → `agents.ensureSession(sessionId, cwd, …)` → `workspace.attachSession(sessionId)` (dedicated `session/workspace-attach-failed` remote error, `:133-140`).
- `ensureSession` (`.../agent.ts:239-276`) → `createOrAdopt` (`:444-495`): new id → bare `ctx.agents.create({ sessionId, meta: { cwd, … } })`; attach is a separate step by the command controller.
- `dsh/packages/workspace/workspace/src/entity.ts:109-149` — `attachSession` requires the session `cwd` to `realpathNormalize` to exactly the workspace path, else throws; appends to `record.sessionIds`.
- `dsh/packages/api/workspace-controller/src/index.ts:85-197` — workspace controller has NO session-creation endpoint (only `insertSessionBefore`, archive/pin, `follow`); session creation lives in the session controller.
- So a plugin wanting a workspace-attached session must call the `sessions.create` remote with `workspaceId`, or `agents.create` + `workspaceRegistry.get(id).attachSession(id)` itself.

**Not determined (R5)**
- Which failure the user actually hit: race-window throw vs persistent (static reading shows both a real race and a working success path; needs a live run).
- Client presentation of a zero-event blank session when `openSession` succeeds.
- Whether the `resume` no-prompt gap is in scope (user reported new-session only; the gap is symmetric).

## R6 — e2e infra + fake provider (item 5)

**Boot path (`tests-helpers/e2e/dsh.ts`)**
- `launchDsh` `:49-63`: resolve package → `resolveDshBinary` (`:73-80`, `E2E_DSH_BIN` override wins, else `ensureDshVersion(version ?? '0.2.0-rc.2')`) → `createTempRoot` (`:115-120`, `mkdtempSync .tmp/dsh-e2e-*` + empty `.dsh`/`.agents` homes — nothing pre-seeded) → `childEnv` (`:122-130`, `DSH_HOME=<root>/.dsh`, `DSH_AGENTS_HOME`, `DSH_TELEMETRY_DISABLED=1`, `keyless` strips provider key vars `:25`) → `ensureBuilt` (`:132-139`, `pnpm build` if `lib/` missing) → `addPlugin` (`:152-163`, `<bin> plugin --profile web add <pkgDir>`) → `bootWeb` (`:166-176`, `spawn(bin, ['web', '--port', N])`) → `waitReady` (`:178-204`, `READY_LINE` on stdout, 90 s) → `exchangeSession` (`:206-220`, token → cookie).
- `ensureDshVersion` `:88-111` — provisions `.tmp/dsh-versions/<version>` once (throwaway project `package.json` + `pnpm install`, store `.cache/pnpm/v11`).
- `stopDsh` `:66-70` — SIGTERM + `rmSync(root)` unless `E2E_KEEP=1`.
- Wrappers: `dsh-fixture.ts:46-48` (`startDsh`, vitest lane, **not keyless** — inherits dev env keys); `live.ts:9-22` (`launchPluginTestHome`, playwright lane, **keyless: true**); `scripts/e2e-live.ts` (`--package` required, `--port` 3081, `--keep`, `--version` default 0.2.0-rc.2).

**Existing dsh-global-queue e2e lanes (`packages/dsh-global-queue/tests/e2e/`)**
1. Boot smoke `server/boot.test.ts:12-33` — plugin listed + HTTP 200.
2. RPC lane `server/rpc.test.ts:45-115` — pure queue CRUD (`list/add/reorder/editText/remove`), items with `targetSessionId: null`; **no session ever created through the queue**.
3. Acceptance `acceptance.spec.ts:83-319` (playwright) — "Show queue" tab (list/drag/status/edit/remove/stats) + "Add to queue" control (current/new/empty). Items seeded over `/global-queue` RPC (`:239-267`); the only session is opened by hand (`:271-311`, `zenity` shim / "New session" button). No test asserts a queued item transitions to `running`/`done` with a session.
- Keyless lane dismisses onboarding: `dismissIfVisible(page, 'Add an API key to get started', 'Configure later')` (`acceptance.spec.ts:279,303`).
- `vitest.e2e.config.ts:10-12` — include `tests/e2e/**/*.test.ts`, 120 s / 180 s hook.

**Settings/profile mechanism on 0.2.0**
- `dsh/packages/boot/app-boot/src/profile.ts:37-40` — `PROFILES_DIR='profiles'`, `PROFILE_PATCH_FILENAME='cordis.patch.yml'`; `:179-181` — `web` template = bundles `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`; `:244-282` — first-opened profile auto-created (manifest + template `cordis.patch.yml` = header + `[]` + `pnpm-workspace.yaml`); `:655-690` — composition: bundle patches in order → profile's own `cordis.patch.yml` → launcher layers.
- Schema (`dsh/packages/boot/app-boot/src/index.ts:305-315`): top-level YAML **array** of `PatchOptions` entries; `!!js` expressions allowed; non-array file throws.
- Provider config targets the `llm-pi-ai` entry:
  ```yaml
  - id: llm-pi-ai
    config:
      providers:
        <route>:
          api: openai-completions
          baseURL: http://127.0.0.1:9/v1
          models:
            - id: <model-id>
  ```
- Provider fields (`dsh/packages/llm/llm-pi-ai/src/config.ts:448-489` `ProviderProfileSchema`): `apiKeyEnv`, `displayName`, `api`, `baseURL`, `models[{id, name, contextWindow, maxTokens, input, reasoningEfforts, compat}]`, `modelOverrides`, `compat`, `defaultContextWindow/MaxTokens/Input`, `headers`, `retryPolicy`, timeouts.
- Live reconcile: `dsh/packages/boot/hmr/src/index.ts:215-236` — chokidar watches `<home>/profiles/web/cordis.patch.yml` (+ home-level); change → `reconcileProfilePatches` (`app-boot/src/index.ts:273-300`) → `app-boot/config-reload`. The model-settings fixture relies on exactly this (`dsh-fixture.ts:79-85`: 0.2.0 imports settings.yaml once at boot then renames it `.imported` — **the live commit path is the profile's cordis.patch.yml**).

**Fake-provider precedent (the in-repo pattern)**
- `tests-helpers/e2e/dsh-fixture.ts:86-106` (`warmModel`) — writes the `llm-pi-ai` entry into `<root>/.dsh/profiles/web/cordis.patch.yml` with `api: openai-completions`, `baseURL: http://127.0.0.1:9/v1` (**closed local port** — probes refused locally, no internet), `models: [{id: e2e-model}]`, then polls the model-settings RPC until the host commits. Used by `packages/dsh-model-settings/tests/e2e/server/model-settings.test.ts:37,48`.
- `dsh-fixture.ts:126-156` — `upsertLlmEntry` (the machine-writer), `:86-106` `warmModel`, `:86-156` also `writeSettings`/`patchPath`; `:162-174` `startJsonServer` (fixed-JSON HTTP stub "stand-in for a llama.cpp instance").
- dsh test-support `llm-mock-server` / `llm-replay` exist in source only (NOT in the provisioned 0.2.0-rc.2 tree) — not usable under the frozen-install constraint.
- No current dsh-global-queue e2e configures any provider.

**Version pinning**
- `.tmp/dsh-versions/` today: `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.7-rc.2`, `0.2.0-rc.2`; `E2E_DSH_VERSIONS = ['0.2.0-rc.2']` (`dsh.ts:29`).
- **`guide` field EXISTS in 0.2.0-rc.2**: `.tmp/dsh-versions/0.2.0-rc.2/node_modules/.pnpm/@deepseek-ai+dsh-client-ui-sidebar-right@0.2.0-rc.2…/lib/types/client/tab-registry.d.ts:119` (+ `SidebarRightGuideEntry` `:46`, `SidebarRightGuideBox` `:69`). R3's pin question is resolved — item 2 is feasible on the pinned version.

**Not determined (R6)**
- Live behavior of a queued item against the closed-port provider (session row appears + turn fails with connection error — static reading says so, no e2e run demonstrated it yet).
- Whether a post-boot profile-patch write is enough for the global-queue watcher to pick up an item (proven for model-settings RPC only).
- Which provider route id a new-session turn requires (auto-pick of the only configured provider vs explicit model selection).
- Whether the onboarding dialog reappears once a configured-but-unreachable provider entry exists.

## Stage 1 — deep research: "new session" client signal in 0.2.0-rc.2 (item 3)

Provisioned tree root: `.tmp/dsh-versions/0.2.0-rc.2/node_modules/` (pnpm layout). Abbreviations: `SC` = `@deepseek-ai/dsh-api-session-controller`, `SES` = `dsh-client-ui-session`, `SLT` = `dsh-client-ui-slots`, `RN` = `dsh-client-ui-renderer`, `CNV` = `dsh-client-ui-conversation`, `SB` = `dsh-client-ui-sidebar`.

**The signal: `SessionSnapshot.blank` (exposed via slot prop `useConversation`).**
- `SC/lib/types/client/contract/snapshot.d.ts:58-80` — `SessionSnapshot`: `sessionId`, `running` (:62), `openState: 'cold'|'loading'|'open'|'error'` (:69), **`blank: boolean` (:74)**, `promptAttempted` (:77), `awaitingFirstTurn` (:79). No `seq`/event-count fields.
- `SC/lib/types/client/sessions/service.d.ts:16-52` — `SessionSummary` (catalog row) also has `blank: boolean` (:37); `SessionListState` has **no `current` field**.
- Client computation (`SC/lib/client.js`): initial `blankBit = true` (`:1604`); prompt success clears it (`:1761-1763`); running clears it (`:1966-1968`); `handleBlank` reconciles from list-projection `sessionListMetadata.blank` and never re-blanks if `promptAttempted || running` (`:2005-2010`); `buildSnapshot()` exposes `blank: this.blankBit` (`:2292`).

**Slot props in 0.2.0-rc.2 (`conversation.input.right`, scope: session)**
- `SLT/lib/types/client/slot-catalog.d.ts:88-106` — `ConversationInputRightProps`: `sessionId`, `useConversation` (= `useSessionSnapshot(sessionId)`), `useInput`, `inputActions`, `useWorkspaces`, `useChat`, `useSessions` (= session LIST hook, no `current` field).
- `SLT/lib/types/client/context.d.ts:14-19` — `useSessionSnapshot: (sessionId: SessionId) => SessionSnapshot`.
- `SLT/lib/client.js:804-820` — dispatcher: `const conv = useSessionSnapshot(sessionId)`; `useConversation: useCallback(selector => conv ? conv[selector(conv)] : undefined, [conv])` — **no `typeof`/string-key overloads in 0.2.0-rc.2** (the checkout's `typeof` pattern is newer).
- So a slot component reads the current session's blank state as: `props.useConversation((s: SessionSnapshot) => s.blank)`.

**"New session" state**
- `SB/lib/client.js:259-277` — sidebar "New session" button: `startSession()` (`:392-402`) → `sessions.create({ title })` then `navigateMain({ sessionId, replace: true })` — a blank session is created and opened in the main view; while writing there: `sessionId` present + `blank: true` + no events.
- Profile/workspace selectors in that state: `CNV/lib/client.js:347-368` (NewSessionCard → ModelPicker), `:856-884` (WorkspacePicker), `:950-968` (HeroComposer with `inputBar` = InputBar).

**Verdict (item 3)** — in `AddToQueue` (0.2.0-rc.2 API). CORRECTION (Stage 3, verified in the provisioned tree): the hook over `SessionSnapshot` is **`useSession`**, NOT `useConversation` — in 0.2.0-rc.2 `useConversation` is over `ConversationSnapshot = { views, activeTargets }` (no `blank`). The R1 slot-catalog line was misread.
```ts
const blank = props.useSession((s: SessionSnapshot) => s.blank)
const targetSessionId = blank ? null : props.sessionId
```
`blank === true` → user is in a NEW session → queue to a new session; `blank === false` → conversation exists (or a prompt is in flight) → continue the current session. A failed/attempted prompt keeps `blank` false (only a *rejected submission* keeps `blank` true). The `SessionSnapshot` type is NOT importable from the plugin (undeclared external) — use a structural mirror of the props (`{ blank: boolean }`), which is what Stage 3 shipped.

**Not determined (Stage 1)**
- Host-side origin of `sessionListMetadata.blank` (host implementation not in the client-only tree).
- Exact `InputState`/`ConversationSnapshot` shapes (not needed for the blank signal).
- `retainedBy.mainView` "current session" bookkeeping is internal to `ui-session`, not exposed.
