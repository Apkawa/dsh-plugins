# 2026-10-06_global-queue-dnd-edit: implementation plan (dnd handle, queued edit, icons)

Spec — [spec.md](./spec.md); research — [research.md](./research.md).

**Format:** each stage = TDD (red test → green implementation → refactor) + a commit at the end.
This file is a **living progress journal** — update statuses as work proceeds.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Stage 0 — Research + spec + plan
- [x] Draft captured verbatim (3 items: dnd handle, queued edit, icons)
- [x] User refinements: drag handle = text, textarea = auto-grow, icons = catalog, double-click = kept
- [x] Research (R1–R5): DnD already on whole row; `editText` RPC + store exist; `IconEditOutlineRegular`/`IconTrashOutlineRegular` importable; DOM contract mapped; CSS pipeline wired
- [x] Spec v1 (all open questions resolved) + plan

**Criterion:** draft/spec/research/plan in place, no blocking questions.
**Commit:** `docs(dumbspec): 2026-10-06_global-queue-dnd-edit task`

## Stage 1 — DnD: drag only via `⋮⋮` handle (item 1)
- [x] RED: acceptance test — `dragstart`/`dragover`/`drop` dispatched on `[data-testid="global-queue-drag"]` reorders; drag events on the row body do NOT start a drag (row is not `draggable`); update the existing DnD test (`acceptance.spec.ts:138-142`) and the header contract line `:33`
- [x] GREEN: `QueuePane.tsx` — new `<span data-testid="global-queue-drag">⋮⋮</span>` at row start carries `draggable` + `onDragStart`/`onDragOver`/`onDrop`; row drops `draggable`; CSS: `cursor: grab` moves from `.row` to `.drag` (row cursor default), handle styled (14/22, `--dsw-alias-label-secondary`, `user-select: none`)
- [x] Refactor; typecheck + unit (44/44) + acceptance (15/15) green

**Criterion:** reorder works via the handle only; whole-row drag is gone; DnD test green on the handle.
**Commit:** `feat(global-queue): drag rows via ⋮⋮ handle only` (`53ff393`)

## Stage 2 — Queued edit: multi-line textarea + Cancel/Save + double-click (item 2)
- [x] RED: acceptance tests — (a) double-click on `.text` of a `queued` row → `global-queue-edit` is a multi-line textarea (visible, grows with multi-line content); (b) Save button commits via `editText` (text updated in the list); (c) Cancel discards (original text stays); (d) Enter/blur do NOT commit; (e) non-`queued` rows expose no Edit affordance and double-click does nothing; Edit button (left of Remove) enters edit mode
- [x] GREEN: `QueuePane.tsx` — auto-growing `<textarea data-testid="global-queue-edit">` (`.editWrap`, `max-height: 200px`, `resize: none`); edit mode: textarea + **Cancel** (`global-queue-cancel`)/**Save** (`global-queue-save`) below; **Edit** button (`global-queue-edit-button`) left of Remove; entry = Edit click OR double-click on `.text` (single-click removed); commit only via Save; Enter/blur no-ops, Escape/Cancel discard; gate `item.status === 'queued'`
- [x] Refactor; typecheck + build + 44/44 unit + 20/20 acceptance green — notes: new e2e fixture `seedFileItem(text, status)` writes the queue file atomically (RPC `add` wakes the watcher which consumes the item within ~1s, so file-seeded rows stay `queued`); blur is a no-op by design (Save/Cancel mousedown would unmount the field first)

**Criterion:** queued items edit in a multi-line auto-growing textarea; submit only via Save; non-queued items are read-only; all new e2e asserts green.
**Commit:** `feat(global-queue): edit queued messages in a multi-line textarea` (`b465276`)

## Stage 3 — Icon buttons for Remove and Edit (item 3)
- [x] RED: acceptance tests — Remove and Edit render as icon buttons (exactly one `svg` each inside the button); accessible names preserved (`getByRole('button', { name: 'Remove' })` / `{ name: 'Edit' }` work); Remove keeps h28 geometry
- [x] GREEN: `QueuePane.tsx` — named imports of the edit-pencil and trash outline icons (Regular weight) from `@deepseek-ai/dsh-client-ui-primitives` (already a platform external, `tsdown.config.ts:19`); buttons become plain `<button>` + 16px icon + `aria-label` ("Remove"/"Edit"); CSS: icon-button shape (h28, r14, transparent, `currentColor` icon, ghost hover tone, `inline-flex` centering)
- [x] Refactor; typecheck + 44/44 unit + 21/21 acceptance green — deviation: `tsconfig.client.json` typecheck-only `paths` entry maps the ui-primitives package to the pinned-tree `.pnpm` path (not an npm dep of this package under frozen installs; the `dsh/` checkout `lib/` is stale)

**Criterion:** both actions are 16px icon buttons from the catalog; role-name contract intact; Remove h28 probe green.
**Commit:** `feat(global-queue): icon buttons for edit and remove` (`a80a678`)

## Stage 4 — Full regression + final pass
- [x] `pnpm typecheck`, `pnpm test` (unit 44/44), `pnpm test:e2e` (vitest 8/8), `npx playwright test` (acceptance 21/21) all green
- [x] Final pass over plan.md checkboxes

**Criterion:** every lane green.
**Commit:** N/A (fix commits only if something surfaces)
