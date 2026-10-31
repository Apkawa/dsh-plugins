# Research — image-editor polish (English)

Repo: `/home/apkawa/code/dsh-model-settings`. Target: `packages/image-editor` (private `@apkawa/image-editor`, zero runtime deps, exports `./lib/index.js`). Consumer: `packages/dsh-attach-editor` (imports `mountImageEditor` only; inlines the package in its client bundle; playwright lane asserts editor testids).

## Package layout

- `src/index.ts` — public API (types + values re-exported).
- `src/scene.ts` — pure data model: `EditorTool` union (:3), `Transform` (:13), `ShapeBase` (:20-27), shape variants (:29-34), `Scene` (:46-50), immutable ops `addShape/removeShape/replaceShape/setDefaults`, defaults/presets (`DEFAULT_COLOR`, `DEFAULT_WIDTH=4`, `DEFAULT_FONT_SIZE=18`, `COLOR_PRESETS`, `WIDTH_PRESETS=[2,4,8,14]`, `FONT_SIZE_PRESETS`, `TOOL_DEFAULT_COLORS/WIDTHS` as exhaustive `Record<EditorTool,...>` :79-100, `defaultsFor` per-kind override :129-134).
- `src/tools.ts` — gesture registry `begin→extend→finish` → `ShapeDraft`; `EDITOR_TOOLS` array (:22); payloads stored bbox-local (`toLocal`).
- `src/transform.ts` — bbox↔world math, `moveShape/resizeShape/rotateShape`, handle ids `'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'rotate'` (:5), `handleSlots` (:87-99), `stretchedFontSize` for text resize (:156-163).
- `src/hit.ts` — `hitShape/topShapeAt/shapesWithin/hitHandle`.
- `src/render.ts` — Canvas 2D: `drawScene` (:30-56), `drawShape` dispatch (:74-89), `drawText` (:105-115), `drawStroke`/`drawArrowHead` (:122-151), selection overlay: dashed bbox for every selection (:173-182), handles only for lone selection (:50-51), `drawHandles` (:185-198) — 8 resize squares `HANDLE_SIZE=4` color `#1A1A1A` + rotate circle `ROTATE_SIZE=5`; constants `OVERLAY_COLOR`/`HANDLE_COLOR` (:9-12) not re-exported by index.
- `src/export.ts` — `renderPng` at natural size.
- `src/view.ts` — zoom/pan state.
- `src/undo.ts` — snapshot history `createHistory(limit=100)`; pushes only via editor `commit()`.
- `src/input.ts` — pointer/wheel/keyboard gestures; handle grab (:74-80, `HANDLE_HIT_PX=12/scale`), body drag moves selection (:84-95), resize/rotate/move via `draggedShape` (:252-263), commit on release (:163). Keyboard (:184-199): **Ctrl/Cmd+Z → undo already implemented** (:186-190), Delete/Backspace deletes selection, Escape clears selection.
- `src/editor.ts` — DOM mount + controller (`setTool/setColor/setWidth/undo/exportPng/dispose/debugState`). Toolbar (:408): tool buttons, color trigger `editor-color-picker`, width trigger `editor-width-picker`, reset, undo, save, cancel; popovers with presets. Font-size buttons float over stage: `editor-text-size` (label `` `${fontSize} px` `` :260-263) and `editor-shape-size` (label `` `${Math.round(fontSize)} px` `` :363); width popover visible label `${px}px` (:396) and tooltip `${px}px` (:397-398); font-size popover `${px}px` (:414) + title/aria (:415-416). Trigger tooltip `Thickness ${width}px` (:579). Tool switch applies per-tool remembered color/width (:587-595).
- `dev/dev.ts` — demo page exposing `window.__editorState()`, `window.__lastExport`.

## Tools currently present

`EditorTool = 'select' | 'marker' | 'highlighter' | 'arrow' | 'rect' | 'text'`; toolbar order `EDITOR_TOOLS` = same. No step/balloon/leader yet.

## Facts relevant to backlog items

