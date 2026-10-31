# 2026-10-29_dsh-attach-editor: implementation plan (attach editor before send)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan

- [x] Capture raw request into `draft.md`
- [x] Initial spec skeleton from the draft
- [x] Research R1-R2: plugin package anatomy + right-sidebar tab API (`packages/dsh-global-queue`, `dsh/packages/client/ui-sidebar-right`)
- [x] Research R6: attachment model, composer rail slots, preview, pre-send replacement seams
- [x] Research R7: dependency budget + tooling (fabric/konva/react-dom/jsdom absent; frozen lockfile)
- [x] Spec v1 with resolved decisions (vanilla canvas engine, rail replacement, createDrafts+add/remove)

**Criterion:** `draft.md`, `research.md`, `spec.md` exist in `current/2026-10-29_dsh-attach-editor/`; spec has `Created` + `Changes`; every open question from the draft is either answered or explicitly deferred.
**Commit:** `docs(spec): attach editor draft, research, and v1 spec`

## Stage 1 — `packages/image-editor` scaffold + lockfile unlock

- [x] `packages/image-editor/package.json`: `@apkawa/image-editor`, `exports: { ".": "./lib/index.js" }`, devDeps only catalog entries (`typescript`, `vitest`, `tsdown`, `@playwright/test`, `@types/react` NOT needed — no React), scripts `build`/`typecheck`/`test`/`test:e2e`
- [x] `tsconfig.json` (emit `lib/`, `lib: [ES2024, DOM, DOM.Iterable]`, `types: []`) + `vitest.config.ts` (node env, `tests/**/*.test.ts`) + `playwright.config.ts` (no webServer/baseURL, `testMatch '**/*.spec.ts'`, output `.tmp/playwright/image-editor`)
- [x] `tsdown.config.ts`: standalone ESM browser bundle `dist/editor.js`, `platform: 'browser'`, `external: []`, no module-loader banner (`external` is deprecated upstream — repo-wide warning, kept for consistency)
- [x] **User gate:** lockfile update approved and done — `pnpm install` added the new importer (+15 lines, additions only, catalog versions unchanged)
- [x] `src/index.ts` placeholder export (`EditorTool` + `EDITOR_TOOLS`) with one real unit assertion — typecheck/test/build green

**Criterion:** `pnpm --filter @apkawa/image-editor typecheck && pnpm --filter @apkawa/image-editor test` pass with zero dsh imports anywhere in the package (`rg '@deepseek-ai' packages/image-editor` → no matches).
**Commit:** `feat(image-editor): scaffold standalone editor package`

## Stage 2 — Scene model + drawing tools (pure logic, node tests)

- [x] Red: `tests/unit/scene.test.ts` — shape kinds `marker | highlighter | arrow | rect | text`, defaults (color red `#E5484D`, highlighter yellow `#FFD666` + opacity 0.4), add/remove, id stability
- [x] Green: `src/scene.ts` — scene state, `addShape`, presets for color and width, validation
- [x] Red: `tests/unit/tools.test.ts` — gesture → shape conversion: freehand points (marker/highlighter), arrow from segment, rect from drag box, text with content + box
- [x] Green: `src/tools.ts` — tool registry with the five tools; highlighter renders translucent, thicker
- [x] Refactor: one module per responsibility, no `any`, no `else`

**Criterion:** `pnpm --filter @apkawa/image-editor test` green; every exported function in `src/scene.ts`/`src/tools.ts` has a unit test; defaults assert red default color and yellow highlighter.
**Commit:** `feat(image-editor): scene model and drawing tools`

## Stage 3 — Selection, transforms, undo (pure logic, node tests)

