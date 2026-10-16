# Research — 2026-10-16_pnpm-catalog

## pnpm catalogs documentation (https://raw.githubusercontent.com/pnpm/pnpm/refs/heads/main/pnpm/docs/catalogs.md)

- Catalogs are defined in **`pnpm-workspace.yaml`** per the current pnpm docs (YAML, not JSON). The user's draft says `pnpm-workspace.json` — needs verification against the repo's actual workspace file and the installed pnpm version.
- `catalog:` (singular) = default catalog; `catalogs:` (plural) = named catalogs (`catalog:<name>` reference form).
- The `"catalog:"` placeholder works in `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` (not `resolutions`).
- Values are semver ranges; `workspace:` ranges in catalog entries supported since pnpm v12.2.0, `file:`/`link:` since v12.6.0.
- **Publishing is safe:** `pnpm publish` / `pnpm pack` rewrite `catalog:` to the concrete range in the published package.json (same as `workspace:`), so external consumers of a published plugin never see the literal `catalog:` string — including in `peerDependencies`.
- A codemod exists: `pnpx codemod pnpm/catalog`.

## Repo facts (scan of /home/apkawa/code/dsh-model-settings)

- Workspace file: **`pnpm-workspace.yaml`** exists (2 lines: `packages:` / `- packages/*`); **`pnpm-workspace.json` does NOT exist**. No `catalog:`/`catalogs:` section, no `overrides`. The user's draft example pointed at `pnpm-workspace.json` — the real file is YAML.
- pnpm version in use: **11.22.0** (supports catalogs; `workspace:` ranges *inside* catalog entries need pnpm ≥ 12.2.0 — not available here).
- Root `package.json`: private workspace root, `engines.node >=24.0.0`, scripts only, **no dependency sections**. No `packageManager` field.
- Lockfile `pnpm-lock.yaml`: v9.0, `autoInstallPeers: true`; **zero** `catalog:` usage today.

### Packages (5)

| Package | Name | Version |
|---|---|---|
| `packages/utils` | `@apkawa/utils` | 0.1.0 |
| `packages/dsh-ghl` | `@apkawa/dsh-ghl` | 0.1.0 |
| `packages/dsh-global-queue` | `@apkawa/dsh-global-queue` | 0.1.0 |
| `packages/dsh-model-settings` | `@apkawa/dsh-model-settings` | 0.1.1 |
| `packages/dsh-web-search-ddgs` | `@apkawa/dsh-web-search-ddgs` | 0.1.0 |

### Cross-package dependency matrix

**(a) Shared (2+ packages), IDENTICAL specifiers everywhere — 15 deps, all catalog candidates:**

| Dependency | Specifier | Packages (sections) |
|---|---|---|
| `@apkawa/utils` | `workspace:*` | ghl, model-settings, ddgs (deps) |
| `@deepseek-ai/cordis` | `^4.0.1` | ghl, global-queue, model-settings, ddgs (peer+dev) |
| `@deepseek-ai/schemastery` | `^3.18.1` | ghl, global-queue, model-settings, ddgs (peer+dev) |
| `@types/node` | `^22.20.0` | ghl, global-queue, model-settings, ddgs, utils (dev) |
| `typescript` | `^6.0.3` | ghl, global-queue, model-settings, ddgs, utils (dev) |
| `vitest` | `^4.1.8` | ghl, global-queue, model-settings, ddgs, utils (dev) |
| `react` | `^18.2.0` | ghl (peer+dev), global-queue (dev), model-settings (peer+dev) |
| `@playwright/test` | `^1.62.1` | ghl, global-queue, model-settings (dev) |
| `lightningcss` | `^1.32.0` | ghl, global-queue, model-settings (dev) |
| `tsdown` | `^0.22.2` | ghl, global-queue, model-settings (dev) |
| `@types/react` | `~18.3.1` | ghl, model-settings (dev) |
| `@deepseek-ai/dsh-client-connection` | `^0.2.0-rc.2` | ghl, model-settings (peer+dev) |
| `@deepseek-ai/dsh-client-modules` | `^0.2.0-rc.2` | ghl, model-settings (peer+dev) |
| `@deepseek-ai/dsh-client-ui-slots` | `^0.2.0-rc.2` | ghl, model-settings (peer+dev) |
| `@deepseek-ai/dsh-settings` | `^0.2.0-rc.2` | ghl, model-settings (peer+dev) |

**(b) Shared with DIFFERENT specifiers:** none — every shared dep uses one identical specifier everywhere. The "pick one version" question from the draft is moot.

**(c) Single-package only (stay as-is):**
- `@deepseek-ai/dsh-home-paths` `0.2.0-rc.2` — global-queue (dependencies)
- `@deepseek-ai/dsh-web` `0.2.0-rc.2` — ddgs (devDependencies)

### Catalog-readiness notes

- `@apkawa/utils` (`workspace:*`) **cannot** be a catalog entry: `workspace:` ranges inside catalogs require pnpm ≥ 12.2.0 (we have 11.22.0), and semantically it is a workspace-internal package.
- The two exact-pin single-package deps (`dsh-home-paths`, `dsh-web`) are not shared → stay literal.
- All 14 shared third-party deps (excluding `@apkawa/utils`) are clean catalog candidates with no version conflicts.
- Publishing safety: `pnpm publish`/`pack` rewrites `catalog:` to concrete ranges, so `peerDependencies` in published packages stay correct (per pnpm docs).
- Hard constraint from repo AGENTS.md: frozen installs only (`pnpm install --frozen-lockfile`), cache via `pnpm_config_store_dir=./.cache/pnpm/v11`.
