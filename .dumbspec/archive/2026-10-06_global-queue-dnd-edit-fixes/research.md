# Research — live DnD fix

## R1 — Root cause: the drop target is a 14px glyph

`QueuePane.tsx:104-115,126-135` — `onDragStart`/`onDragOver`/`onDrop` ALL live on the handle
`<span draggable>`. The row `<div>` (`:121-125`) carries no drag handlers.

In a real browser, HTML5 DnD fires `drop` only on the element under the pointer that has
received `dragover` with `preventDefault()`. That element is the 14px `⋮⋮` glyph — the user
must drop exactly onto the target row's handle. Practically: «перетаскивание не работает».

The e2e lane cannot see this: `acceptance.spec.ts:162-164` dispatches synthetic
`dragstart`/`dragover`/`drop` straight onto the handles, bypassing hit-testing entirely.
21/21 green, live broken — classic synthetic-event gap.

**Fix:** `draggable` + `onDragStart` stay on the handle (the only drag SOURCE);
`onDragOver`/`onDrop` move to the row (the whole row is the drop TARGET).

## R2 — Drag image: the row must «grab to the mouse»

Today the browser's drag preview is the 14px glyph. `dataTransfer.setDragImage(element, x, y)`
(synchronous, inside `onDragStart`) makes the WHOLE ROW the preview, offset by the pointer
position within the row so it lands under the cursor:

```ts
const rect = rowRef.current.getBoundingClientRect()
event.dataTransfer.setDragImage(rowRef.current, event.clientX - rect.left, event.clientY - rect.top)
```

`Row` needs a `rowRef` on the row `<div>`; the handle's `onDragStart` closure captures it.
Risk: the e2e lane's synthetic `new DataTransfer()` — `setDragImage` on it is expected to be
a safe no-op in Chromium (verify in the GREEN run; if it throws, the e2e will show it).

## R3 — Drop-state visuals

Two transient states, both owned by the PANE (the drop target is a sibling of the source —
per-row local state cannot express «row N is the target»):

- `draggingId: string | null` — set in `onDragStart`, cleared in `onDragEnd` (fires after a
  drop AND after an aborted drag, so it is the single reset point).
- `dragOverIndex: number | null` — set in the row's `onDragOver` (repeated `dragover` events
  with the same value → React bail-out, no render storm), cleared together with
  `draggingId` in `onDragEnd`. No `onDragLeave` clearing: moving onto a child re-fires
  `leave` spuriously; the next row's `dragover` re-targets, and `dragend` resets the rest.

CSS (tokens only):

- `.dropTarget` (the receiving slot «frees»): `outline: 2px dashed var(--dsw-alias-border-l3)`,
  `outline-offset: -2px` (inside the row box, over the hairline), `.dropTarget > * { opacity: 0 }`
  — content clears, layout/height preserved (no list jump).
- `.dragging` (the carried row's origin): `opacity: 0.4`.

`--dsw-alias-border-l3` is the established «stands out» token (focus ring `:216`, Save
`border-color` `:161`).

## R4 — e2e contract changes (`tests/e2e/acceptance.spec.ts`)

- `:148-167` DnD test: `dragstart` on the SOURCE handle, `dragover` + `drop` on the TARGET
  **row** (`rows.nth(0)`, not `targetHandle`) → reorder works.
- New asserts (same test): after `dragstart` + `dragover` on the target row, before `drop` —
  target row computed `outline-style: dashed` and its first child `opacity: 0`; source row
  `opacity: 0.4`. After `drop` — both back to normal (`outline-style: none`, `opacity: 1`).
- Keep: rows not `draggable` (`:156-157`), handle `draggable="true"` (`:160`).
- Header contract block (`:33`): drop target = the whole row; drag source = the handle only;
  in-flight states: dashed drop-target slot + dimmed source row.

## R5 — Unchanged

`reorder` RPC → `store.reorder` (`rpc.ts`, `store.ts`) — untouched. Edit gate, icons,
textarea — untouched (draft scope: item 1 only).

## Verdict

Small, local change: two handlers move from handle to row, two pane-level states, two CSS
classes, one `setDragImage` call, e2e contract updated. No host-side, no RPC, no deps.
