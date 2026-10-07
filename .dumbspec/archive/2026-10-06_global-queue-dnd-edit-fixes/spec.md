# Spec — live DnD fix (item 1 only)

**Created:** 2026-10-06T15:11:27+03:00
**Status:** v1
**Scope:** draft item 1 only (items 2–3 closed as test artifacts, user-confirmed).

## 1. Fix: drag-and-drop works in a real browser

- Drag SOURCE: the `⋮⋮` handle only (no change — the row is not `draggable`).
- Drop TARGET: the WHOLE receiving row. `onDragOver` (with `preventDefault`) and `onDrop`
  move from the handle to the row; `onDragStart` stays on the handle.
- Drop reorders via the existing `reorder` RPC (unchanged): dragging row B onto row A moves B
  to A's position.

## 2. Visuals while dragging

- The row «grabs to the mouse»: the drag image is the whole row (not the glyph), positioned
  under the cursor (`setDragImage` with the pointer offset inside the row).
- The carried row's origin slot dims (`opacity: 0.4`).
- The receiving slot «frees»: its content clears (children `opacity: 0`, layout preserved)
  and the slot is highlighted with a dashed border (`2px dashed`, l3 token).
- Exit: after a drop (reorder committed) or an aborted drag, both states clear (single reset
  point: `onDragEnd` on the handle).

## 3. DOM contract

- `global-queue-drag` — handle, `draggable="true"`, the only drag source.
- `global-queue-row` — not `draggable`; the whole row is the drop target.
- In-flight: the target row shows a dashed outline (computed `outline-style: dashed`); the
  source row dims to `opacity: 0.4`. No new testids needed (states are style-driven).

## Non-goals

- Edit gate / textarea / icon buttons — untouched.
- `reorder` RPC / `store.reorder` — untouched.
- Auto-reorder on `dragover` (live reorder while hovering) — not requested; reorder commits
  on drop, as today.

## Open questions

None — scope confirmed by the user (item 1 only; the visual reading matches the request).
