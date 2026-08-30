# web-search (ddgs) — research

## How dsh's current web_search works (2026-08-30)

Architecture is a capability seam (Service Definition / Provider / Consumer), all inside `dsh/` (symlink to deepseek-harness, readonly for research):

- **Service Definition**: `dsh/packages/web/web` — `ctx.web` with `registerSearchProvider(...)`.
- **Service Providers** (Cordis **function plugins**: `name` / `inject: ['web']` / `Config` (schemastery `z`) / `apply(ctx, config)`; no default export):
  - `dsh/packages/web/web-search-exa` — HTTP API, `apiKey` from `$EXA_API_KEY`.
  - `dsh/packages/web/web-search-perplexity` — LLM search.
  - `dsh/packages/web/web-search-deepseek` — native `web_search_20250305` server tool (the "deepseek api" one the current session runs on; reuses `DEEPSEEK_API_KEY`).
- **Consumer**: `dsh/packages/web/tool-web` — model-facing `web_search` + `web_fetch` tools over `ctx.web`.
  - `web_search` args: `{ queries: string[] }` (1–4, non-blank, deduped).
  - Result shape: `WebSearchResult { content?, sources: WebSearchSource[], truncated }`; `WebSearchSource { url, title?, snippet?, publishedAt? }`.
  - Formatting in `formatSearchOutput`; defaults: max 8 results, 4 queries, 30s timeout.
  - `defineTool` from `@deepseek-ai/dsh-tools`.

Reference provider plugin skeleton (web-search-exa/src/index.ts):
```ts
export const name = 'web-search-exa'
export const inject = ['web']
export const Config: z<Config> = z.object({...})
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new ExaSearchProvider({...}))
}
```
Provider class implements the `WebSearchProvider` service class default-exported by the `dsh-web` package.

**Key implication**: the MVP in this repo (`packages/dsh-web-search-ddgs`) can be a function plugin that registers a ddgs-backed `WebSearchProvider` into `ctx.web` — the existing `web_search` tool, schema, UI card, and presentation come for free.

## ddgs 9.16.0 internals (installed to `.ddgs-venv`, pip mirror works)

- Package layout: `ddgs/{ddgs.py, base.py, engines/, http_client.py, results.py, cli.py}`.
- `ENGINES` registry is built **at import time** in `ddgs/engines/__init__.py`: scans `engines/*` for `BaseSearchEngine` subclasses and **skips classes with `disabled = True`**.
- `Yandex` engine (`engines/yandex.py`): **exists but `disabled = True`** (author-disabled; same for `bing`). `DDGS._get_engines()` reads `ENGINES` at call time → injecting the class into `ENGINES["text"]` **after import activates it** (verified).
- `DDGS().text(query, backend=, max_results=, region=, timelimit=, page=)` → `list[{title, href, body}]` (TextResult; no date field for yandex). All engines fail → `DDGSException("No results found.")` or last error; per-engine timeout 5s default (`DDGS(timeout=...)`).
- Backend endpoints: duckduckgo→`html.duckduckgo.com` (POST), brave→`search.brave.com`, google→`www.google.com/wml/search`, grokipedia→`grokipedia.com`, mojeek→`www.mojeek.com`, startpage→`www.startpage.com` (POST), wikipedia→`{lang}.wikipedia.org` API, yahoo→`search.yahoo.com`, yandex→`yandex.com` (disabled). **No API keys** anywhere in text engines (grep of api_key/token/auth hits are in images/news/annasarchive/yahoo only, and those are non-text or different flows).
- **CLI `-o json` does NOT print JSON to stdout** — it saves `text_<query>_<timestamp>.json` into the cwd (unpredictable name). → MVP should ship its own small Python runner (JSON to stdout), not parse the CLI.

## Network whitelist (tested from this machine, 2026-08-30)

| host | reachable |
| ---- | --------- |
| **yandex.com** | **YES (HTTP 200, 0.7s)** |
| html.duckduckgo.com, search.brave.com, www.google.com, grokipedia.com, www.mojeek.com, www.startpage.com, en.wikipedia.org, search.yahoo.com, www.bing.com | NO (7s timeout) |

→ **yandex is the only usable ddgs backend on this network** — exactly the draft's hope ("тестировать на ya.ru"). The yandex engine works once enabled (see test below).

## yandex engine activation — verified working

