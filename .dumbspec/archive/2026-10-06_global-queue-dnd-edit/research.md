# Research: 2026-10-06_global-queue-dnd-edit

Superficial scan of `packages/dsh-global-queue` (client pane, RPC, store, CSS, e2e contract, icon catalog).

## R1 — Current DnD state

- `src/client/QueuePane.tsx:104` — the row `<div>` itself is `draggable` (whole-row drag surface), with `onDragStart` (`:83-85`, writes `item.id` into `text/plain`), `onDragOver` (`:86-88`, `preventDefault`), `onDrop` (`:89-94`, reads payload → `props.onReorder(dragged, props.index)`). No `onDragEnd` anywhere.
- `src/client/QueuePane.tsx:28-30` — `reorder(id, toIndex)` → `callRpc('reorder', { id, toIndex })` → `refresh()`.
- `src/queue/store.ts:45-52` — `store.reorder` exists; host-side path complete.
- `src/client/queue-pane.module.css:49` — `.row { cursor: grab }`; hover tone `:52-54`.
- **Missing:** a `⋮⋮` handle element carrying the DnD; `draggable` must move off the row.

## R2 — Current edit state (save path already exists end to end)

- `src/client/QueuePane.tsx:125` — trigger is **single click** on `.text` span (`beginEdit`, `:70-74`).
- `src/client/QueuePane.tsx:109-122` — single-line `<input data-testid="global-queue-edit">`, `autoFocus`; `settleEdit` (`:75-81`): **Enter and blur commit**, Escape cancels, empty draft no-ops; `settled` ref (`:68`) guards the double-RPC race.
- `src/rpc.ts:131-137` — **`editText` RPC endpoint exists**: `{ id: string, text: string }` → `store.editText`.
- `src/queue/store.ts:54-60` — `store.editText(id, text)` updates `text` + `updatedAt`. (Generic `store.update` `:69-81` is host-only, no RPC.)
- `src/client/queue-pane.module.css:93-105` — `.edit` h32 r8 hairline, `flex: 1 1 100%`.
- **Missing (UI only):** multi-line auto-growing `<textarea>`; Edit button left of Remove; Cancel/Save buttons below the field; double-click entry; **status gate — edit must only be available for `queued`** (today there is no gate); **submit-via-button-only** (today Enter/blur commit — must be removed).

## R3 — Icon catalog (`@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2`, pinned tree)

- Named imports from package root: `IconEditOutlineRegular` / `IconEditOutlineMedium` (`lib/types/icons/index.d.ts:110,112`), `IconTrashOutlineRegular` / `IconTrashOutlineMedium` (`:142,144`); also Close/Check/Plus variants.
- Props: `{ size?: number; className?: string }` — color rides `currentColor` (`lib/types/icons/props.d.ts:2-8`). No `strokeWidth` prop; weight = variant (Regular 1, Medium 1.3).
- **No grip/drag-handle glyph in the catalog** (closest `IconChevronsUpDownOutline`) — irrelevant: user chose the `⋮⋮` **text** handle.
- Import is wired: `tsdown.config.ts:19` lists `@deepseek-ai/dsh-client-ui-primitives` in `PLATFORM_MODULES`, external at `:63`, `noExternal` guard `:65`. No `package.json` changes needed.
- Precedent: the plus icon in `src/client/AddToQueue.tsx:52-55` is a hand-written inline SVG; `Button` primitive (`variant`/`size`/`icon`) exists in the catalog if a composed button is preferred (in the previous task it was rejected for `data-testid` passthrough reasons — plain `<button>` + CSS module is the established plugin pattern).

## R4 — DOM contract (`data-testid`)

In `QueuePane.tsx`: `global-queue-pane` (`:35,:37`), `global-queue-row` (`:101` + `data-item-id` `:102`), `global-queue-edit` (`:112`), `global-queue-status` (`:127`), `global-queue-remove` (`:128`), `global-queue-stats` (`:129`), `global-queue-open` (`:132`); `global-queue-add` in `AddToQueue.tsx:50`.

Asserted in `tests/e2e/acceptance.spec.ts` (header contract `:17-62`):
- DnD `:138-142` — dispatches `dragstart`/`dragover`/`drop` **on the rows** (contract line `:33`); **must move to the handle** when drag is handle-only.
- `:154` — click text → `global-queue-edit` visible → `fill()` → `press('Enter')` commits; **must change to double-click + Save button**.
- `:258`, `:275-278` — edit field geometry **h32/r8** probe + `press('Escape')`; **h32 breaks for an auto-growing textarea** — geometry test must be rewritten (e.g. assert min-height, not fixed 32).
- `:167` — `getByRole('button', { name: 'Remove' })`; **icon buttons need `aria-label` to keep this working**.
- `:215` — Remove geometry h28/r14 ghost capsule probe (icon button keeps h28).
- `:177,:212` — status label visible/geometry; `:283,:516` — open link; `:166,:168,:176,:190,:254` — `data-item-id` row scoping.
- `global-queue-stats` is documented but not asserted.

## R5 — CSS pipeline

- `src/client/queue-pane.module.css` — classes: `.pane`, `.empty`, `.list`, `.row` (+`:hover`), `.text`, `.status` + per-state, `.edit`, `.remove` (+`:hover`), `.stats`, `.open` (+`:hover`), shared `:focus-visible` ring (`:149-154`).
- Delivery confirmed: `tsdown.config.ts:66-90` vendored `dsh-css-inline` + `lightningcss` (cssModules `[hash]_[local]`, minify), `<style data-plugin>` auto-inject; `lightningcss` devDep in `package.json:49`.
- Tokens: only `--dsw-alias-*` / `--dsw-radius-*`; focus ring `0 0 0 2px var(--dsw-alias-border-l3)`; sm capsule h28 r14.

## Verdict

- **(1) Drag handle:** DnD + `reorder` RPC + store exist; only the drag surface moves to a new `⋮⋮` handle element (+ e2e test update).
- **(2) Multi-line edit:** the entire save path (`editText` RPC → `store.editText`) exists; work is UI: textarea auto-grow, Edit/Cancel/Save buttons, double-click entry, `queued`-only gate, submit-via-button-only (drop Enter/blur commit).
- **(3) Icons:** `IconEditOutlineRegular` + `IconTrashOutlineRegular` importable today, zero config changes; plain `<button>` + CSS module per established plugin pattern.

## Not determined

- Exact `⋮⋮` glyph styling (text baseline, letter-spacing, cursor) — design detail for the plan.
- New testid name for the drag handle (suggest `global-queue-drag`) — plan detail.
