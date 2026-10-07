# 2026-10-06_global-queue-dnd-edit: доработки dsh-global-queue (dnd, редактирование, иконки)

**Created:** 2026-10-06T10:44:38+03:00

## Scope

Три доработки клиентской половины `packages/dsh-global-queue` (панель очереди):

1. **DnD drag handle `⋮⋮`** — перетаскивать строку можно только за элемент-хэндл `⋮⋮`; drag по остальной области строки отключён.
2. **Редактирование queued-сообщения** — только в статусе `queued`: текст строки превращается в многостраничный textarea (авторост); сабмит только по кнопке. Кнопка **Edit** слева от **Remove**; внизу textarea две кнопки — **Cancel** и **Save**. В редактирование можно попасть и даблкликом по тексту элемента.
3. **Иконки для Remove и Edit** — обе кнопки — иконки (из каталога `@deepseek-ai/dsh-client-ui-primitives`).

Вне scope: server-push/подписка на статусы (pull-only — известный лимит), хост-часть плагина (RPC `editText`/`reorder` и store уже существуют и не меняются), другие плагины, локализация.

## Approach

**1. Drag handle.** Перенести `draggable` + `onDragStart`/`onDragOver`/`onDrop` с row-`<div>` на новый `<span data-testid="global-queue-drag">⋮⋮</span>` в начале строки. У row убрать `draggable` и `cursor: grab` (cursor `grab` переезжает на хэндл). `reorder` RPC + `store.reorder` без изменений. E2E: DnD-тест (`acceptance.spec.ts:138-142`) теперь диспатчит `dragstart`/`dragover`/`drop` на хэндл.

**2. Редактирование.** Заменить однострочный `<input>` на `<textarea>` с авторостом (`onInput`/`useEffect` → `height = scrollHeight`; `max-height` + `overflow-y: auto` как предохранитель). Кнопки: **Edit** (иконка) — слева от **Remove** (иконка) в кластере действий строки; в edit mode под textarea — **Cancel** и **Save**. Вхождение в edit mode: клик по кнопке Edit ИЛИ даблклик по `.text` (single-click больше не триггер). **Gate:** Edit-кнопка и даблклик активны только при `item.status === 'queued'`. **Сабмит только по Save**: убрать commit по Enter и blur (Escape — отмена, как сейчас). Save → существующий `editText` RPC (`rpc.ts:131-137`); Cancel — без изменений.

**3. Иконки.** `IconEditOutlineRegular` и `IconTrashOutlineRegular` — named-импорты из `@deepseek-ai/dsh-client-ui-primitives` (platform external, `tsdown.config.ts:19` уже настроен; `package.json` не трогать). Кнопки — plain `<button>` + CSS-модуль (установленный паттерн плагина, как plus-icon в `AddToQueue.tsx`). Сохранить доступимые имена (`aria-label` / role name) так, чтобы `getByRole('button', { name: 'Remove' })` (`acceptance.spec.ts:167`) продолжал работать.

## Constraints

- CSS: только CSS-модуль с токенами `--dsw-alias-*` / `--dsw-radius-*`; доставка через vendored `dsh-css-inline` + `lightningcss` (уже настроен, `tsdown.config.ts:66-90`).
- Иконки: только из каталога `@deepseek-ai/dsh-client-ui-primitives`; проп `{ size?, className? }`, цвет через `currentColor`; в каталоге **нет** grip-глифа — хэндл `⋮⋮` остаётся текстом.
- `data-testid`-контракт (`tests/e2e/acceptance.spec.ts`) сохранить; меняются только: DnD-диспатч на хэндл (новый `global-queue-drag`), вхождение в edit (даблклик + Save), геометрия edit-поля (h32 → авторост).
- E2E: только dsh `0.2.0-rc.2` (`E2E_DSH_VERSIONS`); изолированный `DSH_HOME`; frozen pnpm; `playwright install` запрещён.
- TDD: red → green → refactor; conventional commit в конце каждой стадии.
- Стиль: без `any`, без `else`, без алиас-импортов; минимальный код.

## Open questions

1. **RPC-эндпоинт редактирования.** RESOLVED (research): `editText` уже существует (`rpc.ts:131-137` → `store.editText`, `store.ts:54-60`) — новый эндпоинт не нужен.
2. **Иконки.** RESOLVED (пользователь + research): из каталога `ui-primitives` — `IconEditOutlineRegular`, `IconTrashOutlineRegular`.
3. **Высота textarea.** RESOLVED (пользователь): авторост по контенту.
4. **Drag handle `⋮⋮`.** RESOLVED (пользователь): текст (не SVG).
5. **Дабблклик.** RESOLVED (пользователь): остаётся вторым путём в редактирование.

## Changes

- 2026-10-06T10:44:38+03:00 -- v1, initial spec (draft + research)
