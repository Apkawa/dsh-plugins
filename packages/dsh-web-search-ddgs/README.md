# @apkawa/dsh-web-search-ddgs

A ddgs-backed web-search provider for DeepSeek Harness (`dsh web`). It registers
a `WebSearchProvider` on the `ctx.web` seam — the same seam the built-in DeepSeek
provider uses — so the `web_search` tool runs on
[ddgs](https://github.com/deedy5/ddgs) with no API keys.

## What it does

- Registers the `ddgs` search provider on `ctx.web` (host-side Cordis plugin, no client half).
- Runs ddgs in a **managed uv venv** (default `~/.cache/dsh-web-search-ddgs/venv`): provisioned lazily on first search (`uv venv` + `uv pip install ddgs`), self-healed if the ddgs install goes missing.
- Default backend: **duckduckgo** (keyless). Yandex is optional — it is disabled upstream in ddgs and this package re-enables it at runtime when `backend: yandex`.
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

The `ctx.web` seam resolves the provider at call time. A configured id wins —
`searchProvider` from the `web` service config, falling back to the
`DSH_WEB_SEARCH_PROVIDER` env var only while the config field is unset. With
no configured id, exactly one usable registered provider is auto-selected;
several usable ones give `WEB_PROVIDER_AMBIGUOUS`.

In practice the stock `web` profile needs an explicit pin, for two reasons:

- `dsh-base` sets `searchProvider: deepseek-official` in the `web` service
  config — config beats env, so `export DSH_WEB_SEARCH_PROVIDER=ddgs` alone
  does **not** override the pin.
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

- `pnpm test` — unit tests (in-process doubles for the spawner/seam; no network).
- `pnpm test:e2e` — live e2e: boots an independent `dsh web` with the plugin linked (boot) and runs a real ddgs search through the real runner (self-skips when `uv` is absent).
- `pnpm e2e:live` — manually boots a throwaway `dsh web` on a clean home (the e2e launcher; `--keep` preserves the temp root).
- `pnpm typecheck` — strict tsc over `src/`.
