# Key moments — reference for AI sessions

Notes written during the dsh-model-settings build. Links point into the dsh tree
(`dsh/` symlink → deepseek-harness) and our package (`packages/dsh-model-settings/`).

## 1. dsh plugin architecture (host/client split)

A dsh plugin is a **Cordis** composition: one row in `cordis.yml` mounts both halves.
The loader derives the host half from the `.` export and the client half from the
`./client` export of the package. Key files in the dsh tree:

- `packages/client/ui-settings-models/src/client/index.ts` — the existing Models UI
  (self-contained React; no extension slots). This is what we extend, not replace.
- `packages/llm/llm/src/index.ts` — `LlmRuntime.registerModelDiscovery` (line ~504)
  and `discoverModels` (line ~532). One discovery per namespace; pi-ai owns `llm-pi-ai`.
- `apps/cli/src/plugin.ts` — `reconcilePlugins`: appends a newly-bundled dep to
  `dsh.profile.bundles` on any re-add.

**Rule**: orchestration depends on injected interfaces (`Fetcher`, `SettingsStore`),
not concrete dsh seams. The composition root (`src/index.ts`) wires the tested modules
to the dsh seams; everything else is pure + unit-tested.

## 2. llama.cpp `/v1/models` response shape

A single GET to `<baseURL>/v1/models` returns every model with its `status.preset`
(INI format). The context size comes from `ctx-size` (else `fit-ctx`, else unknown):

```ini
[ModelName]
ctx-size = 120000
jinja = 1
...
```

Entries also carry a top-level `architecture` object; a vision-capable entry lists
its input modalities there:

```json
{ "id": "ModelName", "architecture": { "input_modalities": ["text", "image"] }, "status": { "preset": "..." } }
```

Not every endpoint reports it (older llama.cpp builds, proxies) — its absence is
the norm and means "unknown", not "text-only".

Our modules:
- `src/probe.ts` — `fetchModels(fetcher, baseURL, options?)`: GET + bounded read + parse.
  **Throws** on any failure (network, timeout, non-2xx, oversized, malformed). The
  `modelsUrl` helper handles both base spellings (with/without trailing `/v1`).
- `src/props.ts` — `parsePreset(entry)` / `contextWindowFromEntry(entry)`: extract the
  context size from the INI preset; `entrySupportsVision(entry)`: true only for a
  non-empty `architecture.input_modalities` string array containing `image`.
- `src/autofill.ts` — batch autofill: for each candidate route, fetch once and fill
  whatever a model lacks — its `contextWindow` (rounded down, when unsized) and its
  `input` of `["text", "image"]` (when the listing declares vision and the model has
  no explicit list yet). Self-cycle guard: a route whose models are all sized **and**
  have an explicit `input` is skipped; an endpoint without modality info stays
  unsettled and is re-listed (but never re-written) on every settings commit.

**Pitfall hit**: the real baseURL was `http://host:8080/v1` (already includes `/v1`).
Naively appending `/v1/models` produced `.../v1/v1/models` → 404. Fixed in `modelsUrl`.

## 3. Install mechanism (dsh.bundle)