- [x] Red: `tests/unit/hit.test.ts` — hit-testing for arrow/rect/text (point in bbox/segment with tolerance) — 14 tests
- [x] Green: `src/hit.ts` — `hitShape` (rect/text bbox, arrow/marker segment distance), `hitHandle`, `topShapeAt`
- [x] Red: `tests/unit/transform.test.ts` — move, stretch, rotate (rotation about center, handles in rotated space, hit uses inverse transform) — 19 tests
- [x] Green: `src/transform.ts` — `localToWorld`/`worldToLocal`, `moveShape`, `resizeShape` (world delta → local axes, clamp w/h ≥ 4), `rotateShape`, `handlePoints`
- [x] Red: `tests/unit/undo.test.ts` — push snapshot on committed edit, Ctrl+Z semantics: pops last, respects history bounds, no-op when empty — 6 tests
- [x] Green: `src/undo.ts` — snapshot stack over frozen scenes
- [x] Refactor + `pnpm typecheck` green (69 unit tests, build exit 0)

**Criterion:** unit tests green; arrow/rect/text are selectable after draw and re-transformable; undo restores previous scene and stops at history start.
**Commit:** `feat(image-editor): selection, transforms, and undo`

## Stage 4 — Canvas renderer, input layer, mount API, PNG export + dev page

