# 2026-10-16_utils-package: implementation plan (shared utils package with logger)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Write `draft.md` (raw input verbatim)
- [x] Initial `spec.md` skeleton from draft
- [x] Research: logger copies (F1), usage sites (F2), workspace config (F3), build/test setup (F4), plugin install / dependency resolution (F5)
- [x] Refine `spec.md` to v1 (format + decisions)
- [x] Write `plan.md`

**Criterion:** task dir has draft/research/spec/plan; branch `2026-10-16_utils-package` checked out; stage 0 committed.
**Commit:** `docs: add dumbspec task for shared utils logger package`

## Stage 1 — `packages/utils` package with the `Log` class
- [x] Create package skeleton: `packages/utils/package.json` (`@apkawa/utils`, `type: module`, `main: lib/index.js`, `exports` for `.` and `./package.json`, `files: ["lib"]`, scripts `build`/`test`/`typecheck`, devDeps `typescript` + `vitest` + `@types/node` matching the plugins), `tsconfig.json` (host-only variant: `exclude: ["tests"]`, emit to `lib/`), `vitest.config.ts` (node env, `include: ["tests/**/*.test.ts"]`), gitignore for `lib/` if not covered
- [x] Red: failing unit tests `packages/utils/tests/log.test.ts` — per-ns singleton (same ns → same instance), `newLog(sub)` hierarchy + singleton for sub-ns, output format `LEVEL [ns] msg` (uppercase level, bracketed ns), five levels (`log/info/warn/debug/error`), gating: non-error silent unless `DEBUG=1` (exact value), `error` always emitted
- [x] Green: implement `packages/utils/src/log.ts` (class `Log` with a module-level ns registry) and `packages/utils/src/index.ts` re-exporting it
- [x] Verify: `pnpm --filter @apkawa/utils test`, `typecheck`, `build` all green

**Criterion:** `@apkawa/utils` builds to `lib/` with declarations, unit tests green, typecheck clean.
**Commit:** `feat(utils): add @apkawa/utils package with Log singleton`

## Stage 2 — Migrate the three plugins to `utils/log`
- [x] `dsh-ghl`: add `@apkawa/utils` to `dependencies` (`workspace:*`), delete `src/log.ts` + `tests/unit/server/log.test.ts`, replace `dbg` with `new Log('ghl')` in `src/issues.ts`, `src/repo.ts`, `src/rpc.ts`, `src/cache.ts`
- [x] `dsh-model-settings`: add `@apkawa/utils` to `dependencies` (`workspace:*`), delete `src/log.ts` + `tests/unit/server/log.test.ts`, replace `dbg` with `new Log('model-settings')` in `src/index.ts`, `src/autofill.ts`, `src/probe.ts` (keep the `ctx.logger` lines untouched)
- [x] `dsh-web-search-ddgs`: add `@apkawa/utils` to `dependencies` (`workspace:*`), delete `src/log.ts` + `tests/unit/server/log.test.ts`, replace `dbg` with `new Log('web-search-ddgs')` in `src/index.ts`, `src/provider.ts`, `src/runner.ts`
- [x] `pnpm install` at repo root (links `@apkawa/utils`, updates lockfile)
- [x] Verify: `pnpm --filter @apkawa/dsh-ghl test/typecheck`, same for `dsh-model-settings` and `dsh-web-search-ddgs` — all green; no `dbg`/`src/log.ts` left in the three packages
- [x] (follow-up) fix 4 stale assertions in `dsh-ghl/tests/unit/server/cache.test.ts` to the new `DEBUG [ghl] …` line format; update the `log.ts`/`dbg` mentions in `dsh-model-settings/AGENTS.md` and `dsh-web-search-ddgs/AGENTS.md`

**Criterion:** the three packages build/typecheck/test green against `@apkawa/utils`; the copy-pasted loggers and their tests are gone; `dsh-global-queue` untouched.
**Commit:** `refactor(plugins): use shared @apkawa/utils logger`
