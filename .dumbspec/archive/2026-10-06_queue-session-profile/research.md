# Research: 2026-10-06_queue-session-profile

Findings from the synchronous research subagent (superficial scan only).

## 1. Session creation for a queued prompt (host side)

- Call site: `packages/dsh-global-queue/src/index.ts:176-182` — the `create` member of the `WatcherDeps.agents` object built in `apply(ctx, config)` (`src/index.ts:141`), wrapping the host seam `ctx.agents.create`:

```ts
create: async ({ sessionId, meta }) => {
  const selection = ctx.agentDefaultModel.currentSelection()
  await ctx.agents.create({ sessionId, agentOptions: { provider: selection.provider, model: selection.model }, meta: { cwd: meta.cwd } })
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`global-queue: agent not found after create: ${sessionId}`)
  return toWatcherAgent(agent)
},
```

- Invoked from `executeNext()` in `packages/dsh-global-queue/src/queue/watcher.ts:67-95` (lines 83-86): new-session items (`targetSessionId === null`) go through `deps.agents.create({ sessionId, meta: { cwd: item.workspacePath } })`; the session then gets `followup` with the queued text.
- `sessionId` is a fresh `randomUUID()` (`src/queue/watcher.ts:78`).
- **No `agentPreset` in `meta`, no `setup` callback** — nothing preset-related is passed.

## 2. What "broken session" concretely means

- `agentPreset` is an optional field on `CreateAgentOptions.meta` (`dsh/packages/core/agent/src/index.ts:79-86`, line 85) and `CreateSessionOptions.meta` (`dsh/packages/core/session/src/types.ts:130,158`).
- Session header: `dsh/packages/core/session/src/index.ts:1049-1059` — `...meta?.agentPreset === undefined ? {} : { agentPreset: meta.agentPreset }`.
- The `agentPreset` session projection initializes to `header.agentPreset ?? null` (`dsh/packages/preset/agent-preset-registry/src/session.ts:35-42`).
- A preset CANNOT be added after a session has started: `AgentPresetRegistry.select` throws `agent-preset/locked` ("This session has already started") — `dsh/packages/preset/agent-preset-registry/src/index.ts:323`.
- So the queue-created session has no preset in its header, its agent world is composed with no preset mounted, and it can never adopt one later.

## 3. The slot `conversation.hero.agentPreset`

- Declaration (client side): `dsh/packages/client/ui-conversation/src/client/contract/slots.ts:193` — `{ kind: 'single'; scope: 'session-maybe'; owner: HeroAgentPresetOwnerProps }`.
- Rendered at `dsh/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx:132`; declared as child in `apply.ts:320`; catalog entry in `dsh/packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:573-609`.
- Occupant registered at `dsh/packages/client/ui-agent-preset/src/client/index.ts:177-181`: `scope.slots.register({ name: 'conversation.hero.agentPreset', locale: 'settings.agentPreset', inject: seatInjected }, AgentPresetSeat)`.
- The selected value lives in the client-side `AgentPresetSeatController` (`dsh/packages/client/ui-agent-preset/src/client/seat-store.ts`): a pick is **staged** (`select(id)` stores `staged.id`); `apply()` reaches a blank current session via `this.ctx.remote.agentPresets.select(session.id, staged)` (line 230).
- **There is no host-side slot-read API**; slots are a client (browser) service. Grep for `agentPreset` across `packages/` in this repo: **zero matches**.
- Host-visible channels for the selection: `ctx.remote.agentPresets.select` / `AgentPresetRegistry.select` (appends session event `agent-preset/selected`), the `agentPreset` session projection (readable e.g. via `ctx.sessionProjections.stateOf(session, 'agentPreset')` — pattern at `dsh/packages/api/session-controller/src/agent.ts:360-362`).

## 4. How other session-creation paths obtain the preset (patterns to conform to)

