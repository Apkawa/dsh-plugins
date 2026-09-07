# playwright_e2e_tests: implementation plan (playwright e2e acceptance for plugins)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

Review decisions: runner `@playwright/test`; keyless mandatory (assert only what renders without models); minimal smoke depth; `dsh-model-settings` first, second plugin optional; dsh version selectable via env, baseline **0.1.1-rc.2** (plugins work on it; PATH dsh 0.1.2-rc.1 is broken for the plugin — task `fix_0.1.2-rc1`). Branch: `web-search` (user-owned).

---

## Stage 0 — research + spec + plan
- [x] Draft captured (`.dumbspec/current/playwright_e2e_tests/draft.md`)
- [x] Research: reference e2e setup, existing repo e2e, `DSH_HOME`/profile mechanics, tokenized ready URL, sandbox playwright availability → research.md
- [x] Spec written and reviewed; open questions resolved (runner, key policy, assertion depth, scope)
- [x] Plan written

**Criterion:** all four task files exist and no open question remains outside the Stage 1 spike.
**Commit:** `docs(playwright-e2e-tests): spec + plan for plugin e2e acceptance`

## Stage 1 — Spike: validate open unknowns
- [x] Keyless UI: temp `DSH_HOME` + built plugin, headless chromium on the ready URL without `DEEPSEEK_API_KEY` — record exactly what the model-settings UI renders (fact → research.md)
- [x] How the existing `e2e-live` gets the plugin into the test home (trace the code path; fact → research.md)
- [x] Offline local plugin add: `dsh plugin --profile web add <local path>` on a fresh profile without network; the plugin must land in `dsh.profile.bundles` and the home must boot
- [x] Browser reuse: a fresh `@playwright/test` install resolves chromium from the shared `~/.cache/ms-playwright` via env vars (`XDG_CACHE_HOME`/`PLAYWRIGHT_BROWSERS_PATH`) without a network `playwright install`
- [x] dsh version provisioning: obtain a runnable `@deepseek-ai/dsh@0.1.1-rc.2` (e.g. `pnpm dlx` / versioned install into `./.cache`), verify a temp home boots on it and the plugin loads; record the provisioning path (fact → research.md)

**Criterion:** every unknown has a recorded fact in research.md; spec/plan adjusted where a fact contradicts them.
**Commit:** `docs(playwright-e2e-tests): Stage 1 spike findings + spec/plan adjustments`

## Stage 2 — Red: failing playwright e2e
- [x] `pnpm add -D @playwright/test@1.62.1` in the package (the only version matching cached chromium-1234; install env: `pnpm_config_store_dir=./.cache/pnpm/v11`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; if install is impossible — stop and report) — note: `pnpm add` was impossible repo-wide (broken resolving installs, see research.md); the exact `pnpm add` output was hand-applied, then frozen `CI=true pnpm install`
- [x] Package-local `playwright.config.ts`: testDir `tests/e2e`, chromium project, `workers: 1`, trace/screenshot on failure, sane timeouts; no `webServer` block (instance is spawned by the test) — ESM package → `import.meta.url` (no `__dirname`); `testMatch '**/*.spec.ts'` keeps the vitest lane out
- [x] `tests/e2e/acceptance.spec.ts` (red): launch the test home with the plugin on the **0.1.1-rc.2** binary, `page.goto(readyUrl)` (use the URL printed on the ready line as-is — plain on 0.1.1-rc.2, tokenized `?token=` on 0.1.2+; `dsh web --port 0 --no-open`), assert the plugin section renders + `trackConsoleErrors(page)()` returns `[]`; references launcher helpers that do not exist yet (`./live` → Stage 3)

**Criterion:** the test exists, is wired to `pnpm test:e2e`, and fails for the right reason (missing infrastructure), not a syntax/config error. (Accepted with interpretation: the `test:e2e` *script* wiring is the Stage 3 checkbox by plan design; at this stage the runner wiring = package-local config + `pnpm exec playwright test`, verified. Red failure = `Cannot find module '…/tests/e2e/live'`.)
**Commit:** `test(dsh-model-settings): failing playwright e2e acceptance skeleton`

## Stage 3 — Green: implement until the test passes
- [x] Extend the e2e-live launcher (`scripts/e2e-live.mjs`) — or a thin new helper reusing its plugin-add step — in the same style: dsh binary selection (env `E2E_DSH_BIN`, default the provisioned 0.1.1-rc.2, fallback PATH `dsh`), ephemeral `--port 0` + ready-URL parse (plain URL on 0.1.1-rc.2, tokenized on 0.1.2+), fresh-profile plugin-add step (`dsh plugin --profile web add <abs path>`), `pnpm build` of the plugin client half before launch (require `lib/index.js` + `lib/client.js`), browser env for the shared cache (`~/.cache/ms-playwright` — Playwright's Linux default; set `PLAYWRIGHT_BROWSERS_PATH` explicitly only if needed), keyless env (no API-key env inherited) — done as a thin new helper `tests/e2e/live.ts` (the vitest-lane `scripts/e2e-live.mjs` untouched)
- [x] Port `trackConsoleErrors` (console + pageerror hooks, returns a collector) in the reference style — severity-filtered (error/warning + pageerror); the benign `[VERBOSE] [DOM] Password field…` note is excluded by design
- [x] Make the acceptance test pass; keep the existing browserless `e2e-live` passing unchanged — playwright lane green (1 passed, keyless, ~6 s); the vitest lane is byte-unchanged but is red on this machine for a **pre-existing external** reason: PATH dsh 0.1.2-rc.1 tokenized ready URL vs the old launcher's untokenized readiness GET → 401 (no-plugin control: GET 303 → follow → 401); independent of this diff; covered by task `fix_0.1.2-rc1` (fact → research.md)
- [x] Wire the `test:e2e` script in `packages/dsh-model-settings/package.json` — **user decision**: chain `vitest run --config vitest.e2e.config.ts && pnpm exec playwright test`; stays red on the vitest leg until `fix_0.1.2-rc1`; the playwright leg remains runnable separately (`pnpm exec playwright test`)

**Criterion:** `pnpm test:e2e` green in a clean env (no `DEEPSEEK_API_KEY`, real `~/.dsh` untouched); existing `e2e-live` still green. — **Accepted under the user-approved adjustment**: chain wiring as decided; playwright leg green in a clean keyless env (`~/.dsh` mtime unchanged); the vitest leg's redness proven pre-existing (plugin-independent control) and not a regression.
**Commit:** `test(dsh-model-settings): playwright e2e acceptance green (keyless, dsh 0.1.1-rc.2)`

## Stage 4 — Refactor + optional second plugin
- [ ] Refactor: launcher additions stay minimal and reusable across plugin packages (per-package structure as is, no premature shared-package abstraction)
- [ ] (Optional, only if cheap) `dsh-web-search-ddgs` acceptance test reusing the same helper; otherwise record why it is deferred in the spec

**Criterion:** Stage 3 green still passes; optional plugin test green or explicitly deferred with a reason.
**Commit:**
