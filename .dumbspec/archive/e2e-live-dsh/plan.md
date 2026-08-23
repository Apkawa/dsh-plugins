# e2e-live-dsh: implementation plan (live clean dsh instance)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Draft captured verbatim + user clarifications (`draft.md`)
- [x] Research: home isolation (`DSH_HOME`), dsh live-web e2e pattern (`smoke-real.e2e.ts`), profile/plugin install mechanics, installed CLI flags/shutdown, live profile wiring, plugin build state
- [x] Spec written and reviewed with the user (Q1–Q4 resolved: port 3081, no auto-build, script in package, no RPC self-check)
- [x] Plan written

**Criterion:** all four artifacts exist; spec reflects the user's answers.
**Commit:** `docs(spec+plan): e2e-live-dsh — independent clean-home dsh web instance`

## Stage 1 — Launcher `scripts/e2e-live.mjs` (red → green)
- [x] Red: `pnpm e2e:live` from the package fails (alias/script absent) — recorded (`exit=1`, `Command "e2e:live" not found`)
- [x] Green: `scripts/e2e-live.mjs` — mkdtemp root (`.dsh`/`.agents`); `lib/` artifact check (explicit error → `pnpm build`); `dsh plugin --profile web add <abs package path>`; spawn `dsh web --port <port>` (default **3081**, `--port` override) with `DSH_HOME`/`DSH_AGENTS_HOME` + cwd = temp root; ready = `dsh web: http://…` line (90 s) + `GET 200`; print URL + temp root; stay in foreground
- [x] Green: down-path — SIGINT/SIGTERM → `SIGTERM` child → wait → `rm` temp root unless `--keep`; loud errors: missing `dsh`/`pnpm`, missing artifacts, busy port, ready timeout, early child exit
- [x] Green: package.json script `"e2e:live": "node scripts/e2e-live.mjs"`
- [x] Green run (in-session, self-contained per run): `http://127.0.0.1:3081` + `GET 200`; SIGTERM → exit 0, temp root gone; busy port → exit 1 + «port 3081 is already in use — free it or pass --port <n>»
- [x] Verify real `~/.dsh` untouched (per-run `find -newer` marker: only the live session's own session/projcache writes)

**Criterion:** spec acceptance items 1–5 all hold.
**Commit:** `feat(e2e-live): independent clean-home dsh web instance launcher`

## Stage 2 — Verify "dependency plugged in" (live check)
- [x] Start the instance (background job in-session), wait for ready URL
- [x] Clean-home wiring check: profile `package.json` shows `@apkawa/dsh-model-settings: link:<package>` in dependencies + bundles; host half proven live — RPC `POST <url>/model-settings/listModels` → `result.ok:true` (a clean home: `value:[]`)
- [ ] Browser check: open the URL → no "Failed to load plugins", Settings → "Model settings" section visible — **deferred to the user** (chromium SIGTRAPs inside the harness sandbox; "Model settings" is absent from the prebuilt `dsh-web-frontend` dist, so the client half's delivery path is still unverified — see research findings)
- [x] Teardown: stop the job, temp root gone; live `:3080` instance and `~/.dsh` untouched

**Criterion:** the clean instance serves the Model settings section; live instance untouched. (Browser half open until the user's manual check.)
**Commit:** — (verification only, no code changes)

## Stage 3 — Browserless e2e checks (`scripts/e2e-live-checks.mjs`)
- [x] Two checks driving the launcher black-box on port **3091**:
  - cold: `listModels` / `listReasoningRows` → `ok:true`, no rows on a clean home
  - warm: write one model into `<root>/.dsh/settings.yaml` (host commits the file edit), poll until the host sees it, then `saveModel` roundtrip (`efforts {low: low}` + `contextWindow 16000`) verified via `listReasoningRows`
- [x] Run in the clean in-session environment (no internet): all checks green, exit 0 (9/11 checks; the first run caught a real launcher bug — `--port <n>` value misparsed — fixed in its own commit)

**Criterion:** our `/model-settings` handles are verified end-to-end without a browser and without internet.
**Commit:** `test(e2e-live): browserless live checks (cold home + warm settings roundtrip)`
