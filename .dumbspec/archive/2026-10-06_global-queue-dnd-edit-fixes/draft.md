# Draft — live DnD fix after 2026-10-06_global-queue-dnd-edit

**Date:** 2026-10-06
**Branch:** `2026-10-04_dsh-global-queue`
**Predecessor task:** `.dumbspec/archive/2026-10-06_global-queue-dnd-edit` (commit `a80a678`, archived `684a503`)

## Raw request (verbatim)

> 1) dnd сломался, перетаскивание не работает. Надо бы его починить + более визуальное отображение перетаскивания (строка хватается к мыши, а место куда можно кинуть - освобождается и подсвечивается пунктирной границей
> 2) кнопки редактирования нет и не работает даблклик
> 3) иконка удаления есть, с этим ок, а с иконкой редактирования см пп2

## Scope (user-confirmed 2026-10-06)

> «ой, я плохо протестил, короче, актуальный остался только пп 1 — остальное вроде ок теперь»

**Only item 1 is in scope:**
- (a) **Fix:** dragging does not work in the live browser — the drop handlers live on the 14px
  `⋮⋮` handle, so a drop only registers if it lands exactly on the glyph. The drop target must
  be the WHOLE receiving row (the handle stays the only drag source).
- (b) **Visuals:** while dragging, the row «grabs to the mouse» (drag image = the whole row, not
  the glyph); the slot that can receive the drop is «freed» — its content clears and the slot is
  highlighted with a dashed border.

Items 2–3 are closed as test artifacts (the edit gate is `queued`-only by spec; the live items
had already transitioned to `running` by the time the user looked).