- **Webhook plugin** (canonical host-side pattern), `dsh/packages/webhook/webhook/src/session.ts:117-143`:
```ts
const preset = await ctx.agentPresets.resolve(resolved.agentPreset)
await using presetScope = await ctx.agentPresets.acquireScope(preset.id)
…
const handle = await ctx.agents.create({
  sessionId,
  signal,
  meta: { cwd: workspace.path, agentPreset: preset.id },
  agentOptions: resolved.agentOptions,
  setup: async (agentCtx) => {
    await ctx.agentPresets.mount(agentCtx, preset.id)
    installInitialModelSelection(agentCtx, resolved.modelSelection)
  },
})
```
  with `agentPresets` in its `inject` list (`src/index.ts:62`). The global-queue `inject` list (`packages/dsh-global-queue/src/index.ts:18`) has **no `agentPresets`**.
- **Web session controller**, `dsh/packages/api/session-controller/src/agent.ts:381-397` (`composeAgent`) and `:485-494` (`createOrAdopt`): passes `meta: { cwd, agentPreset }` + `setup: (agentCtx, agent) => { …; await presets.mount(agentCtx, resolvedId) }`.

## 5. Package structure (`packages/dsh-global-queue`)

| File | Role |
|---|---|
| `src/index.ts` | Host composition root: `name='global-queue'` (15), `inject` (18), `Config` (20-27), `apply` (141) — queue store, watcher deps (161-220), RPC mount via nested `ctx.inject(['webServer'], …)` (230-232) |
| `src/queue/types.ts` | `QueueItem` (`targetSessionId: string|null`, `sessionId?`, …) lines 3-15 |
| `src/queue/store.ts` | File-backed queue store (atomic writes, lock) |
| `src/queue/watcher.ts` | `createWatcher(deps)` (49); `executeNext` (67-95) create/resume/followup; completion via `turn/end` (111-132) |
| `src/rpc.ts` | `/global-queue` prefix route: `list`/`add`/`reorder`/`editText`/`remove` (40-47) |
| `src/client/index.ts` | Client: RPC client, snapshot store, sidebar tab + "Add to queue" seat |
| `src/client/QueuePane.tsx`, `AddToQueue.tsx`, `format.ts` | Tab body, composer control, stats |

- Entry points (`package.json`): host `.` → `lib/index.js`; client `./client` → `lib/client/index.js`; `dsh.bundle.patch` → `cordis.patch.yml`.
- Build: `pnpm build` = `tsc -p tsconfig.json && tsdown`; `pnpm typecheck`; `pnpm test` (unit), `pnpm test:e2e`.
- AGENTS.md notes: host changes need a full `dsh web` restart, client-only need a page reload; 0.2.0-rc.2 host-RPC workaround documented in `src/index.ts:224-229`.

## 6. Existing tests

- `tests/unit/server/watcher.test.ts` — agents double records create calls (line 34, 39-44); asserts create+followup, resume for persisted targets (366-374), workspace attach (376-385). **No agent-preset assertions.**
- `tests/unit/server/composition.test.ts` — pins the exact create call (lines 89-93):
```ts
expect(agents.createCalls[0]).toEqual({
  sessionId,
  agentOptions: { provider: SELECTION.provider, model: SELECTION.model },
  meta: { cwd: '/ws/bind' },
})
```
  **This test locks in the current preset-less creation** — must be updated with the fix.
- `tests/e2e/server/boot.test.ts` — boot smoke only (HTTP 200).
- `tests/e2e/server/rpc.test.ts` — RPC contract; `add` seeds items with `targetSessionId: null`; no session-preset assertions.
- `tests/e2e/acceptance.spec.ts` — playwright lane for the queue tab / Add-to-queue control; no preset assertions.

## Bottom line

- No test asserts the agent preset of a queued-prompt session; `composition.test.ts:89-93` pins the preset-less behavior.
- The plugin never touches `agentPreset`; the host has no slot-read API.
- Established host pattern for preset-carrying sessions: webhook's `meta: { cwd, agentPreset }` + `setup: mount` (needs `agentPresets` in `inject` + `resolve`/`acquireScope` before create).
- The user-visible selection lives client-side in the `conversation.hero.agentPreset` seat (`AgentPresetSeatController`, staged pick); it reaches the host only via `remote.agentPresets.select` → `agent-preset/selected` → the `agentPreset` projection.

## Deep-dive needed (moved to plan, per research rules)

