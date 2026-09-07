# playwright_e2e_tests: implementation plan (playwright e2e acceptance for plugins)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

Review decisions: runner `@playwright/test`; keyless mandatory (assert only what renders without models); minimal smoke depth; `dsh-model-settings` first, second plugin optional. Branch: `web-search` (user-owned).

---

## Stage 0 — research + spec + plan
- [x] Draft captured (`.dumbspec/current/playwright_e2e_tests/draft.md`)
- [x] Research: reference e2e setup, existing repo e2e, `DSH_HOME`/profile mechanics, tokenized ready URL, sandbox playwright availability → research.md
- [x] Spec written and reviewed; open questions resolved (runner, key policy, assertion depth, scope)
- [x] Plan written

**Criterion:** all four task files exist and no open question remains outside the Stage 1 spike.
**Commit:** `docs(playwright-e2e-tests): spec + plan for plugin e2e acceptance`

## Stage 1 — Spike: validate open unknowns
- [ ] Keyless UI: temp `DSH_HOME` + built plugin, headless chromium on the ready URL without `DEEPSEEK_API_KEY` — record exactly what the model-settings UI renders (fact → research.md)
- [ ] How the existing `e2e-live` gets the plugin into the test home (trace the code path; fact → research.md)
- [ ] Offline local plugin add: `dsh plugin --profile web add <local path>` on a fresh profile without network; the plugin must land in `dsh.profile.bundles` and the home must boot
- [ ] Browser reuse: a fresh `@playwright/test` install resolves chromium from the shared `~/.cache/ms-playwright` via env vars (`XDG_CACHE_HOME`/`PLAYWRIGHT_BROWSERS_PATH`) without a network `playwright install`

**Criterion:** every unknown has a recorded fact in research.md; spec/plan adjusted where a fact contradicts them.
**Commit:**

## Stage 2 — Red: failing playwright e2e
- [ ] `pnpm add -D @playwright/test` in the package (store `./.cache/pnpm/v11`; if offline install is impossible — stop and report)
- [ ] Package-local `playwright.config.ts`: testDir `tests/e2e`, chromium project, `workers: 1`, trace/screenshot on failure, sane timeouts; no `webServer` block (instance is spawned by the test)
- [ ] `tests/e2e/acceptance.spec.ts` (red): launch the test home with the plugin, `page.goto(readyUrl)` (tokenized URL, `dsh web --port 0 --no-open`), assert the plugin section renders + `trackConsoleErrors(page)()` returns `[]`; references launcher helpers that do not exist yet

**Criterion:** the test exists, is wired to `pnpm test:e2e`, and fails for the right reason (missing infrastructure), not a syntax/config error.
**Commit:**

## Stage 3 — Green: implement until the test passes
- [ ] Extend the e2e-live launcher utils (or a thin new helper in the same style): ephemeral `--port 0` + tokenized URL parse, fresh-profile plugin-add step, `pnpm build` of the plugin client half before launch, browser env vars for the shared browser cache, keyless env (no API-key env inherited)
- [ ] Port `trackConsoleErrors` (console + pageerror hooks, returns a collector) in the reference style
- [ ] Make the acceptance test pass; keep the existing browserless `e2e-live` passing unchanged
- [ ] Wire the `test:e2e` script in `packages/dsh-model-settings/package.json`

**Criterion:** `pnpm test:e2e` green in a clean env (no `DEEPSEEK_API_KEY`, real `~/.dsh` untouched); existing `e2e-live` still green.
**Commit:**

## Stage 4 — Refactor + optional second plugin
- [ ] Refactor: launcher additions stay minimal and reusable across plugin packages (per-package structure as is, no premature shared-package abstraction)
- [ ] (Optional, only if cheap) `dsh-web-search-ddgs` acceptance test reusing the same helper; otherwise record why it is deferred in the spec

**Criterion:** Stage 3 green still passes; optional plugin test green or explicitly deferred with a reason.
**Commit:**
