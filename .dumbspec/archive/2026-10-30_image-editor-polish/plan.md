# 2026-10-30_image-editor-polish: implementation plan (image-editor polish)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Capture draft from backlog (9 items) into draft.md
- [x] Refinement gate confirmed by user
- [x] Research image-editor structure → research.md
- [x] Spec v1 (decisions: Step numbering derived at render, balloon anchor, leader segment+shelf, defaults 8px, rotate SVG cursor)
- [x] Plan written

**Criterion:** draft.md, research.md, spec.md (v1, Created + Changes), plan.md exist in `current/2026-10-30_image-editor-polish/`.
**Commit:** `docs(dumbspec): add image-editor-polish task (draft, research, spec v1, plan)`

## Stage 1 — Defaults & label polish (items 8, 9)
- [x] Red: unit test asserting `DEFAULT_WIDTH = 8` and drawing-tool widths 8 (highlighter stays 14); test/e2e asserting visible labels have no "px" (width popover, font-size popover, `editor-text-size`, `editor-shape-size`) while tooltips keep px
- [x] Green: change `DEFAULT_WIDTH`/`TOOL_DEFAULT_WIDTHS` in scene.ts (update `index.test.ts`/`scene.test.ts` assertions); strip px from visible labels in editor.ts
- [x] Refactor: run `pnpm test`, `pnpm test:e2e`, `pnpm typecheck` — all green

**Criterion:** defaults show 8px in width picker; labels render bare numbers, tooltips still say "…px"; full unit+e2e suites green.
**Commit:** `feat(image-editor): default line thickness 8px, px-free visible labels`

## Stage 2 — Ctrl+Z undo verification (item 7)
- [x] Red/verify: e2e or unit test drawing a shape, pressing Ctrl+Z, asserting shape count drops (if gap found, implement)
- [x] Run suite; close item or fix — DONE-already: Ctrl/Cmd+Z in src/input.ts, covered by editor.spec.ts:244/380, tools.spec.ts:319 (pixel proof); no code change, commit N/A

**Criterion:** a test proves Ctrl+Z restores the previous scene; backlog item 7 closed (verify-only expected).
**Commit:** N/A (expected no code change; commit only if a fix was needed)

## Stage 3 — Color/width applies to selection (item 4)
- [x] Red: e2e — select one shape, pick color → selected shape's color changes; select several → all change; width likewise; undoable in one commit
- [x] Green: in editor.ts, when selection non-empty, `setColor`/`setWidth` commit `replaceShape` for selected shapes (still update tool defaults)
- [x] Refactor + full suites green — acceptance PASS: one commit per pick, empty-selection path intact; 157 unit + 54 e2e green

**Criterion:** picking a color/width while shapes are selected mutates those shapes (single undo step restores them).
**Commit:** `feat(image-editor): apply color and width to selected shapes`

## Stage 4 — Step tool (item 1)
- [x] Red: unit — Step kind in scene/tools/defaults/hit/render (red circle, white border, shadow, white digit); numbering derived from scene order; unit — removing a Step renumbers the rest at render
- [x] Green: `EditorTool` union + `StepShape` + registry gesture (drag = circle bbox) + `EDITOR_TOOLS` + default color/width records + toolbar icon `editor-tool-step` + `drawShape` branch + `shapeHitInLocal` branch; digit = index among Step shapes, size ∝ min(bbox side)
- [x] E2e: draw 3 steps, assert digits 1/2/3 via `__editorState`/pixels; delete middle → remaining show 1/2
- [x] Refactor + suites green — acceptance PASS: digit derived at render from scene order (not stored); 169 unit + 57 e2e + typecheck green

**Criterion:** step tool draws numbered red circles; deletion renumbers; exports keep numbering.
**Commit:** `feat(image-editor): step numbering tool`

## Stage 5 — Speech balloon tool (item 2)
- [x] Red: unit — balloon kind: ellipse by bbox + tail anchor at click point (bbox-local); text content + fontSize; hit test covers ellipse+tail; render draws balloon; dragging moves anchor
- [x] Green: model variant (anchor + text + fontSize), TextTool-style gesture placing anchor at click, defaults/icon `editor-tool-speech`, drawShape branch, hit branch
- [x] E2e: click tool → type text → balloon drawn with tip at click; drag moves balloon+tip together; undo works
- [x] Refactor + suites green