Scratch script (`.dumbspec/current/web-search/scratch/yandex-test.py`) runs in `.ddgs-venv`:
```python
from ddgs import DDGS
from ddgs.engines import ENGINES
from ddgs.engines.yandex import Yandex
ENGINES["text"]["yandex"] = Yandex  # activates the author-disabled engine
DDGS(timeout=15).text(query=q, backend="yandex", max_results=5)
```
Query `Последняя версия react` → 5 real results (ru.wikipedia.org, react.dev/versions, github releases, habr.com). Output fields: `{title, href, body}` — maps to `WebSearchSource {url: href, title, snippet: body}` (`publishedAt` absent for yandex).

## uvx/uv quirks

- `uvx`/`uv` cache lives under `~/.cache/uv` + `~/.local/share/uv/tools` — **not writable** under the workspace-write sandbox. Fix: `UV_CACHE_DIR=<ws>/.uv-cache UV_TOOL_DIR=<ws>/.uv-tools` (uv config env vars). With that, `uvx ddgs text ...` works.
- `uv venv .ddgs-venv && uv pip install -p .ddgs-venv ddgs` → `ddgs==9.16.0` (+ lxml, primp). Python 3.14 venv.

## ddgs (from draft)

- Package: https://github.com/deedy5/ddgs (Python, on PyPI; local pip mirrors configured).
- CLI: `uvx ddgs text -b yandex -q "..."` (uvx = run a PyPI package in an ephemeral venv).
- On this machine `yandex` is NOT a backend: warning "yandex - backends do not exist or are disabled. Available: brave, duckduckgo, google, grokipedia, mojeek, startpage, wikipedia, yahoo", falls back to `auto`.
- User's internet is whitelist-restricted; hoped to test against ya.ru — currently impossible via ddgs (no yandex backend in current version).
- Constraint from draft: backends that require an API key are excluded.

## `WebSearchProvider` exact interface (dsh/packages/web/web/src/types.ts)

```ts
interface WebSearchProvider {
  readonly id: string
  available(): boolean   // cheap, local, no network
  search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<WebSearchResult>
}
// WebSearchResult = { content?: string; sources: { url, title?, snippet?, publishedAt? }[]; truncated: boolean }
```

- `ctx.web.search()` resolves the provider at call time; seam enforces `maxResults` (truncates + sets `truncated`).
- **Provider selection**: configured id (`searchProvider` config / `DSH_WEB_SEARCH_PROVIDER` env) wins; otherwise exactly ONE usable provider required; multiple usable → `WEB_PROVIDER_AMBIGUOUS` error. So a new ddgs provider coexisting with the deepseek one needs explicit selection (or the deepseek one must be unavailable/disabled).
- `registerSearchProvider` returns a disposer; duplicate id → `WEB_DUPLICATE_PROVIDER`.

## Local plugin wiring (from `packages/dsh-model-settings`)

