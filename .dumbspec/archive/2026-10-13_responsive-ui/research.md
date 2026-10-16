# 2026-10-13_responsive-ui: research

Context collection for: loading-spinner feedback in the dsh-ghl client UI (slow API on issue list / issue detail). Gathered by a synchronous research subagent (read-only scan of `packages/dsh-ghl` and the dsh harness).

## 1. Package structure (client half)

- Client half lives entirely in `packages/dsh-ghl/src/client/`:
  - `client/index.ts` — RPC client + shared issue snapshot store + tab registration (`apply` at `:230–269`).
  - `client/IssuePane.tsx` — the React component (tab body).
  - `client/format.ts` — pure display helpers.
  - `client/issue-pane.module.css` — CSS module.
- Framework: **React 18** (`package.json:44` peer), built by **tsdown** to a single CJS bundle `lib/client.js` loaded via `window.__ModuleLoader__.load` (`tsdown.config.ts:95–97`). CSS Modules compiled by lightningcss, injected as `<style data-plugin>` (`tsdown.config.ts:37–49, 79–88`). Test env is `node`, **no jsdom** (`vitest.config.ts:5`).
- State: module-level snapshot store in `client/index.ts` — `state = { repo, issues, selected, error }` (`:108`), `Set` of listeners (`:109`), getters `getRepo/getIssues/getSelected/getError` (`:120–137`), `subscribe` (`:112–117`), actions `refresh`/`select`/`back` (`:146, :184, :200`). RPC seam injectable: `setRpc` (`:100–105`).
- `IssuePane` mirrors the store into local React state via `useState` + `useEffect` subscribe (`IssuePane.tsx:24–44`); workspaces via `useSyncExternalStore` hook handed by the seat (`client/index.ts:240–244`).
- Mounting: `apply` registers tab type `@apkawa/dsh-ghl` (kind `ghl`, title "Issues", Start-page guide entry) into `ctx.sidebarRightTabs` (`client/index.ts:249–258`) and the body under seat `sidebar.right.pane.tab` (`:262–266`); fires `void refresh()` at startup (`:268`).
- Bundle wiring: `dsh.client` block `package.json:21–30` (injects `dsh-client-connection`, `-modules`, `-ui-slots`, `-ui-sidebar-right`, `-workspace`); `cordis.patch.yml:4–6`.

## 2. UI interactions that trigger API requests

Exactly two API-triggering interactions:

- **Issue list** — `refresh(workspacePath?, force?)` in `client/index.ts:146–181` (`detectRepo` + `listIssues` RPC). Triggered from:
  - startup: `apply` → `void refresh()` (`client/index.ts:268`);
  - pane mount / workspace change: `useEffect` (`IssuePane.tsx:35–44`);
  - Reload button in error state (`IssuePane.tsx:52`);
  - Refresh button: `onClick={e => void startRefresh(e.ctrlKey)}`; `startRefresh` sets a **local** `refreshing` flag, awaits `refresh`, clears it (`IssuePane.tsx:29–34, :100`). `force` (Ctrl-click) clears the host cache (`client/index.ts:148`, `src/rpc.ts:177`).
- **Issue detail** — `select(number, workspacePath?)` in `client/index.ts:184–197` (`getIssue` RPC, sets `state.selected`). Triggered by row click (`IssuePane.tsx:111`).
- `Back` button (`IssuePane.tsx:70`) → local `back()` (`client/index.ts:200–203`), no RPC. "View on GitHub" is a plain anchor.

## 3. Existing spinner / UI conventions

- **No spinner in `packages/dsh-ghl`** — no `spinner`/`skeleton`/`loading` identifier in the package source (only the comment at `IssuePane.tsx:28`: "The store has no in-flight flag"). Only in-flight feedback today: Refresh button `disabled` (`issue-pane.module.css:179–182`).
- Siblings: `dsh-model-settings` renders loading as plain text (`card.tsx:45`, `ReasoningSection.tsx:47`) driven by `phase: 'loading' | 'ready' | 'error'` (`controller.ts:28,76,98`); `dsh-global-queue` has no RPC-loading indicator.
- **In the dsh harness** (`dsh/` symlink):
  - `dsh/packages/client/ui-primitives/src/StateDot.tsx` — shared primitive; `state="ongoing"` renders an animated SVG spinner (`StateDot.tsx:40–57`), CSS `StateDot.module.css:37–95` (1.5s spin/dash, `prefers-reduced-motion` fallback). Exported from the package index (`index.ts:6`), documented in its README (`README.md:54`).
  - `dsh/packages/client/ui-sidebar-documentpreview/src/client/LoadingIndicator.tsx` — built on `StateDot` but is a **feature plugin**; per dsh export discipline (`dsh/packages/client/AGENTS.md`), a feature plugin MUST NOT import another feature plugin — so it is NOT reusable from dsh-ghl. `ui-primitives` is the only shared home.
  - `dsh/packages/client/ui-primitives/src/TextShimmer.tsx` — shimmer text primitive (exported).
- **Importability:** `packages/dsh-ghl/tsdown.config.ts:11–20` already lists `@deepseek-ai/dsh-client-ui-primitives` among `PLATFORM_MODULES` externals, so the specifier rides the shared module table if imported; it is **not** currently a declared dependency of dsh-ghl.
- Pane UI conventions (`issue-pane.module.css`): colors only via `--dsw-alias-*` theme tokens; CSS Modules (`css` import, `IssuePane.tsx:3`); 14/22 title, 12/18 caption, hairline row separators; ghost sm capsule buttons (`.back`/`.ghost`); `data-testid` hooks throughout (`ghl-pane`, `ghl-error`, `ghl-missing-repo`, `ghl-detail`, `ghl-row`, `ghl-refresh`, …).

