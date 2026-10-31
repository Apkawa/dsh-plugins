# 2026-10-29_dsh-attach-editor: редактор аттача перед отправкой

**Created:** 2026-10-29T22:38:06+03:00

## Scope

**In scope (MVP):**

- `packages/image-editor` — standalone редактор разметки изображения, framework-agnostic, **без dsh-зависимостей**, с возможностью запуска отдельно (тестовая страница, которую можно потыкать в браузере).
- `packages/dsh-attach-editor` — плагин: аттач-изображение в композере → предпросмотр → кнопка «Редактировать» → редактор во вкладке правого сайдбара → сохранение заменяет аттач на новый.
- Инструменты редактора: маркер, текстовыделитель (по умолчанию жёлтый), стрелка, прямоугольник, текст; цвет по умолчанию красный; быстрый выбор цвета и толщины из предустановленных вариантов; undo (Ctrl+Z); зум колесом мыши.
- Стрелка, прямоугольник, текст редактируются после отрисовки: перемещение, растяжение, поворот.
- Экспорт результата: PNG (Blob → File), который плагин возвращает как новый аттач.

**Out of scope (MVP):**

- Текстовый редактор аттача (архитектура должна это допускать: редактор — отдельный пакет/вкладка, плагин лишь монтирует).
- Кэп, фильтры, слои, экспортируемая история/JSON-сцены (кроме внутреннего undo), работа с аттачами после отправки.

## Approach

1. **Движок — vanilla canvas 2D, без npm-зависимостей.** Fabric.js и react-konva физически недоступны в этом репозитории: их нет в `pnpm-lock.yaml`/`node_modules`, а политика репозитория запрещает добавление зависимостей (frozen installs). `react-dom` тоже отсутствует, поэтому React-редактор не сможет рендериться standalone. Решение: собственный canvas-2d редактор (KISS), чистая модель сцены в `.ts` (юнит-тесты в node-окружении, без jsdom) + отдельный слой рендера и ввода.
   - Сцена: `shapes[]` (marker/highlighter/arrow/rect/text), каждый с `color`, `width`, трансформацией (`x,y,w,h,rotation`).
   - Undo — стек снимов сцены (Ctrl+Z), без сериализации на диск.
   - Выделение и ручки для arrow/rect/text: перемещение, растяжение, поворот.
   - Зум колесом (центр на курсоре) + панорамирование.
2. **Публичный API `packages/image-editor`** (не зависит от dsh и React):
   `mountImageEditor(container, { image, initial, onSave(blob), onCancel() }) → controller`, где controller: `setTool`, `setColor`, `setWidth`, `undo`, `exportPng()`, `dispose()`. React-обёртка — только в плагине (mount/unmount через ref + `signal`).
3. **Плагиновая половина (client-only, React):**
   - Предпросмотр и кнопка редактирования: dsh-ный `ImageLightbox` не имеет детей/слотов, а превью — локальный `useState` внутри `ComposerAttachments`. Единственный способ получить «кнопку над изображением» — **заменить** слот `conversation.input.attachments` (kind `single`; регистрация заменяет shipped-представление) своей реализацией рела: thumbnail + remove + FileCard + upload-progress/retry + drop + собственный превью-оверлей с кнопкой «Редактировать». Это осознанная стоимость (пере-реализация рела на owner-пропсах), взамен даёт полный контроль над превью.
   - Вкладка сайдбара: `sidebarRightTabs.register({ id: '@apkawa/dsh-attach-editor', kind: 'attach-editor', title, guide })` + `slots.inject('sidebar.right.pane.tab', () => slots.register({ name, key: TAB_ID }, EditorTabBody))`; открытие — `sidebarRight.openTab('attach-editor')` с retry по `mounted` (поверхность сессии adopts после `mounted`).
   - Замена аттача: из Blob'а редактора делаем `File` → `conversation.createDrafts(sessionId, [file])` → `inputActions.addAttachments([newId])` → `inputActions.removeAttachment(oldId)` + `conversation.releaseDraftAttachment(oldId)`. Порядок аттачей: новый добавляется в конец (in-place swap публично отсутствует) — это приняемый trade-off MVP.
   - Хост-половина не нужна (аттачи живут в браузере до отправки; base64 только в `sendSession`).
4. **Тестовая страница редактора:** `packages/image-editor/dev/index.html` + ESM-бандл, собранный `tsdown` (без `__ModuleLoader__`-баннера); serving по http (`python3 -m http.server`, артефакты в `.tmp/`); проверка — `@playwright/test` на кэшированном chromium (без запуска dsh).
5. **TDD:** чистая модель сцены/инструментов/undo/трансформаций и логика плагина (выбор аттача, замена) — юнит-тесты сначала, потом реализация; браузерные проверки — playwright-лейн.

## Constraints

- pnpm workspace `packages/*`; **frozen installs**: `fabric`/`konva`/`react-konva`/`react-dom`/`clsx`/`jsdom` отсутствуют; добавление зависимостей невозможно без решения пользователя.
- Новые пакеты (`packages/image-editor`, `packages/dsh-attach-editor`) сами по себе — изменение `pnpm-lock.yaml` (новый importer). Это **явный gate: обновление lockfile требует approve пользователя**.
- Юнит-тесты — только `environment: node` (jsdom не установлен); DOM-поведение проверяется playwright'ом.
- React 18.3.1 предоставляется dsh-шеллом как shared external (`PLATFORM_MODULES`); плагин бандлит client как CJS под `window.__ModuleLoader__`, CSS Modules + lightningcss, токены `--dsw-*`.
- `packages/image-editor` не declares ни одной dsh-зависимости и не импортирует dsh; плагин не импортирует рантайм-значения из `ui-attachment`/`ui-primitives` сверх shared-примитивов — свой UI на owner-пропсах слота.
- Временные артефакты в `.tmp/`, кэши в `.cache/`; никогда `playwright install`; изолированный `DSH_HOME` в e2e.

## Open questions

- Ни одного блокирующего вопроса. Разрешённые ранее решения: движок — vanilla canvas (Fabric/konva недоступны); превью — замена рела; замена аттача — createDrafts + add/remove (порядок: новый в конце).
- Требует пользователя, не решения: разблокировка lockfile для двух новых пакетов (см. Constraints).

## Changes

- 2026-10-29T22:38:06+03:00 -- v1: спецификация из draft + research (движок vanilla canvas вместо Fabric/react-konva из-за frozen-lockfile и отсутствия react-dom; превью через замену слота `conversation.input.attachments`; замена аттача через `createDrafts` + `addAttachments`/`removeAttachment`; хост-половина не нужна).
- 2026-10-30T04:27:00+03:00 -- v2 (execution reality): the pane resolves the image Blob through a plugin-local `attachmentRegistry` (the rail remembers owner-provided attachments; cross-plugin imports are forbidden, so `ConversationController.draftAttachments` is unreadable); the phase guard is `input.shell(id)` returning false (`facade.ts:221`) checked before any draft is created, not a throw; the replacement lands at the end of `attachmentIds` (accepted trade-off); send-side image modality gating was observed passing on the fixture model, so the refusal banner is unit-covered only.