1. **Step** — precedent: text (`fontSize`, per-line `fillText`); a number inside a circle is drawable in bbox-local space in `drawShape`. Renumbering must be derived from scene shape order at render time (shapes array is immutable-ops-managed; `replaceShape` preserves stacking order). Tool addition touches: `EditorTool` union, `Shape`/`ShapeDraft` variants, `toolRegistry`, `EDITOR_TOOLS`, `TOOL_DEFAULT_COLORS/WIDTHS` (exhaustive Record — compile-time forces entries), `TOOL_ICONS` (editor.ts:90-116, `iconSvg` strokes), `drawShape` branch, `shapeHitInLocal` branch (hit.ts:62-71), `index.test.ts:45` asserts exact `EDITOR_TOOLS` array, `scene.test.ts` asserts color/width key order.
2. **Speech balloon** — closest precedents: `TextTool` (click-place text) for gesture, `RectShape` (stroke + optional `fill`) for body. Tail/tip anchored at click point → needs a stored anchor distinct from bbox (arrow `from`/`to` is the precedent for endpoint payload in bbox-local coords).
3. **Leader** — closest precedent: `ArrowShape` (`from`/`to`) + text content. Dot at first click, line, shelf at end, text above shelf → segment payload + text; per-kind resize behavior to decide (stretch vs keep).
4. **Apply color/width to selection** — controller `setColor/setWidth` currently change defaults per tool (editor.ts); need a path that, when selection is non-empty, commits `replaceShape` with new `color`/`width` for selected shapes (history-safe via `commit()`).
5. **Arrow/leader selection endpoints** — selection overlay currently: dashed bbox + 8 square handles + rotate circle, only for lone selection. Endpoint handles would replace bbox+handles for arrow/leader kinds: two endpoint dots + a mid drag square; needs new handle kinds in `hitHandle`/`handleSlots` and drag routing in `input.ts`.
6. **Bbox handle restyle** — mid drag square, circles instead of corner squares, white outlines; cursors (`move`, rotate SVG cursor, `pointer`, `col-resize`, `row-resize`). Cursor changes live in input/editor DOM layer (canvas CSS cursor); note `cursor: rotate` is not a standard CSS value — custom SVG cursor URL would be needed (`cursor: url(...) 8 8, grab`).
7. **ctrl+z undo** — already implemented in `src/input.ts:186-190` (Ctrl/Cmd+Z → undo; toolbar undo button tooltip says "Undo (Ctrl+Z)"). Likely verify-only item, possibly already done; confirm via e2e/unit.
8. **Default thickness 8** — current `DEFAULT_WIDTH=4`, `TOOL_DEFAULT_WIDTHS`: highlighter 14, all others 4 (not 2 — user perceived thinness; marker default 4px at image scale). Change default(s) to 8; `WIDTH_PRESETS=[2,4,8,14]` already contains 8. Tests assert defaults (`index.test.ts:72-73,79-83`, `scene.test.ts`).
9. **Drop "px" labels** — visible labels to strip: width popover items `${px}px` (editor.ts:396), font-size popover items `${px}px` (:414), stage buttons `editor-text-size` `` `${fontSize} px` `` (:260-271 area) and `editor-shape-size` `` `${Math.round(fontSize)} px` `` (:363). Keep px in tooltips: width item title (:397-398), trigger tooltip (:579), font-size title/aria (:415-416).

## Tests & commands

- Unit: `pnpm test` (vitest, node env, `tests/**/*.test.ts`); suites mirror modules: scene/tools/transform/hit/render/view/undo/index/acceptance.
- E2e: `pnpm test:e2e` (builds then playwright chromium headless, 1 worker, artifacts `.tmp/playwright/image-editor`); specs drive dev page via `__editorState()`/`__lastExport` + testids.
- `pnpm typecheck` from package dir.
- E2e constraints from root AGENTS.md: frozen installs, isolated DSH_HOME, temp in `.tmp/`.

## Constraints

- Dependency-free package; no new deps.
- `index.test.ts` asserts exact exports array (`EDITOR_TOOLS` equality) — any new tool updates that assertion.
- dsh-attach-editor asserts existing testids (`editor-canvas`, `editor-tool-marker`, `editor-color-picker`, `editor-width-picker`, `editor-undo`, `editor-save`, `editor-color-#E5484D`); new testids follow `editor-tool-<name>` convention; existing ids must stay stable.

## Amendment research 2026-10-31 (step minimum size / click placement / defaults)