A plugin package is installable via `dsh plugin add` only if its `package.json` declares:

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [...], "platform": "web" }
  },
  "files": ["lib", "cordis.patch.yml"]
}
```

The `cordis.patch.yml` is a YAML list of rows (insert/replace) that the loader applies
to the profile's `cordis.yml`. The row references the package by NAME; the loader derives
host/client from the exports. See `packages/dsh-model-settings/cordis.patch.yml` + the
example at `examples/tmp/ui-status-label/`.

Install command (from the repo):
```
dsh plugin --profile web add github:apkawa/dsh-plugins#path:/packages/dsh-model-settings
```

## 4. Slot hierarchy (where cards land)

The settings page is a tree of slots. Key nodes:

- `settings.section` (kind:list, scope:root) — top-level nav rows [General, Models, Plugins].
- `settings.plugins.tab` (list) — declared by the Plugins section; its configurable tab
  declares `settings.plugin.item` (keyed). **This is where a plugin's card lands.**

**Pitfall hit**: registering into `settings.plugin.item` puts your card INSIDE the Plugins
accordion, not beside General/Models. For a top-level card you'd need `settings.section`
(or extend the existing Models UI). Query the tree with `Slots.listSubTree` before registering.

**Superseded**: the reasoning-settings rework revived the client half (per-model accordion,
`src/client/ReasoningSection.tsx`); the card is no longer disabled — see §8–§10.

## 5. Event flow (host vs client)

| Event | Side | Fires when |
|-------|------|------------|
| `settings/updated(ns, next, prev, source)` | HOST | After each commit; resolved value changed (never for deep-equal). |
| `settings/document-updated(ns, revision)` | CLIENT | Raw user-section change (regardless of resolved value). |
| `credentials/updated` | CLIENT | Credential invalidation (reference names only). |
| `llm/adapters-updated` | CLIENT | Provider topology commit. |

Our watcher listens on the HOST side for `settings/updated` and filters to `ns === 'llm-pi-ai'`.
The existing Models UI subscribes on the CLIENT side to `settings/document-updated` to refresh
its display. Verify exact signatures in `packages/settings/settings/src/types.ts` (dsh tree).

## 6. Module budget (KISS cap)

Host modules (superseded list — the rework added `efforts.ts`, `model-save.ts`): `round.ts`,
`props.ts`, `probe.ts`, `settings-io.ts`, `autofill.ts`, `log.ts`, `index.ts`. The client half
is active again (reasoning accordion + controller). If adding new capabilities, prefer a new
consumer/module over rewriting the core.

## 7. Logging (dbg wrapper)

All plugin logs go through `src/log.ts` → `dbg.{log,info,warn,debug,error}`; the
`[model-settings]` tag lives inside `dbg`, not at call sites. Every level except
`error` is gated on `process.env.DEBUG === '1'` (exact value, no namespace globs);
`error` is never gated — failures stay loud (AGENTS.md pitfall 5). dsh has no product-level
log-level flag to piggyback on (`DSH_TELEMETRY_MODE` is OTLP-only; the dynamic-package vm
sandbox console is unconditional write-through), so the flag is ours. Planned: extract
`log.ts` into a shared package for other plugins later — until then it stays local.

## 8. RPC carrier contract (plugin channel results)

The costliest fact-gathering detour of this build: our handler's errors reached the UI as a
red wall of raw zod issues instead of a message. The mechanism, once known, makes debugging instant:

- **Wire schema**: `dsh/packages/host/apiproxy/src/api/rpc.schema.ts` — every server-response's
  `result` is validated against `rpcResultSchema`: `{ok:true, value}` (value slot stays wide) or
  `{ok:false, error: RpcError}`, where `RpcError` is a **closed** discriminated union by `code`
  (~35 codes: `bad-request`, `settings-rejected`, …, `internal`) + `message` + **required**
  `details` (per-code shape). Invented codes or missing `details` fail validation.
- **The wall is produced CLIENT-side**: `dsh/packages/client/connection/src/client/rpc.ts:42` runs
  `serverResponseSchema.parse(response.json())`. A non-conformant error → the parse throws a zod
  issues array → that string reaches the plugin UI as the error text. A curl to the HTTP surface
  (`POST http://127.0.0.1:3080/model-settings/<endpoint>` with a
  `{"type":"client-request","rpcId":…,"method":…,"payload":…}` body) bypasses the client parse and
  shows the raw server-response JSON — ideal for probing which build is actually running (§10).
- **Conforming errors**: payload-validation failures → `code:'bad-request'`, `details:{issues:[]}`;
  runtime failures → `code:'internal'`, `details:{}` (dsh's own catch-all — see `transportError()`
  in `rpc.ts`). Finer codes (`model-unavailable`, `model-discovery-failed`) exist but need typed
  details; we use the two above (KISS trade-off noted).
- **Rule**: never invent an RPC error code or omit `details`. Our builder: `rpcFailure()` in
  `src/index.ts` — every handler error path goes through it.

## 9. dsh reasoningEfforts / contextWindow semantics (llm-pi-ai)

Discovered by trial and error against dsh's runtime validation; read these first next time:

- `reasoningEfforts?: false | mapping` — zod `z.union([z.const(false), dict])` in
  `dsh/packages/llm/llm-pi-ai/src/config.ts` (~203–225). `undefined` = inherit the installed
  catalog; `false` = explicit non-reasoning model (the canonical "clear"); `{}` or null → runtime
  `invalid()` error. **Clearing a stored mapping must write `false`, not `{}`.**
- `contextWindow`: zod `z.number().step(1).min(1)`, but resolution is
  `entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow` (`catalog.ts:510`) —
  an **absent key is legal**. Clearing = drop the key from the entry. Reasoning resolution lives in
  `resolveModelReasoning` (~315–365) in the same file.
- `input` (per model): zod `z.array(z.union(MODALITIES))` where the modalities are
  exactly `text | image` (`config.ts` / `catalog.ts:42–48`). Resolution is
  `declaredInput(entry.input) ?? base?.input ?? [...request.defaultInput]`
  (`catalog.ts:533`) — an **absent key is legal** (falls back to the route's
  `defaultInput`, which defaults to `["text"]`). Our checkbox convention: checked ⇔ the
  stored list contains `image`; check writes `["text", "image"]`, uncheck writes the
  explicit `["text"]` — the key is never dropped, so autofill can never re-check a
  deliberately un-visioned model, and `["text"]` beats the route `defaultInput`.
- Our channel's wire contract (one Save commits all parts): `saveModel({routeId, modelId,
  efforts?, contextWindow?, input?})` — `efforts:{}` → clear the mapping (host stores `false`);
  `contextWindow:null` → drop the key; `input` must be a non-empty subset of `["text", "image"]`;
  an absent part = untouched.

## 10. Host/client version skew + probing

- The client bundle (`lib/client.js`) is served from disk on every page load; the host half is
  pinned in memory at dsh process start. New client + stale host = mixed behavior (the client posts
  a new wire shape, the old host rejects it with old error codes).
- **Restart rules**: client-only changes → page reload; host changes → full dsh web restart.
  `pnpm build` = `tsc -p tsconfig.json` (host → `lib/`) + `tsdown` (client bundle) — both halves
  from one command.
- **Version fingerprint**: the error-response shape reveals which host build is running — old codes
  without `details` (`INVALID_EFFORTS`, `MODEL_SETTINGS_ERROR`) = pre-carrier-conformance host;
  conforming `{code, message, details}` = current. Check this BEFORE suspecting a source bug: one
  remark batch was diagnosed as a stale process (user's curl showed the old shape) with zero code
  changes needed.


## 11. Pitfalls (learned the hard way)

1. **URL construction from a user-configurable base**: always verify against a LIVE endpoint, not just fixtures. The double-`/v1` bug (`.../v1/v1/models`) passed every fixture test but 404'd in production because the real `baseURL` already ended with `/v1`. When joining a base + path, detect whether the base already carries the version prefix; handle both spellings.

2. **Install mechanism**: a plugin package is installable via `dsh plugin add` only if its `package.json` declares `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` and ships a `cordis.patch.yml`. Without it, the loader cannot derive the host/client halves from the `.` / `./client` exports. The row references the package by NAME; the loader resolves the rest.

3. **Slot hierarchy**: `settings.plugin.item` is a CHILD slot (under the Plugins section's configurable tab), NOT a top-level settings row. Registering there lands your card inside the Plugins accordion, not beside General/Models. For a top-level card use `settings.section`; or extend the existing Models UI instead of building a new widget. Query the slot tree (`Slots.listSubTree`) before registering — do not guess the parent.

4. **Event names (host vs client)**: `settings/updated(ns, next, prev, source)` is the HOST-side event (fires after each commit when the resolved value changes; never for a deep-equal value). `settings/document-updated(ns, revision)` is the CLIENT-forwarded version (fires on raw user-section change). Verify against dsh's types: `packages/settings/settings/src/types.ts` in the dsh tree.

5. **Make failures LOUD during development**: a quiet-skip design (`fetchModels` → `null` on any failure) hid the 404 for hours. During dev/debugging, throw + log so the error is immediately visible in the console. Restore quiet-skip (catch + skip) only once the happy path is confirmed working.