- [x] Red: `tests/e2e/editor.spec.ts` (bare playwright, chromium; the spec owns a node `http.createServer` static server — ESM cannot load over file://) — draw rect, undo (Ctrl+Z), wheel zoom, handle resize, Save → PNG blob with non-zero size
- [x] `src/view.ts` + `tests/unit/view.test.ts` — pure zoom/pan model (cursor-anchored zoom, clamp 0.1–8, `fitView`)
- [x] `src/render.ts` + `tests/unit/render.test.ts` — scene → canvas 2D (base image + shapes), DPR-aware, selection handles via `handlePoints`, text measured-width writeback
- [x] `src/input.ts` — pointer gestures (handle grab → select/move → tool gesture), wheel zoom, pan, Ctrl+Z / Delete / Escape
- [x] `src/editor.ts` — `mountImageEditor(container, { image, onSave, onCancel })` → controller (`setTool`, `setColor`, `setWidth`, `undo`, `exportPng`, `dispose`, `debugState`); toolbar DOM with testids; `<style>` CSS with `ie-` prefix
- [x] `src/export.ts` — `renderPng(image, scene)` at natural size, independent of live zoom/pan, returns an `image/png` Blob
- [x] `src/scene.ts` — added `replaceShape` (in-place swap, order preserved) for text measurement writeback
- [x] `dev/index.html` + `dev/dev.ts` (bundle entry `dist/dev.js`) — standalone page: file input, paste, `?src=data:…`, debug hooks `window.__editorState()` / `window.__lastExport`
- [x] Green: `pnpm test` 93 passed, `pnpm test:e2e` 1 passed, `pnpm build` emits `dist/editor.js` + `dist/dev.js`, `pnpm typecheck` exit 0

**Criterion:** the dev page runs in a browser over http (the spec serves `dev/` + `dist/` itself) and playwright drives it: draw → transform → undo → zoom → export produces a valid PNG; the package still has no dsh/React imports.
**Commit:** `feat(image-editor): canvas renderer, input layer, mount API, dev page`

## Stage 4.5 — Independent acceptance fixes (image-editor)

Acceptance run (`tests/e2e/tools.spec.ts` + `tests/unit/acceptance.test.ts`) proved marker/highlighter/arrow/rect/text, Ctrl+Z, wheel zoom, presets, and post-draw transforms work, and found two real defects, recorded as `test.fail()` markers:

- [x] Gap A — `src/render.ts` stroke stretch mapped y from pair slot 0 (`coords.map(([y]) => y)`), squashing strokes whose bbox is wider than tall. Fixed: x from slot 0, y from slot 1; arrowhead endpoints follow the same mapping.
- [x] Gap B — a horizontal arrow (`h = 0`) had its N/S handles on the shaft, so a shaft-midpoint grab resized instead of moving. Fixed: an edge handle (`n`/`s`/`e`/`w`) is grabbed only when the pointer misses the stroke; corner + rotate handles keep priority. Trade-off noted: on filled rect/text, edge handles now fall through to move — corners still resize.
- [x] Both `test.fail()` markers and the `it.fails()` marker converted to passing tests; `pnpm test` 100 passed, `pnpm test:e2e` 9 passed, `pnpm typecheck` exit 0, `pnpm build` exit 0

**Criterion:** diagonal strokes render along the pointer path (pixel extents match the drag span); a horizontal arrow is movable by clicking its shaft midpoint while corner handles still resize; no `test.fail()` markers remain in `packages/image-editor/tests`.
**Commit:** `fix(image-editor): stroke scaling and handle-vs-move gesture priority`

## Stage 5 — `packages/dsh-attach-editor` scaffold + sidebar tab

- [x] `packages/dsh-attach-editor/package.json` (`@apkawa/dsh-attach-editor`, `exports: { ".": "./lib/index.js", "./client": "./lib/client/index.js" }`, `dsh.client.inject` list of 5 modules, dep `@apkawa/image-editor: workspace:*` + `@deepseek-ai/dsh-home-paths`), `cordis.patch.yml` (`insert id: attach-editor`), `tsdown.config.ts` (module-loader envelope + css-inline), tsconfigs (host + client mirrors), `vitest.config.ts`, `vitest.e2e.config.ts`, `playwright.config.ts`
- [x] Red: `tests/e2e/server/boot.test.ts` (`describe.each(E2E_DSH_VERSIONS)`) — RED at `ensureBuilt` (artifacts missing), green after build
- [x] Green: `src/index.ts` (host: Cordis row with `Config.scratchDir`, disposer so the row activates) + `src/client/index.ts` — `inject = ['connection','slots','sidebarRight','sidebarRightTabs','uiWorkspace']`, tab kind `attach-editor` ("Annotate image", guide order 45), pane body `data-testid="attach-editor-pane"`
- [x] Red → Green: `src/client/editSession.ts` pure module (`beginEdit`/`endEdit`/`activeEdit`/`planOpenAttempt`) + `tests/unit/editSession.test.ts` (6 tests)
- [x] Playwright acceptance: `[data-sidebar-right-guide-entry="attach-editor"]` → click → `getByRole('tab', { name: 'Annotate image' })` → `attach-editor-pane` visible (dialog-dismiss polling added; green on first attempt)
- [x] Shared-helper addition `handle.readOutput()` in `tests-helpers/e2e/dsh.ts` (stdout+stderr into a shared buffer — the startup activation audit lands on stderr before READY); global-queue e2e lane re-checked: 10 passed

**Criterion:** `pnpm --filter @apkawa/dsh-attach-editor build && pnpm test:e2e` green on `0.2.0-rc.2`: the plugin activates, its sidebar tab is registered and openable.
**Commit:** `feat(dsh-attach-editor): plugin scaffold and sidebar tab`

## Stage 6 — Attachment rail replacement + preview overlay with Edit button

- [x] Red: playwright acceptance — image attachment appears as OUR rail item; clicking the thumbnail opens our preview overlay with `attach-editor-edit-button` above the image; remove still works
- [x] `src/client/attachmentRail.ts` — pure module (`splitAttachments`, `isEditable`, preview state machine, `uploadView`, `dropOverlayVisible`) + `tests/unit/attachmentRail.test.ts` (15 tests)
- [x] `src/client/AttachmentsRail.tsx` — seat occupant: thumbnails, per-item remove, file rows with upload progress/retry, drop overlay with `dropLimits` (drag-depth tracked locally; importing `ui-attachment` is forbidden)
- [x] `src/client/PreviewOverlay.tsx` + CSS module — portal dialog `attach-editor-preview`, mask + Escape close, focus trap, header above the image with `attach-editor-edit-button` / `attach-editor-close-button`
- [x] Green: rail registered via `slots.inject('conversation.input.attachments', () => slots.register({ name, priority: -1 }, …))` — shadowing rule confirmed (`ui-slots/src/index.ts:1134-1140`: lowest live priority renders, priority 0 collides), so priority −1 replaces the shipped rail; Edit → `beginEdit` → `openTab('attach-editor')` with retry-on-throw
- [x] Unit tests green (21); intake in the test = `setInputFiles` on the composer's hidden `input[type="file"]` (no provider change needed — image gating is host-side at submit, intake gated only by `imageLimits`)
- [x] Refactor: CSS Modules with `--dsw-*` tokens, English copy, `react-dom` ambient shim for `createPortal` (no `@types/react-dom` in the frozen store)

**Criterion:** acceptance spec proves: pasted image → our thumbnail → click → overlay with Edit button → Edit opens the sidebar tab (attachment id recorded); removal and drop-to-composer still work.
**Commit:** `feat(dsh-attach-editor): attachment rail with preview and edit button`

## Stage 7 — Editor tab body + save replaces the attachment

- [x] Red → green playwright acceptance: in the tab, draw a marker on the canvas (pixel-sampled stroke ink), `editor-save` → composer rail holds exactly ONE image thumbnail (`naturalWidth` 320, changed previewUrl), pane returns to idle; exported bytes differ from the fixture
- [x] `src/client/attachmentRegistry.ts` — pure registry (`rememberAttachment`/`forgetAttachment`/`lookup`, image kind only): the seam for the pane to resolve `activeEdit().attachmentId` → the image Blob, because cross-plugin runtime imports are forbidden and `ConversationController.draftAttachments` is not readable
- [x] `AttachEditorPane.tsx` — mounts `mountImageEditor` into `attach-editor-body`; idle (`attach-editor-idle`), registry miss (`attach-editor-missing`), refusal banner (`attach-editor-blocked`); dispose on unmount/edit change; `endEdit()` on `useTabInfo().tab.signal` abort and on Cancel
- [x] Replace flow in `src/client/conversationReplace.ts`: `createDrafts` → `addAttachments([newId])` → `removeAttachment(oldId)` → `releaseDraftAttachment(oldId)`, phase check (`facade.ts:221` returns false, does not throw) BEFORE any draft is created; conversation surface resolved per save via `ctx.get('conversation')`/`ctx.get('sessions')` structural mirrors
- [x] Unit tests: `attachmentRegistry.test.ts` + `conversationReplace.test.ts` (ordering, refusal while submitting, unbound session)
- [x] Green: unit 34 passed, vitest boot lane 3 passed, playwright acceptance 3 passed, `pnpm typecheck` green for both packages

**Criterion:** end-to-end on a live `dsh web` instance: image attached → edited in sidebar tab → saved → the message sent to the agent carries the edited PNG (annotated pixels present), and the old blob preview is revoked/disposed.
**Commit:** `feat(dsh-attach-editor): editor tab and attachment replacement on save`

## Stage 8 — Docs + manual verification

- [x] `packages/image-editor/README.md` + `packages/dsh-attach-editor/README.md` (API + tool table + dev-page static-server trick; plugin install `dsh plugin --profile web add packages/dsh-attach-editor`; MVP limits: append-at-end ordering, phase-refusal banner unit-covered only, `scratchDir` unused, text-edit UI deferred)
- [x] `AGENTS.md` for both packages rewritten to the final structure; root `AGENTS.md` Projects entry lists both packages; `docs/ai/key-moments.md` entry `## 12.` records the four dsh seams (slot shadowing, replacement composition, phase guard, registry seam)
- [x] Manual poke: dev page served over http in chromium — marker/highlighter/arrow/rect/text drawn (5 shapes), wheel zoom 2.125→3.06, Ctrl+Z → 4 shapes, export 4709-byte PNG; live instance (`scripts/e2e-live.ts --port 3082`) — guide entry present, thumbnail → preview with Edit above the image → tab mounted → marker drawn → Save leaves ONE thumbnail (naturalWidth 320, changed src, 2674-byte annotated PNG). Screenshots in `.tmp/image-editor-verify/`
- [x] Full sweep green: image-editor 100 unit + 9 e2e + typecheck + build; dsh-attach-editor 34 unit + boot 3 + acceptance 3 + typecheck + build/bundle; dsh-global-queue regression 10 passed; `rg` coupling check exits 1 (zero hits)
- [x] Report state to user and ask for archiving confirmation (never archive autonomously)

**Criterion:** both READMEs install/run as documented; root `AGENTS.md` lists the new packages; user has been asked to confirm completion.
**Commit:** `docs: editor and attach-editor packages READMEs and agent notes`