- `drawStep` (render.ts:119-138): digit font = `min(w,h) * 0.5` (:134) → min diameter 36 ⇒ digit 18px = `DEFAULT_FONT_SIZE`; ring lineWidth inherited from `drawShape` = `shape.width` (:91), so step default width change halving border is `TOOL_DEFAULT_WIDTHS.step = 4` (scene.ts:116). Render band test pins ratio [0.35,0.6]×min side (render.test.ts:351-357).
- StepTool = `box('step', ...)` drag gesture (tools.ts:38, :87-101); dragless press commits a 0×0 badge today (nothing rejects it): asserted at tools.test.ts:191-193 and e2e tools.spec.ts:1136-1169 (:1166 pins w===0). Rect dragless pinned too (:1421-1433) — rect must stay degenerate.
- Commit path: pointerdown preview (`addShape` degenerate draft), pointermove `extend`, pointerup `api.commit(api.scene())` (input.ts:142-147, :164-169, :182-183). editor.ts `commit()` (:404-408) is the universal funnel — clamping there is wrong; clamping `addShape` would clamp text/speech/leader drafts.
- Chosen clamp site: step branch inside `box()` `finish()` (tools.ts) — sizes both the pointerdown preview and the committed shape consistently; requires updating the two dragless assertions above. Rule: center = midpoint(origin, corner); w/h = max(dragged span, MIN_STEP_SIZE=36); dragless ⇒ 36×36 centered at click.
- `MIN_SHAPE_SIZE = 4` used only in resize/stretch (transform.ts:212-213, :227-228); NOT in gesture commits — a 4px clamp would be unreadable, hence step-specific MIN_STEP_SIZE=36 derived from DEFAULT_FONT_SIZE (scene.ts:71).
- Width default assertions to retune for arrow/rect/leader→4: scene.test.ts:184-196 (full map), :198-207, index.test.ts:62-67 ("exactly eight 8-valued entries"), tools.spec.ts pixel sampling for arrow/rect/leader strokes (leader dot radius = width×1.5 → 6), e2e stroke/ring samples.

## Wave 2 research (leader shelf / arrow tip / halo+shadow)

- `drawLeader` (render.ts:180-202): shelf = horizontal segment at `to.y` centered on `to.x ± leaderShelfHalf(width,text,fontSize)`; shaft meets shelf at its midpoint; label centered on `to.x`, stacked above shelf (`baseline top`, block top `to.y − textExtent.h`), split('\n'), shape-color ink, no white.
- `leaderShelfHalf` (scene.ts:140-142) = `max(width, textExtent(text,fontSize).w)/2`; default span ≈ 43.2px (text "note", 18px font, GLYPH_WIDTH .6) → fixed shelf length 2× ≈ **LEADER_SHELF_LENGTH = 86** world px, text-independent.
- Arrow head: `drawArrowHead(ctx, coords[0]=from, coords.at(-1)=to, width)` (render.ts:254, head math :257-276 — tip = second arg + u·width). Flip = swap args (head tip past `from`, pointing away from `to`). render.ts:254 is the ONLY head consumer; `editEndpoint`/endpoint handles/debugState treat from/to as endpoints only → flip is render-only. Arrow hit (hit.ts:64-66) uses plain segment, misses the head tip → extend segment toward `from − u·width`.
- `drawStep` shadow recipe (:123-132): save → `shadowColor 'rgba(26,26,26,0.35)'`, `shadowBlur max(4, radius/2)` → color fill + white ring on same path → restore. Halo pattern for arrow/rect/leader: inner save/restore, white pass first (`lineWidth = shape.width + 4`, shadow active) then color pass (`shape.width`); rect halo = wide white `strokeRect` before color `strokeRect` (fake ctx currently does NOT capture lineWidth in strokeRect); arrow head halo = stroke triangle white-wide before color fill; leader label text stays plain ink (white==0 label assertion must become shelf-line halo differential or narrow to glyph rows).
- Fake ctx (render.test.ts:8-80): records ops/strokes/strokeWidths(stroke only)/fills/fillText args; props not restored on fake restore() → per-op shadow capture needed (push shadowBlur/shadowColor in stroke()/fill()/strokeRect(); add textAlign field).
- Multi-line: LINE_HEIGHT 1.5, textarea inserts '\n' via Ctrl+Enter — multi-line leader text reachable. Speech vertical centering formula (render.ts:166-169) is the template for shelf-centered multi-line: `fillText(line, x, shelf.y + (i − (n−1)/2)·fontSize·LINE_HEIGHT)`, baseline middle. Chosen rule: single-line block stays above shelf (bottom at shelf.y); multi-line block vertically centered on shelf line. Field anchors in input.ts (:187,:245) stay at `to` (KISS, e2e field-anchor tests untouched).
- Hit band update: x-range = shelf span `[min(to.x,tip.x)−tol, max(to.x,tip.x)+tol]` where tip = to.x + sign(dx)·LEADER_SHELF_LENGTH (dx==0 → right); y: single-line `[to.y − band − tol, to.y + tol]`, multi-line `[to.y − band/2 − tol, to.y + band/2 + tol]`.
- e2e retune map: arrow :426-433 (tip→from end, zero-ink window past from), :1887-1888 (background window past `to` end must clear shaft cap + halo = width/2+2); leader shelf bands :1569-1594 (span [to.x, to.x+86·scale], past-end zero-ink at old centered ends), label bands :1592-1594/:1685-1688/:1734-1747/:1783-1786 (tip-anchored, vertical rule), delete regions :1633-1637; Stage 11 widths: dot radius 6, shaft 4 → offsets at :1576-1577, :1588, :1688. selection-properties strokeRows/colorPixels pass under +6 margin — verify, don't pre-adjust.