- Exact shape of the slot value as readable from the client side: `HeroAgentPresetOwnerProps`, what `seatInjected` injects (does the slot value's props carry the `AgentPresetSeatController` so a client plugin can read the staged preset id?).
- Whether/where the global-queue client half (`AddToQueue.tsx`) has access to the conversation scope / slot API at "Add to queue" time.
- Host-side availability of `ctx.agentPresets` for a host plugin (inject name) and the exact `resolve`/`acquireScope`/`mount` signatures.

## Deep-dive findings (Stage 1)

### D1. Client-side read of the selected preset

- The slot value is a `StoredEntry` (`dsh/packages/client/ui-slots/src/index.ts:841-856`): `{ component, options, inject?, locale, … }`. `HeroAgentPresetOwnerProps` is an empty marker (`dsh/packages/client/ui-conversation/src/client/contract/slots.ts:274-277`) — the owner props carry nothing.
- The controller is NOT carried in the slot value, but `seatInjected` (`dsh/packages/client/ui-agent-preset/src/client/index.ts:154-163`) injects `{ hooks: { agentPresetSeat: seat.store, … }, load, select, introduced }` — i.e. the seat's `SnapshotStore<AgentPresetSeatState>` under `hooks.agentPresetSeat`.
- Read API: `SlotRegistry.entriesOfSlot(key): readonly StoredEntry[]` (`dsh/packages/client/ui-renderer/src/client/registry.ts:416-418`); for a `single` slot take `[0]`. Example of a plugin reading another slot: `dsh/packages/client/ui-sidebar/src/client/index.ts:50-53`.
- The global-queue client operates in the ROOT plugin ctx (`packages/dsh-global-queue/src/client/index.ts:117-122`, `ctx.get('slots')`); the `slots` service is a single global instance, so the hero slot is addressable by name from the root ctx. The package's local `SlotRegistryFace` mirror (`src/client/index.ts:34-38`) has only `register`/`inject` — **must be extended with `entriesOfSlot`**.
- The seat state's `current: string` field (`dsh/packages/client/ui-agent-preset/src/client/seat-store.ts:29`) is the staged pick (empty until roster loads; set on `stage()` :154-158; on `load()` to `staged.id ?? session's preset ?? fallback` :118). `staged` itself is private; the public reactive read is `store` (:56).
- The hero slot is `scope: 'session-maybe'`, so `entry.inject(sessionId)` takes the on-screen session id positionally (`undefined` → the unbound seat, `ui-agent-preset/src/client/index.ts:155-156`). `AddToQueue` has `props.sessionId` (the composer's session id).
- Raw-store read is legitimate in the apply world (e.g. a click handler), not as a React render prop.
- **Minimal read code:**
```ts
const entry = slots.entriesOfSlot('conversation.hero.agentPreset')[0]
const id = entry?.inject?.(sessionId)?.hooks?.agentPresetSeat?.getSnapshot().current
```
- Caveat: `entry` may be `undefined` if the ui-agent-preset plugin is not loaded — guard.
- Conclusion: the seat store's `current` (via the slot's inject face) is the ONLY client-side source of the hero chip's selection. No client service tracks it separately.

### D2. Host-side mount of a preset onto a created session

- Service: `AgentPresetRegistry` (`@deepseek-ai/dsh-agent-preset-registry`), registered under the Cordis service name **`'agentPresets'`** (`dsh/packages/preset/agent-preset-registry/src/index.ts:63-65`); host plugins list `'agentPresets'` in `inject` (webhook: `dsh/packages/webhook/webhook/src/index.ts:59-66`).
- Signatures (`dsh/packages/preset/agent-preset-registry/src/index.ts`):
  - `resolve(id?: string): Promise<AgentPreset>` (:180-187) — id optional (default); `AgentPreset = { id, name?, description?, order?, broken? }` (`src/preset.ts:4-10`); unknown id → `RemoteError('agent-preset/not-found')` (:183-184); broken preset → `{ id, broken }` without throwing.
  - `acquireScope(id?): Promise<{ key } & AsyncDisposable>` (:340-349) — a revision lease pinning the preset generation across async work OUTSIDE an agent scope. **NOT needed for long-lived sessions**: `mount` self-retains the generation via an effect on the agent ctx (:241-250), disposed with the agent. The host's own long-lived path (`dsh/packages/api/session-controller/src/agent.ts:381-397`) does NOT call `acquireScope`.
  - `mount(ctx: Context, id?: string): Promise<AgentPreset>` (:257-266) — `ctx` is the agent ctx from the `setup` callback; broken preset → `RemoteError('agent-preset/invalid')`.
- `setup` callback type: `AgentSetup = (agentCtx: Context, agent: Agent) => …` (`dsh/packages/core/agent/src/index.ts:51-54`); `CreateAgentOptions.setup?` (:118), `CreateAgentOptions.meta.agentPreset?: string` (:85); `ResumeAgentOptions.setup?` exists identically (:143).
- **Recommended create sequence** (mirror session-controller, not webhook):
```ts
const preset = await ctx.agentPresets.resolve(presetId)   // unknown → RemoteError before create
await ctx.agents.create({
  sessionId,
  agentOptions: { provider, model },
  meta: { cwd, agentPreset: preset.id },
  setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset.id) },
})
```
- Read-back for tests: cheapest `ctx.sessions.get(id).header.agentPreset` (header set from `meta.agentPreset` at create, `dsh/packages/core/session/src/index.ts:1058`); authoritative `ctx.sessionProjections.stateOf(session, 'agentPreset')` (`string | null`, `dsh/packages/session/session-projection/src/index.ts:319-327`).
- **Resume gap:** `ctx.agents.resume` does NOT auto-mount the stored preset — the session-controller passes `setup: mount(storedPreset)` on resume too (`dsh/packages/api/session-controller/src/agent.ts:466-473`). The global-queue resume wrapper (`src/index.ts:183-188`) passes no setup → a session that HAS a preset would resume without it mounted (same class of bug). The stored preset is readable via `sessionPersistence.stat(id).header.agentPreset` (the plugin already mirrors `stat` at `src/index.ts:76-78`).
- Fresh `web`-profile home (e2e) always has presets: `standard` (default), `ptc`, `minimal` (`dsh/packages/bundle/web-app/cordis.patch.yml:561-565`, `dsh/packages/bundle/web-app/presets/`).

## D3. E2e verification (Stage 4) — verified 2026-10-07

- New file `packages/dsh-global-queue/tests/e2e/server/preset.test.ts` (vitest e2e lane, `describe.each(E2E_DSH_VERSIONS)`, one isolated `dsh web` per version, home under `.tmp/dsh-e2e-*`).
- **Preset seeding — no provisioning needed:** every fresh `web` home ships the bundle presets `standard` (default), `ptc`, `minimal` (`dsh/packages/bundle/web-app/presets/`), so the tests use `ptc` directly as the `agentPreset` in the `add` payload. Verified live: a queued item with `agentPreset: "ptc"` produced a session whose projection is `"ptc"`.
- **Model seeding:** one `llm-pi-ai` entry is written into the profile patch via the shared `writeSettings` helper (dead `baseURL: http://127.0.0.1:9/v1`, `e2e`/`e2e-model`) so `agentDefaultModel.currentSelection()` answers; the turn may fail (network-refused) — the assertions target create/resume, not the turn. Because the patch is reconciled live, the create test self-heals: an `interrupted` item with no `sessionId` means the create raced the model commit → remove and re-add until a session is created.
- **Session inspection surface:** the 0.2.0-rc.2 host RPC channel is broken host-side, so no session RPC exists in the lane. The tests read the session-projection-cache artifact `<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json` — `record.rows.agentPreset.val` is the live `agentPreset` projection (initialized from `header.agentPreset ?? null`), so a non-null value proves the header carries the preset and the projection is mounted.
- **Results:** `pnpm test:e2e` green — 3 files / 10 tests (boot 2, rpc 6, preset 2). Create test: item left `queued` with a `sessionId`, projection `val === "ptc"`. Resume test: item targeting the created session left `queued` with `sessionId === <created>`, projection `val === "ptc"` intact.