**Criterion:** balloon renders like comic speech bubble, tip pinned to the click point, behaves as text for editing/font size.
**Commit:** `feat(image-editor): speech balloon tool`

## Stage 6 — Leader tool (item 3)
- [x] Red: unit — leader kind: `from`/`to` segment payload + text; render = thick dot at from, line, horizontal shelf at to, text above shelf; hit = segment+dot+text area
- [x] Green: model variant + arrow-style gesture (first click dot, drag/drag to shelf end), defaults/icon `editor-tool-leader`, drawShape + hit branches
- [x] E2e: draw leader → dot+line+shelf+text above shelf; text editable like text tool (double-click); undo
- [x] Refactor + suites green

**Criterion:** leader renders dot→line→shelf with text above shelf; editable text; undoable.
**Commit:** `feat(image-editor): leader (callout) tool`

## Stage 7 — Endpoint handles for arrow & leader (item 5)
- [x] Red: e2e/unit — selecting an arrow (or leader) shows two endpoint dots + center drag square, no bbox/rotate; dragging an endpoint changes only that end; center square moves the whole shape
- [x] Green: new handle kinds (endpoint-start, endpoint-end, center-drag) + hitHandle/handleSlots + render overlay branch for arrow/leader kinds + input.ts drag routing (endpoint edit vs move)
- [x] Refactor + suites green — acceptance PASS: endpoint drag edits ends, center drag moves shape (240 unit + 74 e2e green); dynamic-import scaffolding tidied to static import

**Criterion:** arrow/leader selection overlay = 2 endpoint dots + mid square; endpoint drag edits ends; center drag moves shape.
**Commit:** `feat(image-editor): endpoint handles for arrow and leader`

## Stage 8 — Bbox handle restyle + cursors (item 6)
- [x] Red: unit/e2e — bbox overlay: circles at resize slots with white outline, center drag square, white-outlined rotate; hover over handle sets canvas cursor (move / rotate SVG cursor / pointer / col-resize / row-resize); center square drags the shape
- [x] Green: drawHandles restyle (circles, outlines, center square), handleSlots gains center slot, hover cursor mapping in input/editor (SVG data-URL cursor for rotate)
- [x] Refactor + suites green — acceptance PASS: hover cursors idle-only + cleared on release; 243 unit + 81 e2e green

**Criterion:** selected shape shows restyled handles (circles + center square, white outlines) and correct per-handle cursors; center square moves the shape.
**Commit:** `feat(image-editor): restyled bbox handles with drag square and cursor hints`

## Stage 9 — Backlog close-out
- [x] Update `.dumbspec/backlog.md`: mark items 1–9 as done (move section entries to [x])
- [x] Final full verification: `pnpm test`, `pnpm test:e2e`, `pnpm typecheck` in packages/image-editor — 243 unit + 81 e2e + typecheck green; dsh-attach-editor lanes green too (34 vitest + 3 playwright acceptance, embed stable)

**Criterion:** all 9 backlog items closed, suites green; report to user and ask confirmation before archiving.
**Commit:** `docs(dumbspec): close image-editor backlog items`

---

## Stage 10 — Step: minimum size, click placement, 4px border (amendment 2026-10-31)
- [x] Research check (in red agent): current `drawStep` digit font ratio vs circle diameter → set minimum diameter so the digit renders ≥ 18px (spec says ≈ diameter/2 → min 36px)
- [x] Red: unit — dragless click with step tool commits a minimum-diameter circle centered at the click; drag smaller than minimum clamps to minimum; drag larger keeps dragged size; `TOOL_DEFAULT_WIDTHS.step = 4` (border = shape.width → 4px); e2e — click places a numbered circle without dragging
- [x] Green: step gesture accepts dragless press (origin-only) producing minimum-size shape; clamp dragged bbox to minimum span at commit; step default width 4 in scene.ts
- [x] Refactor + suites green — acceptance PASS: `stepBadge` clamp in tools.ts (w/h ≥ MIN_STEP_SIZE=36, centered on drag midpoint), digit 18px at minimum; tiny-drag gap probe-verified; 244 unit + 82 e2e + typecheck green; dsh-attach-editor lanes green