## 4. API call flow

- No direct fetch in the client: `connection.rpc.call('/ghl', method, payload)` over the dsh carrier (`client/index.ts:89–94`); failures throw typed `RpcError` with `code`/`message`/`details` (`client/index.ts:17–29, :92`).
- Host: `/ghl` prefix route mounted on the host `webServer` via nested `ctx.inject(['webServer'], …)` (0.2.0-rc.2 host-RPC workaround) — `src/index.ts:58–60`; `mountChannel` `src/rpc.ts:53–60`, handler `rpc.ts:135–160`.
- Wire shape: POST JSON `{ type: 'client-request', rpcId, method, payload }` (`rpc.ts:63–70`); response `{ type: 'server-response', rpcId, result }` with `result = { ok: true, value } | { ok: false, error: { code, message, details } }` (`rpc.ts:19, :159`). Endpoints: `detectRepo` (`rpc.ts:166–170`), `listIssues` (`rpc.ts:171–180`, `force` strictly-true clears cache at `:177`), `getIssue` (`rpc.ts:181–188`). Error codes: `no-workspace`, `ambiguous-workspace`, `no-remote`, `not-github` (`rpc.ts:46–48`), `not-found`, `rate-limit`, `internal` (`rpc.ts:192–198`).
- Backend: `GitHubIssue` (`src/issues.ts:84–119`) does the only real fetch — public GitHub REST `api.github.com/repos/{owner}/{repo}/issues[/{number}]` (`issues.ts:128,134`), unauthenticated, behind TTL/budget cache (`src/cache.ts`); 403/429 → `RateLimitError`, 404 → `IssueNotFoundError` (`issues.ts:105–106`).
- UI error handling today: last failure recorded in `state.error` (`client/index.ts:108,156,174,190`); `IssuePane` renders a dedicated error block that **replaces** normal views while `error !== null` (`IssuePane.tsx:46–56`); failed `select` keeps previous selection (`client/index.ts:188–192`). **No in-flight/loading state in the store** — a slow `select` gives zero visual feedback; only the Refresh button's local `refreshing` disable.

## 5. Tests

- Unit (client), vitest `node`, fake RPC via `setRpc`:
  - `tests/unit/client/issue-store.test.ts` — `refresh` detect+list, subscribe, no-repo skip, `workspacePath`/`force` payload shapes; `select` fetches by number, sets selection, publishes; `back` clears selection.
  - `tests/unit/client/issue-store-error.test.ts` — failure envelopes (detection clears repo, list failure keeps repo/clears list, success clears error; `select` failure keeps previous selection).
  - `tests/unit/client/rpc-client.test.ts` — `callRpc` throws typed `RpcError`.
  - `tests/unit/client/format.test.ts` — `statusToken`, `issueRef`.
  - **No component/rendering tests for `IssuePane.tsx`** (no jsdom).
- E2E: `tests/e2e/server/boot.test.ts` (dsh web boots with plugin, HTTP 200), `tests/e2e/server/rpc.test.ts` (pins `/ghl` contract, no browser), `tests/e2e/acceptance.spec.ts` (playwright: opens pane, asserts `ghl-pane` + `ghl-missing-repo`; **no coverage of list-load / detail-load states**).
- Host-side unit tests exist for provider/cache/RPC dispatch over in-process doubles.

## 6. Stage 2b root-cause investigation (2026-10-16, synchronous subagent, read-only)

Static trace of the current source found **no logic defect** that produces the stuck-loading symptom:

- `select` clears `issueLoading` *before* the settled publish (`client/index.ts:214-215`); success publishes at `:215`, failure at `:209`.
- The pane mirror reads all six decision fields via fresh getters on every publish and calls stable setters (`IssuePane.tsx:34-41`); loading block gated by mirrored `issueLoading` at `IssuePane.tsx:77-86`, detail at `:88-104`.
- In-flight publish #1 and settled publish #2 land in distinct tasks; no stale-value capture, no equality bailout (both `selected` null→issue and `issueLoading` true→false change).
- Store two-publish contract independently confirmed by passing tests (`issue-store.test.ts:214-230`, 28/28 store tests green).

**Why remount fixes it (mechanism):** on remount the `useState(getSelected)` / `useState(getIssueLoading)` initializers re-seed the mirror from the *current* store (`IssuePane.tsx:27,30`), which already holds the settled state — the diagnostic signature of "live mirror out of sync, fresh store read correct".

**Fix target (described, not implemented):** replace the hand-rolled mirror at `IssuePane.tsx:25-44` (six `useState` + `useEffect`/`subscribe`) with `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` over the stable module `state` reference (`index.ts:108`). `useSyncExternalStore` is already imported in `client/index.ts:8` and used for the workspace selector at `:260`. Removes the whole class of missed-publish/stale-subscription windows; no store change required.

**Ranked runtime candidates for the real symptom (not visible in source):**
1. **Stale served `lib/client.js`** — browser served an old tsdown build / no page reload after the client change (cheapest to verify first).
2. `workspacePath` reference change during in-flight `select` → effect unsubscribe/re-subscribe + `refresh()` re-fire (`IssuePane.tsx:42-44`); a StrictMode double-invoke interleaving was not fully ruled out by reading.
3. React 18 concurrent-mode scheduling nuance in the `useState`-mirror pattern (could not be simulated without a DOM; the package has no jsdom / react-test-renderer).

**Unverified:** whether the host shell renders the pane under React StrictMode (not visible from this package).