- Function plugin: `name` + `apply(ctx)` (schemastery `z` Config optional; model-settings has none).
- Optional seams via `ctx.inject(['settings'], sctx => ...)` (model-settings) or top-level `export const inject = ['web']` (web-search-exa's pattern) + `ctx.web.registerSearchProvider(...)` inside `apply`.
- Package wiring: `package.json` field `dsh.bundle.patch: ./cordis.patch.yml` → `- insert: [{ id, name: '@apkawa/<pkg>' }]` mounts the plugin row into any profile installing the package.
- Build: `tsc -p tsconfig.json && tsdown` → `lib/`. Tests: vitest node env, doubles in `tests/unit/server/...`.
- Cordis version: `@deepseek-ai/cordis ^4.0.1` (peer + dev).
- So a provider plugin in this repo gets `ctx.web` automatically (the running dsh already has the web seam active — this session's `web_search` works).

## Rate-limit characteristics (measured)

- Bursts of ≥2 yandex requests within ~1–2s → `DDGSException("No results found.")`.
- Spaced single requests (6s apart) → all succeed (6.2s / 1.9s / 1.9s).
- → The provider MUST serialize searches (one subprocess at a time). The `web_search` tool fires up to 4 queries concurrently per call — serialization absorbs that.
- What yandex sends back under rate limit: not confirmed (raw fetch on failure also consumes the budget); the failure surfaces as ddgs' generic `No results found.` / last engine error.

## uvx overhead (measured, warm cache)

- `uvx --with ddgs python -c "pass"` → 3.7–13.0s (highly variable).
- → MVP default runner = **managed uv venv**: `uv venv <dir> && uv pip install -p <dir> ddgs` once (idempotent), then `<dir>/bin/python ddgs-search.py …` (~1–2s warm). `uvx` stays an escape hatch only.

## Network / registry access (2026-08-30)

- **npm registry (registry.npmjs.org): NOT reachable.** github.com: not reachable. → new packages may only use deps ALREADY installed in this pnpm workspace (`@deepseek-ai/cordis@4.0.1`, `@deepseek-ai/schemastery@3.18.1`, typescript, vitest, tsdown — all present via `packages/dsh-model-settings`).
- The `@deepseek-ai/dsh-web` types package is NOT installed locally (it's an in-dsh-monorepo package). → the new plugin declares the web-seam types LOCALLY (structural `WebSearchProvider` interface + `declare module '@deepseek-ai/cordis' { interface Context { web } }`), self-contained, no new deps. Runtime `ctx.web` comes from the host's dsh (the web seam is active in the user's profile — `web_search` exists this session).
- DeepSeek web-search provider is currently UNAVAILABLE in the user's live dsh (no `DEEPSEEK_API_KEY` — `web_search` call failed this session) → a new ddgs provider would be the single usable one → auto-selection works (no `WEB_PROVIDER_AMBIGUOUS`). If the deepseek key comes back, explicit selection is needed: `DSH_WEB_SEARCH_PROVIDER=ddgs` or `searchProvider: ddgs` in the web config.
- Upstream reason for the author-disabled yandex engine: unknown (github unreachable); the working-but-flaky behavior (intermittent "No results found" on bursts) is consistent with why scraping engines get disabled upstream.

## Local repo conventions for the new package (from `packages/dsh-model-settings`)

- pnpm workspace globs `packages/*` → the new package joins automatically.
- Function plugin: `name` + `Config` (schemastery `z`) + `apply(ctx, config)`; `inject` export optional (web-search-exa pattern uses `export const inject = ['web']`).
- `dsh.bundle.patch: ./cordis.patch.yml` → `- insert: [{ id, name: '@apkawa/<pkg>' }]` mounts the plugin row.
- Build: `tsc -p tsconfig.json && tsdown` → `lib/`; `pnpm typecheck` (never bare tsc); vitest node env; tests import `src/*.ts` directly; repo style: TDD, no jsdom, doubles, early returns, no `else`, no destructuring, no `try/catch` where possible, functional array methods.
- Unit test pattern: `new Context()` (real cordis Context) + in-memory service doubles; `ctx.plugin(…)`, `fiber.await()`, `fiber.dispose()`.
- E2E-live pattern: `scripts/e2e-live.mjs` boots a throwaway `dsh web` (temp `DSH_HOME`), `dsh plugin --profile web add <pkg>`, waits for the ready line; `tests/e2e/*.test.ts` + `pnpm test:e2e`.
- Scratch investigation artifacts (venv `.ddgs-venv`, `.uv-cache`, `.uv-tools`, probe scripts) live at the workspace root / under this task dir — they are NOT part of the shipped package; the shipped plugin creates its own managed venv under a configurable dir (default `~/.cache/dsh-web-search-ddgs/venv`).

## Questions resolved by this research

- `WebSearchProvider` interface: `id`, `available()`, `search({query, maxResults?}, signal?)` → `{content?, sources[], truncated}` (see section above).
- Local plugin wiring: `dsh.bundle.patch` insert row; function-plugin form; build/test conventions (see sections above).
- `ctx.web` availability: the web seam is active in the user's dsh profile (`web_search` works this session); the new package declares the seam types locally (no registry access for `@deepseek-ai/dsh-web`).
- ddgs internals: backends = engine classes in `engines/`; no API keys for text engines; yandex exists but `disabled = True`, activatable by ENGINES injection (verified); CLI `-o json` unsuitable (writes file, no stdout) → own runner script.
- Reachable backends: **only yandex** (all other hosts time out).

## Genuinely open (carried into the spec)

1. Upstream reason yandex was disabled — unreachable to confirm (github blocked); likely scraping fragility / anti-bot. The engine works when not bursted.
2. Provider selection: with the deepseek key restored, two usable providers → the user must pin `ddgs` (`DSH_WEB_SEARCH_PROVIDER=ddgs` / `searchProvider`) or disable deepseek. Documented, not fixed in MVP.
3. Managed-venv default location (`~/.cache/dsh-web-search-ddgs/venv`) — reasonable default, configurable.
