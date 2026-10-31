# @apkawa/image-editor

Standalone image annotation editor: plain TypeScript + canvas 2D, **zero
runtime dependencies** and zero coupling to dsh or React. It ships as a
self-contained browser bundle, so it can be mounted in any page — the
[`@apkawa/dsh-attach-editor`](../dsh-attach-editor) plugin bundles it privately
into its client envelope, and nothing else in the repo depends on it.

## What it does

Load an image (Blob), draw annotations over it, export the result as a PNG
Blob at the image's natural size. Zoom and pan are view state only — export
ignores them.

## Tools

| Tool | Gesture | Notes |
| --- | --- | --- |
| select | pointer | no drawing: click a shape to select it, drag empty picture to rubber-band a group (first toolbar button) |
| marker | freehand drag | stroke in the active tool's color/width (defaults: `#E5484D`, 4 px) |
| highlighter | freehand drag | starts at 14 px thick but honours the picked thickness like every other tool; opacity 0.4; the color is the highlighter's remembered color, red `#E5484D` until picked |
| arrow | drag a segment | arrowhead pushed one stroke width past the end point, so the shaft's round cap stays hidden inside the head |
| rect | drag a box | stroked rectangle |
| text | click | inline input appears at the click; Enter commits, Ctrl+Enter adds a new line, empty commit is dropped |

Drawing is confined to the picture. A draw or text gesture whose pointer lands
outside the image rect is ignored — no shape, no inline input, no pan — and every
point of a running gesture is pinned to the image rect (`clampToWorld`), so a
stroke, arrow, or box cannot leave the picture. The reason: export is the image's
natural size, so anything outside it would be drawn into a region the PNG never
shows and silently lost.

The toolbar is icon buttons. Color and thickness are single triggers showing the
current value; clicking one opens a palette popover below the toolbar (only one
popover is open at a time — Escape or an outside click closes it).

- Color presets (8 swatches): `#E5484D`, `#FFD666`, `#F5A623`, `#2F80ED`,
  `#27AE60`, `#9B51E0`, `#1A1A1A`, `#FFFFFF`.
- **Color is remembered per tool**: picking a swatch changes only the active tool's
  color, and switching tools switches to that tool's own color. Defaults:
  `#FFD666` for select, `#E5484D` for every drawing tool — the highlighter keeps
  its 0.4 opacity regardless of which color it draws with.
  Undo never reverts colors.
- Width presets (2, 4, 8, 14 px): **thickness is remembered per tool** — picking a
  width changes only the active tool's thickness, and switching tools switches to
  that tool's own thickness. Defaults: 14 px for the highlighter, 4 px for every
  other tool — the highlighter draws at the thickness it remembers, like every
  other tool, and only its 0.4 opacity is forced. Undo never reverts thicknesses.
- **Font size presets**: 12, 14, 18, 24, 32, 48 px, default 18. A label is one
  string with newlines in it: the box is the widest line wide and `LINE_HEIGHT`
  tall per line, so Ctrl+Enter grows the label downward.
- **Undo**: Ctrl+Z (or the toolbar button) — a snapshot stack over frozen
  scenes, in memory only; Delete removes every selected shape, Escape clears the
  selection, undo deselects too, and switching the active tool deselects.
- **Zoom**: wheel, anchored at the cursor (scale clamped 0.1–8; offsets are
  clamped to the image, so zooming cannot push the picture out of the viewport).
- **Pan**: middle mouse button, or dragging empty space with no tool active —
  moves by screen-space deltas and is bounded by the image: an image larger
  than the viewport cannot be dragged past its edges, a smaller one stays
  inside the viewport.
- **Reset view**: toolbar button (before undo) re-fits the image to the current
  viewport — scale and offsets back to the fitted state.
- **Selection is a set.** Picking a shape that is *not* selected needs the select
  tool or a held Ctrl/Cmd: with a drawing tool and no modifier a press on an
  unselected shape starts the drawing gesture, so a stroke paints over what is
  drawn. An **existing** selection is operated on under any tool, modifier or
  not — the gate covers picking, not editing: a press on the body of a selected
  shape moves **every** selected shape by one delta (one commit on release), a
  press on its stretch or rotate handle grabs that handle. With select active:
  click a shape to make it the selection; drag from empty picture inside the
  image rect to rubber-band, and the release selects every shape whose box the
  band crossed — a band that catches nothing clears the selection. A band
  started outside the picture does nothing. With a drawing tool and Ctrl held:
  clicking an unselected shape adds it to the selection, a dragless click on an
  already selected shape drops it, and dragging a picked shape moves the whole
  selection by one delta (one commit on release). With any drawing tool, a press
  on empty picture clears the selection and starts the gesture; a press outside
  the picture stays inert and keeps the selection.
- After drawing, arrow/rect/text show selection handles: drag the body to
  **move**, corner/edge handles to **stretch**, the rotate handle to **rotate**
  (about the bbox center). Freehand strokes can be selected and moved too.
  Every selected shape gets a dashed bbox; stretch/rotate handles appear only
  when exactly one shape is selected. A stretch keeps the bbox point *opposite*
  the grabbed handle — the far corner, or the far edge center for an edge handle
  — at the image-space position it had before the drag, so a rotated shape
  resizes predictably instead of sliding as it grows.
- **Stretching a label changes its font size, not its glyphs**: the dragged axis
  sets the ratio (drag twice as wide and the text doubles), the bbox scales by
  that ratio, and the point opposite the handle stays pinned, so the label grows
  away from it instead of drifting. Rotation of a label is unchanged.
