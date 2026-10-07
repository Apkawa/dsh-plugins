# Plan — 2026-10-06_global-queue-dnd-edit-fixes

**Task:** live DnD fix — drop target = whole row, drag image = whole row, dashed drop slot.
**Branch:** `2026-10-04_dsh-global-queue` (user-owned — no branch ops, no push, no `--amend`).
**Inputs:** `draft.md`, `research.md`, `spec.md` (v1).
**Scope:** spec item 1 only.

## Stage 0 — Task set up
- [x] draft/research/spec written, scope confirmed by the user (item 1 only)
- [x] task committed to `current/`

**Commit:** `docs(dumbspec): 2026-10-06_global-queue-dnd-edit-fixes task`

## Stage 1 — DnD fix + drag-state visuals
- [ ] RED: acceptance test — `dragstart` on the source handle, `dragover` + `drop` on the TARGET **row** (not the handle) reorders; between `dragover` and `drop` the target row shows computed `outline-style: dashed` with its first child `opacity: 0` and the source row `opacity: 0.4`; after `drop` both states clear; rows remain not-`draggable`, handle `draggable="true"`; update the header contract block
- [ ] GREEN: `QueuePane.tsx` — pane-level `draggingId`/`dragOverIndex` state; row gets `onDragOver` (`preventDefault` + set `dragOverIndex`) / `onDrop` (`preventDefault`, clear states, `onReorder`) / `rowRef`; handle keeps `draggable` + `onDragStart` (sets `text/plain`, `setDragImage(rowRef, x, y)` with pointer offset, sets `draggingId`) + `onDragEnd` (clears both states); row className: `css.dragging` when `draggingId === item.id`, `css.dropTarget` when `dragOverIndex === index`
- [ ] GREEN: `queue-pane.module.css` — `.dropTarget { outline: 2px dashed var(--dsw-alias-border-l3); outline-offset: -2px }` + `.dropTarget > * { opacity: 0 }`; `.dragging { opacity: 0.4 }`; tokens only
- [ ] Refactor; typecheck + unit + acceptance green

**Criterion:** in a real browser, dragging the handle and dropping anywhere on a target row reorders; while dragging, the target slot is dashed + freed and the source row dims; e2e green.
**Commit:** `fix(global-queue): drag rows via handle onto the whole row, with drag-state visuals`

## Stage 2 — Full regression + final pass
- [ ] `pnpm typecheck`, `pnpm test` (unit), `pnpm test:e2e` (vitest), `npx playwright test` (acceptance) all green
- [ ] Final pass over plan.md checkboxes

**Criterion:** every lane green.
**Commit:** N/A (fix commits only if something surfaces)