**Criterion:** clicking (no drag) places a minimum-size numbered circle (digit readable at 18px); tiny drags produce the minimum circle; default step border thickness is 4px; full suites green.
**Commit:** `feat(image-editor): step minimum size, click placement, 4px border` (`d46bcbc`)

## Stage 11 — Default thickness 4px for arrow, rect, leader (amendment 2026-10-31)
- [x] Red: unit — `TOOL_DEFAULT_WIDTHS.arrow/rect/leader = 4`, marker stays 8, highlighter stays 14; retune existing assertions that assume 8px strokes for these three tools (scene/index tests, tools.spec stroke/dot sampling — leader dot radius = width×1.5 = 6); e2e pixel sampling retuned for 4px strokes (user note: keep it lean — mostly revert the Stage 1 retune back to the original 4px expectations)
- [x] Green: change the three entries in `TOOL_DEFAULT_WIDTHS`
- [x] Refactor + suites green (image-editor unit + e2e + typecheck; dsh-attach-editor lanes stay green)

**Criterion:** freshly drawn arrow/rect/leader use 4px thickness (width picker highlights 4 for them); marker 8px and highlighter 14px unchanged; all suites green.
**Commit:** 66321d2

## Stage 13 — Leader shelf rework + text at shelf tip (amendment wave 2, item 10)
- [x] Research: current `leaderShelfHalf` formula, `drawLeader` text drawing (single vs multi-line), hit label band; pick fixed shelf length ≈ 2× current default span → `LEADER_SHELF_LENGTH = 86` world px (research.md wave 2)
- [x] Red: unit render — shelf anchored at `to` extending away from shaft (drag-direction sign), fixed length; text anchored at far shelf tip above shelf; multi-line block vertically centered on shelf line; hit band matches new shelf+text placement; e2e — leader with text shows shelf from tip of shaft with text at shelf end
- [x] Green: render.ts shelf/text rework (leaderShelfSpan, LEADER_SHELF_LENGTH=86); hit.ts band update; barrel exports
- [x] Refactor + suites green (257 unit, 86 e2e, typecheck; embed lib rebuilt)

**Criterion:** leader shelf starts at the shaft tip and has fixed length (2× old); its text sits at the shelf's far end above the shelf; multi-line text is vertically centered on the shelf line; hit/selection follow; suites green.
**Commit:** 4e1d714

## Stage 14 — White outline 2px + shadow for arrow/rect/leader (amendment wave 2, item 11)
- [x] Red: unit render — arrow/rect/leader strokes emit a white halo pass (lineWidth = shape.width + 4) with the step shadow recipe before the color pass; fake ctx records shadow + stroke order; e2e — white pixels just outside a 4px arrow/rect stroke; text/speech unchanged
- [x] Green: render.ts halo pass for the three kinds (outline 2px each side), shadow per drawStep recipe; text/speech untouched
- [x] Refactor + suites green (248 unit, 85 e2e, typecheck)

**Criterion:** arrow/rect/leader render with a 2px white outline band and drop shadow like Step; text/speech rendering unchanged; suites green.
**Commit:** d2024a9

## Stage 15 — Arrow tip points at drag origin (amendment wave 2, item 12)
- [x] Red: unit render — arrowhead drawn at `from` pointing from the dragged corner toward `from`; e2e — arrow tip pixel at the pointerdown point, head samples retuned; selection endpoint handles unchanged
- [x] Green: render.ts drawArrow head at `from` (both halo + fill paths, args swapped); hit.ts arrow segment extended to tip past `from`
- [x] Refactor + suites green (260 unit, 87 e2e, typecheck; embed lib rebuilt)

**Criterion:** dragging an arrow puts its head exactly at the pointerdown point, shaft toward the dragged corner; endpoint-handle editing still works; suites green.
**Commit:** bbf4ade

## Stage 12 — Amendment close-out (run after stages 11, 13–15)
- [x] Final verification: `pnpm test` (260), `pnpm test:e2e` (87), `pnpm typecheck` clean in packages/image-editor; `pnpm test` (34) + `pnpm test:e2e` (vitest 3 + playwright acceptance 3) green in packages/dsh-attach-editor
- [x] Report to user, ask confirmation before archiving

**Criterion:** amendment stages done, suites green; report delivered; archive only on explicit confirmation.
**Commit:** N/A (docs tick commit for stages 10–11)

