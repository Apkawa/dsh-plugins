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
3. `uv` must be on `PATH` — it provisions the managed venv on first search.
4. Restart `dsh web` (host-side plugin: a full restart is required, not a page reload).

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

The `ctx.web` seam resolves the provider at call time:

- exactly one usable provider → auto-selected (typical case when DeepSeek's key is absent);
- several usable providers → `WEB_PROVIDER_AMBIGUOUS` — pin explicitly:

  ```sh
  export DSH_WEB_SEARCH_PROVIDER=ddgs
  ```

  (`DSH_WEB_SEARCH_PROVIDER` / `fetchProvider` are the seam's own config fields, not a hidden priority chain.)
- a configured id that is registered but unavailable → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.

`available()` is cheap and local (no network): true when the venv exists or `uv` is on `PATH` — the venv can be provisioned.

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