- **A selected label gets a font-size button above its box** showing the size it
  is drawn at; picking a size there re-applies it to every selected text shape in
  one commit, so a rubber-banded group of labels changes together. The same button
  floats above the inline input while a label is being edited, and a size picked
  there re-renders the whole text being typed before it is committed.
- **Double click edits a label in place**: on a selected label (or a double click
  that picks one under the select tool or held Ctrl/Cmd) the inline input opens
  pre-filled; committing replaces that shape — one undoable commit, no second label.
- **The highlight follows the active tool's color**: the dashed bbox and the
  rubber band are stroked in the color that tool remembers — yellow `#FFD666`
  for select until another swatch is picked, and a pick repaints the highlight
  immediately. The handle squares and the rotate circle stay dark `#1A1A1A` so
  they read against any outline color. Export never draws the highlight.

## API

```ts
import { mountImageEditor } from '@apkawa/image-editor'

const controller = mountImageEditor(container, {
  image: blob,          // any image Blob
  onSave: (png) => {},  // exportPng() result handed to the host
  onCancel: () => {},
})
```

Controller methods: `setTool(tool)` (applies that tool's remembered color and
thickness), `setColor(hex)` (the active tool's color only), `setWidth(px)` (the
active tool's thickness only), `undo()`, `exportPng(): Promise<Blob>` (`image/png` at natural size,
independent of live zoom/pan), `dispose()`, plus `debugState()` — a debug
snapshot for the dev page, not part of the mount contract.

The pure modules are exported too (`createScene`, `addShape`, `textExtent`, `toolRegistry`,
`hitShape`/`hitHandle`/`topShapeAt`/`shapesWithin`, `moveShape`/`resizeShape`/`rotateShape`/`withFontSize`, `createHistory`,
`zoomAt`/`pan`/`clampView`/`clampToWorld`/`fitView`, `renderPng`), so the scene model can be driven
headless in node without DOM.

## Dev page

`pnpm build` emits `lib/` (types + node build) and `dist/editor.js` +
`dist/dev.js` (browser bundles). The demo page is `dev/index.html`.

- **Look at the editor:** `pnpm start` from this package dir — a vite dev
  server rooted at `dev/`, so `http://127.0.0.1:5173/` *is* the page and it
  opens straight away. The page loads `./dev.ts`, which vite compiles from
  source, so editing anything under `src/` reloads the page — no build step
  first. Those modules sit above the root, hence `server.fs.allow` in
  `vite.config.ts`. vite is a dev-only dependency — the editor itself stays
  dependency-free.
- **ES modules do not load over `file://`** — the page must be served over
  http. Served without vite, `./dev.ts` would arrive as raw TypeScript, so the
  e2e lane drives the built bundle instead: `tests/e2e/serve.ts` runs a node
  `http.createServer` over the package dir, maps `/` to `dev/index.html`,
  rewrites `./dev.ts` to `/dist/dev.js`, and serves nothing outside `dev/` and
  `dist/`; any server with that mapping works. `pnpm test:e2e` builds first
  (`pretest:e2e`), so the bundle it drives always matches `src/`.
- Image sources: file picker, paste into the box, or `?src=<url>` (the page
  fetches that URL as a Blob — the e2e spec feeds a `data:` URL this way).
- Debug hooks: `window.__editorState()` (tool/color/width/shapeCount/selected
  ids/zoom and pan offsets/shape kinds in stacking order/text labels with their font sizes) and `window.__lastExport`
  (size + type of the last Save).

## MVP limits

- A label's box is an **estimate until it is drawn**: the pure model has no font
  engine, so `GLYPH_WIDTH`/`LINE_HEIGHT` stand in for real metrics and the renderer
  corrects the box to the measured extent without touching history. That means a
  stored bbox before the first draw (and any hit test on it) is approximate, and the
  font is always `sans-serif` — per-label font choice is deferred.
- Pinning covers gesture points only. A shape that is already in the scene can
  still be moved or stretched outside the picture — selection, move, stretch and
  rotate are untouched — and such a shape simply does not appear in the exported
  PNG. Accepted trade-off: editing an existing annotation is not a drawing
  gesture, and clamping it would fight the transform handles.
- The rubber band selects by **bbox intersection**, not stroke geometry: a
  marker or arrow is caught when the band touches the box around its points,
  even where no ink is, and a rotated shape is matched by the axis-aligned box
  of its rotated corners. Touching edges count, so a click on empty canvas can
  land inside a stroke's box and select it. Accepted trade-off: the band picks
  up the footprint, which is the predictable rule for a group gesture.
- A press that grabs neither a handle nor a shape resets the selection: an
  empty rubber band and a drawing gesture on empty picture both deselect. A
  press outside the picture is inert and keeps the selection.
- Under a drawing tool, Ctrl picks instead of draws, and the toggle-off of a
  Ctrl press on an already selected shape is decided on **release**: a dragless
  press is a click and drops that shape, a dragged press moves the selection and
  keeps it. Ctrl with the select tool keeps the select behavior (a plain click
  replaces the selection).
- In the plugin, a saved edit **appends the new attachment at the end** of the
  composer's attachment list — the conversation facade has no public in-place
  swap, so the annotated image loses its original position. Accepted trade-off.
- At a pan/zoom bound the clamp wins over the cursor anchor: zooming toward an
  edge pins the offset to that bound instead of keeping the world point under
  the cursor. A window resize does not re-fit or re-clamp the view until the
  next pan, zoom, or Reset view.
- Zero runtime dependencies by design: no fabric/konva/react, no dsh imports;
  dev deps are catalog entries only, and `pnpm install` never changes them
  without an explicit lockfile decision.

See [AGENTS.md](./AGENTS.md) for structure, commands, and constraints.
