# 2026-10-16_pnpm-catalog: implementation plan (pnpm catalog)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Draft captured (draft.md)
- [x] pnpm catalogs docs reviewed (catalogs live in pnpm-workspace.yaml; `catalog:` works in deps/devDeps/peerDeps; publish rewrites `catalog:`)
- [x] Dependency inventory gathered (15 shared deps, 14 third-party candidates, 2 single-package stay)
- [x] Spec v1 written, open questions resolved
- [x] Plan written

**Criterion:** draft.md, research.md, spec.md, plan.md exist and are committed; no open questions.
**Commit:** `docs(dumbspec): add pnpm-catalog task spec and plan`

## Stage 1 — Catalog section + package.json migration
- [x] Add `catalog:` block to `pnpm-workspace.yaml` with the 14 shared deps (exact existing specifiers)
- [x] Replace specifiers with `catalog:` in `packages/utils/package.json`
- [x] Replace specifiers with `catalog:` in `packages/dsh-ghl/package.json`
- [x] Replace specifiers with `catalog:` in `packages/dsh-global-queue/package.json`
- [x] Replace specifiers with `catalog:` in `packages/dsh-model-settings/package.json`
- [x] Replace specifiers with `catalog:` in `packages/dsh-web-search-ddgs/package.json`
- [x] Update `pnpm-lock.yaml` via `pnpm_config_store_dir=./.cache/pnpm/v11 pnpm install`; verify resolved versions are unchanged from before
- [x] Verify: `pnpm typecheck` and `pnpm build` pass for all packages

**Criterion:** no literal shared-dep version remains in any package.json (only `catalog:`); lockfile resolves the same versions as before; typecheck + build green.
**Commit:** `chore: move shared dependency versions into pnpm catalog`
