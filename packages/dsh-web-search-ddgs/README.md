# @apkawa/dsh-web-search-ddgs

A ddgs-backed web-search provider for DeepSeek Harness (`dsh web`). It registers
a `WebSearchProvider` on the `ctx.web` seam — the same seam the built-in DeepSeek
provider uses — so the `web_search` tool runs on
[ddgs](https://github.com/deedy5/ddgs) with no API keys.

## What it does

- Registers the `ddgs` search provider on `ctx.web` (host-side Cordis plugin, no client half).
- Runs ddgs in a **managed uv venv** (default `~/.cache/dsh-web-search-ddgs/venv`): provisioned lazily on first search (`uv venv` + `uv pip install ddgs`), self-healed if the ddgs install goes missing.
- Backends: **duckduckgo** (default), `bing`, and `yandex` all work on current ddgs (9.16.0, latest). `yandex` is upstream-disabled in ddgs and re-registered at runtime by `ddgs-search.py` (`ENGINES['text']['yandex'] = Yandex`) only when `backend: yandex`. Known quirks: `bing` occasionally returns concatenated snippet fields (a ddgs parser quirk), and live searches can flakily fail with `DDGSException: No results found` under load (no retry in the suite).
- **Serializes** searches: the tool fires up to 4 queries concurrently, and rapid bursts trip backend rate limits (the `No results found` DDGSException).

## Setup

1. `pnpm build` — compiles `src/` → `lib/` (tsc, no bundler).
2. Link into the `web` profile:

   ```sh
   dsh plugin --profile web add /path/to/packages/dsh-web-search-ddgs
   ```

   (`dsh plugin` forwards to `pnpm` in the profile directory.)
3. Point `web_search` at the provider — see [Provider selection](#provider-selection).
   Without this, the stock web profile keeps its `deepseek-official` pin and the
   `ddgs` provider is registered but never selected.
4. `uv` must be on `PATH` — it provisions the managed venv on first search.
5. Restart `dsh web` (host-side plugin: a full restart is required, not a page reload).

## Configuration

Plugin config (`web-search-ddgs` section in dsh settings):

| key           | default                                  | meaning                                             |
| ------------- | ---------------------------------------- | --------------------------------------------------- |
| `backend`     | `duckduckgo`                             | ddgs text engine (`duckduckgo`, `bing`, `yandex`, …) |
| `maxResults`  | `8`                                      | sources per query (`web_search` passes its own bound) |
| `timeoutMs`   | `30000`                                  | per-search subprocess timeout                        |
| `venvDir`     | `~/.cache/dsh-web-search-ddgs/venv`      | managed uv venv                                      |
| `ddgsVersion` | `ddgs` (latest)                          | pip requirement pin for the venv                     |

## Provider selection

The `ctx.web` seam (`WebSearchProvider` = `{ id, available(), search() }`,
registered via `ctx.web.registerSearchProvider`) is unchanged between dsh
0.1.2-rc.1 and 0.2.0-rc.2 — byte-identical types in
`@deepseek-ai/dsh-web@0.2.0-rc.2`. This plugin registers through a Cordis
plugin: `inject: ['web']` plus `apply()` calling `ctx.web.registerSearchProvider(...)`.

The seam resolves the provider at call time. A configured id wins —
`searchProvider` from the `web` service config, falling back to the
`DSH_WEB_SEARCH_PROVIDER` env var only while the config field is unset. With
no configured id, exactly one usable registered provider is auto-selected;
several usable ones give `WEB_PROVIDER_AMBIGUOUS`. There is no CLI flag for
provider selection.

In practice the stock `web` profile needs an explicit pin, for two reasons:

- `dsh-base` pins `searchProvider: deepseek-official` (and `fetchProvider: http`)
  in the `web` service config — config beats env, so merely inserting the
  provider row (as `cordis.patch.yml` does) does **not** switch selection, and
  `export DSH_WEB_SEARCH_PROVIDER=ddgs` alone does not override the pin.
- The built-in DeepSeek provider reports `available()` even without a key (the
  key is resolved at search time), so it stays selected and `web_search` then
  fails with a missing-key error.

The sanctioned override is the profile's own patch layer, applied after every
bundle layer:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: web
  config:
    searchProvider: ddgs
    fetchProvider: http
```

The entry replaces the `web` service config map, so keep any other needed keys
(e.g. `fetchProvider: http` for `web_fetch`) in the same entry, then restart
`dsh web`.

`available()` here is cheap and local (no network): true when the venv exists
or `uv` is on `PATH` — the venv can be provisioned.

## Debugging

Run `dsh web` with `DEBUG=1` for `[web-search-ddgs]` log lines: plugin
apply/registration, provider availability, the managed-`uv` calls during venv
provisioning, and each search (`search:` … `search ok: N items`).

## Limits and caveats (MVP)

- **Rate limits are real.** Throttled backends surface as `ddgs exited with code 1: DDGSException: …` — the search is "broken but wired": the error is typed and visible in the tool result, no fake results.
- ddgs' own per-engine timeout is 10 s (Python side); the host-side `timeoutMs` is the outer bound.
- Yandex is upstream-disabled in ddgs; the bundled `ddgs-search.py` injects the engine only for `backend=yandex`.
- Search only — this plugin registers no fetch provider and no client UI.

## Tests

- `pnpm test` — unit tests (`tests/unit/server/**`; in-process doubles for the spawner/seam; no network).
- `pnpm test:e2e` — live e2e (`tests/e2e/server/**`; 120 s timeouts): `boot.test.ts` boots a live `dsh web` (0.2.0-rc.2, via `E2E_DSH_VERSIONS`) and asserts the plugin is listed and serves HTTP 200; `live-search.test.ts` runs a real duckduckgo search through the real runner; `backends.test.ts` runs one real search per backend over `duckduckgo`, `bing`, and `yandex` against a single shared venv. The live-search and backends tests self-skip when `uv` is absent, and both set `process.env.UV_CACHE_DIR` to the repo-local `.cache/uv` because the sandbox makes `~/.cache/uv` read-only.
- `pnpm e2e:live` — manually boots a throwaway `dsh web` on a clean home (the e2e launcher; `--keep` preserves the temp root).
- `pnpm typecheck` — strict tsc over `src/`.

## Development

See [AGENTS.md](./AGENTS.md) for project structure and
[../../AGENTS.md](../../AGENTS.md) for repo-wide principles + pitfalls.
