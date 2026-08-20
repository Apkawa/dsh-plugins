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

Our modules:
- `src/probe.ts` — `fetchModels(fetcher, baseURL, options?)`: GET + bounded read + parse.
  **Throws** on any failure (network, timeout, non-2xx, oversized, malformed). The
  `modelsUrl` helper handles both base spellings (with/without trailing `/v1`).
- `src/props.ts` — `parsePreset(entry)` / `contextWindowFromEntry(entry)`: extract the
  context size from the INI preset.
- `src/autofill.ts` — batch autofill: for each candidate route, fetch once, fill every
  unsized model's `contextWindow` (rounded down). Self-cycle guard: a route whose models
  are all sized is skipped entirely.

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

In our final design we dropped the client card entirely (`CLIENT_ENABLED = false` in
`src/client/index.ts`) and rely on the host autofill + the existing Models UI to display
contextWindows.

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

Seven host modules: `round.ts`, `props.ts`, `probe.ts`, `settings-io.ts`, `autofill.ts`,
`log.ts`, `index.ts`. The client half is disabled but kept (`client/{card,controller,index,slot-contract}.tsx`).
If adding new capabilities, prefer a new consumer/module over rewriting the core.

## 7. Logging (dbg wrapper)

All plugin logs go through `src/log.ts` → `dbg.{log,info,warn,debug,error}`; the
`[model-settings]` tag lives inside `dbg`, not at call sites. Every level except
`error` is gated on `process.env.DEBUG === '1'` (exact value, no namespace globs);
`error` is never gated — failures stay loud (AGENTS.md pitfall 5). dsh has no product-level
log-level flag to piggyback on (`DSH_TELEMETRY_MODE` is OTLP-only; the dynamic-package vm
sandbox console is unconditional write-through), so the flag is ours. Planned: extract
`log.ts` into a shared package for other plugins later — until then it stays local.