## Wave 3 research notes (2026-10-31, screenshot-derived amendments)

- Shelf halve: `LEADER_SHELF_LENGTH = 86` (scene.ts:141) feeds `leaderShelfSpan` (:149-150) — change to 43 only. Test pins to retune: scene.test span pins {50,136,30}/{-46,40,30}/{40,126,30} → {50,93}/{-3,40}/{40,83}; render.test leader shelf xs [60,146]→[60,103], textX 146→103; tools.spec leader fixture tip 286→243 (still inside 320px fixture), shelf-edge/textX pixel samples move with the constant.
- Single-line label centering: render.ts drawLeader :239 `topY = lines.length === 1 ? span.y - band : span.y - band / 2` → unified `span.y - band / 2` (single line straddles the shelf line like the multi-line block). hit.ts :105-106 single-line band `[span.y - band, span.y]` → same centered band `[span.y - band/2, span.y + band/2]`. Unit pins: render.test single-line textY -27 → -band/2 (-9 for band 18); multi-line ys [-27,0] unchanged; hit.test leader y-band pins follow.
- Step digit contrast: drawStep fills badge with `shape.color` (:146), digit paints `#FFFFFF` (:149). Add relative luminance of the fill (sRGB channel /255, linearize, 0.2126R+0.7152G+0.0722B); digit color = luminance > 0.55 ? '#1a1a1a' (editor ink) : '#FFFFFF'. Check: '#ffffff' → dark digit, '#e5484d' ≈ 0.27 → white digit stays, '#f5d90a' yellow ≈ 0.75 → dark digit. No state/schema change; render-only decision.
- All three items are constants/render/hit only; embed lib (`packages/dsh-attach-editor/lib`) rebuilt after each feat commit.

## Wave 4 research notes (2026-10-31, mock screenshot: label shifted past shelf tip)

- Chromium probe of the mock (.tmp/mock-geometry-probe.mjs, json .tmp/mock-geometry.json): green leaders — gap = label ink left edge − shelf stroke right edge = 11px (single-line '123') and 14px (multi-line); halo ink protrudes past the stroke tip only ~1–2px at width 4, so any gap ≥ 4 clears halo ink. Hand-drawn mock → constant candidate **LEADER_LABEL_GAP = 12** world px.
- Mock vertical placement confirms current centering: green label ink vertical center = shelf y − 1px (both leaders), multi-line pitch 27px = 1.5×18 → current `topY = span.y − band/2` (LINE_HEIGHT 1.5) matches; NO vertical change needed.
- Red (wrong) leader reproduces current code exactly: label right-aligned AT far tip (ink right edge = stroke right edge − 1), overlapping shelf ink by 26px. The flaw is horizontal only.
- Code anchors: render.ts drawLeader (:232-235) `textAlign = x1 > to.x ? 'right' : 'left'` at farTip = span.x1; hit.ts band x = `[span.x0 − tol, span.x1 + tol]` (:106) — mock green label ink (tip+11 … tip+43) falls ENTIRELY outside the band today → band must extend past the tip by gap + textExtent(text,fontSize).w (mirrored for left shelf).
- e2e retune map: leader fixture tip 243, label 'type'/'gamma delta'; gap-strip window between shelf stroke and label ink must stay bare (differential vs crammed-at-tip); label ink windows move from `tip−40..tip` to `tip+gap .. tip+gap+w`; 'gamma delta' spill LEFT of shelf start (currently ink >0) becomes bare (label now hangs past tip, never past start); past-tip zero-ink window must move past label ink right edge; hit/select belowBand/aboveBand picks follow band x extension.