## Stage 16 — Leader shelf halved (amendment wave 3, item 13)
- [x] Red: unit scene — `leaderShelfSpan` pins for length 43 (right {50,93}, left {-3,40}, dx=0 {40,83}); render.test shelf xs/textX retuned; e2e leader shelf-tip and label-anchor pixel samples moved to the 43px shelf
- [x] Green: `LEADER_SHELF_LENGTH = 43` (single constant); stale bare-strip sample retuned to the shelf's left edge (genuine alignment differential)
- [x] Refactor + suites green (260 unit, 87 e2e, typecheck); embed lib rebuilt

**Criterion:** shelf length is 43 world px in both directions, label anchored at the far tip; suites green.
**Commit:** dd49183

## Stage 17 — Leader label centered on shelf line (amendment wave 3, item 14)
- [x] Red: unit render — single-line label centered pin; unit hit — below-shelf-line band point hits; e2e — label ink above AND below the shelf line (7 e2e + 3 unit red)
- [x] Green: render.ts drawLeader unified `topY = span.y - band/2`; hit.ts centered band all line counts; stale degenerate-leader + spill-strip assertions retuned to the approved semantics
- [x] Refactor + suites green (260 unit, 87 e2e, typecheck); embed lib rebuilt

**Criterion:** any leader label (1+ lines) is vertically centered on the shelf line; hit band follows the label; suites green.
**Commit:** 1b2fa99

## Stage 18 — Step digit auto-contrast (amendment wave 3, item 15)
- [x] Red: unit render — badge `#ffffff`/`#f5d90a` digit `#1A1A1A`, `#000000`/`#e5484d`/`#808080` digit `#FFFFFF`; e2e — white badge dark-ink count >40 (red badge white glyph >60 + dark-ink 0 guard)
- [x] Green: luminance-based digit color in drawStep (`isLightHex`, sRGB-linearized L > 0.55 → `#1a1a1a`)
- [x] Refactor + suites green (265 unit, 88 e2e, typecheck); embed lib rebuilt

**Criterion:** digit readable on light badge colors (dark ink), white on dark colors; suites green.
**Commit:** dea8414

## Stage 19 — Wave 3 close-out (run after stages 16–18)
- [x] Final verification: image-editor `pnpm test` (265) + `pnpm test:e2e` (88) + `pnpm typecheck` clean; dsh-attach-editor `pnpm test` (34) + `pnpm test:e2e` (vitest 3 + playwright 3); embed lib rebuilt after stage 18
- [x] Report to user, archive held pending explicit confirmation

**Criterion:** wave 3 stages done, all five lanes green; report delivered; archive only on explicit confirmation.
**Commit:** 275ec48 (ticks); close-out below

## Stage 20 — Leader label shifted past shelf tip (amendment wave 4, item 16)
- [x] Red (unit only, per image-editor AGENTS.md e2e exception): render — right-drag textX = span.x1 + LEADER_LABEL_GAP textAlign 'left', left-drag mirrored; hit — band x covers shelf + gap + text width (mirrored); index — gap constant pinned (7 red)
- [x] Green: `LEADER_LABEL_GAP = 12` in scene.ts + barrel export; render.ts drawLeader anchor; hit.ts band x extension — unit 266 green, typecheck clean
- [x] e2e: 7 red leader pixel tests stubbed with test.skip per user decision (retune deferred; visuals verified by hand) — lane green: 81 passed + 7 skipped
- [x] Suites green; embed lib rebuilt (embed 34 unit + 3 vitest e2e + 3 playwright e2e)

**Criterion:** leader label sits past the shelf far tip with a 12px gap (mirrored for left drag), vertically centered on the shelf line; it never overlaps shelf ink; hit band follows the shifted label; suites green.
**Commit:** c3a3369

## Stage 21 — Wave 4 close-out (run after stage 20)
- [x] Final verification: image-editor unit 266 + e2e 81 passed/7 stubbed + typecheck clean; dsh-attach-editor unit 34 + e2e 3+3; embed lib rebuilt
- [x] Report delivered; user confirmed archiving the task

**Criterion:** wave 4 stage done, all five lanes green; report delivered; task archived on explicit confirmation.
**Commit:** c3a3369 (feat); ticks below
