# 2026-10-04_dsh-global-queue: глобальная очередь сообщений

**Created:** 2026-10-04T12:06:00+03:00

## Scope

Новый плагин `dsh-global-queue` (пакет `packages/dsh-global-queue`), Cordis-плагин с host- и client-половинами:

**Host-половина:**
- Глобальная очередь промптов в файле `$DSH_HOME/.global-queue.json` (dotfile, общий для всех workspace; атомарные записи + кросс-процессный замок).
- Элемент очереди: `{ id, text, workspacePath, targetSessionId (null = новая сессия), status, sessionId?, stats?, createdAt, updatedAt }`.
- Статусы: `queued` / `running` / `done` / `interrupted` (interrupted — turn завершился по незавершённой причине (aborted/blocked/error/…) или dsh перезапустился посреди исполнения).
- Фоновый watcher: когда модель глобально свободна (`ctx.agents.list().every(a => a.status === 'idle')`) — берёт следующий `queued` элемент и исполняет:
  - новая сессия: `ctx.agents.create({ meta: { cwd: workspacePath } })`;
  - продолжить: live `agent.followup(...)` или `ctx.agents.resume({ resumeSessionId })` для хранимой сессии.
- Статистика элемента: **общее время выполнения** (хост записывает `startedAt`/`endedAt` в элемент) и **общее количество токенов** (проеция `tokenUsage`; для продолженной сессии — дельта «до/после» выполнения). Отображение компактное: `1h 35m, 30.5M`. Адрес для навигации = SessionId.
- Ручное удаление элементов (через RPC из UI). Автоматического удаления нет.
- Очередь переживает перезапуск dsh (файл на диске); «running»-элементы при старте без live-агента помечаются `interrupted`.

**Client-половина:**
- Вкладка **«Show queue»** в правом сайдбаре — новый тип вкладки, регистрируемый через `ctx.sidebarRightTabs.register(...)` + keyed-слоты `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` (dockkit-система вкладок dsh 0.2.0-rc.2).
- Содержимое вкладки: список элементов по порядку; редактирование порядка — **drag-and-drop**; редактирование текста; удаление; статус; компактная статистика `1h 35m, 30.5M`; для `running`/`done`/`interrupted` — ссылка «открыть сессию» (`ctx.uiWorkspace.openSession(sessionId)`).
- **«Add to queue»** — контроль в слоте `conversation.input.right` (правее строки ввода, рядом с селектором модели): отправляет текст из поля в очередь. Цель выбора: «продолжить текущую сессию» / «новая сессия».

Out of scope:
- Параллельное исполнение нескольких промптов (локальная модель — один поток).
- Контекстное меню по ПКМ на кнопке Send (в 0.2.0-rc.2 на ней нет расширения — нужен upstream-чейндж; заменяется кнопкой в `conversation.input.right`).
- Автоматическое удаление выполненных элементов.
- Стоимость (в dsh нет cost-полей, только токены).

## Approach

- Структура пакета — как у `packages/dsh-model-settings`: `package.json` (host + client exports, `dsh.bundle.patch`, `dsh.client`), `cordis.patch.yml` (`id: global-queue`), `src/index.ts` (host: `inject = ['agents', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'sessionProjections', 'webServer']`, RPC-канал `/global-queue` — prefix-роут на `webServer`, проверенный паттерн для 0.2.0-rc.2), `src/client/index.ts` (тип вкладки + контроль в `conversation.input.right`), tsdown-бандл клиента.
- Файл очереди: `$DSH_HOME/.global-queue.json`; запись — `withFileLock` + `writeFileAtomic` (mode 0o600) из `@deepseek-ai/dsh-atomic-write` (прецедент `.credentials.yaml`); config `path: !!js dshHomePath('.global-queue.json')`, дефолт через `resolveDshHome()`.
- Детект «свободно»: событие `agent/status` + первичная проверка при старте плагина; «глобально свободно» = все агенты idle.
- Завершение элемента: `turn/end` событие с reason → `done` (completed) или `interrupted` (остальные причины). Статистика: общее время = `endedAt - startedAt` (записываются хостом в элемент); токены = проекция `tokenUsage` (live: `sessionProjections.snapshot`, cold: `sessionProjectionCache.cachedSnapshot`); для продолженных сессий хост снимает snapshot токенов до запуска и считает дельту.
- Клиент ходит в хост по своему RPC-каналу `/global-queue` (`connection.rpc.call`), wire-формат как в model-settings.
- UI вкладки: `createSnapshotStore` + `useStore`; навигация в сессию — `ctx.uiWorkspace.openSession(id)`.
- TDD: unit-тесты (store очереди, watcher, RPC-хендлер — даблы, без сети); e2e vitest-lane (boot smoke + RPC); playwright-acceptance (вкладка + кнопка).

## Constraints

- dsh 0.2.0-rc.2 (e2e-матрица и версия, на которой работает пользователь); `dsh/` checkout на ветке 0.2.0-rc.2.
- Встроенный сервис `rpc-host` сломан host-side в 0.2.0-rc.2 → плагин сам монтирует prefix-роут на `webServer` (паттерн model-settings).
- Правый сайдбар = `ui-sidebar-right` + `ui-dockkit`; слот `rightbar` занят — плагин регистрирует **тип вкладки**, а не колонку.
- На кнопке Send в 0.2.0-rc.2 нет слота/контекстного меню (InputBar) — ближайшая точка: list-слот `conversation.input.right`.
- В dsh уже есть встроенная per-session очередь: при занятости агента Send переименовывается в «Queue»/«Steer». Наша функция — отдельная глобальная очередь; naming не должен конфликтовать (вкладка «Show queue»).
- В dsh нет cost-полей (только токены) и нет единого поля «total duration» — выводится из `createdAt` → последнее событие или `llmMs + toolMs`.
- Сессии — event-логи; статистика — проекции `sessionStats` / `tokenUsage`; холодные сессии читаются через `sessionProjectionCache.cachedSnapshot`.
- В dsh нет per-plugin data-каталога — dotfile под `$DSH_HOME` — единственный прецедент глобального состояния плагина.
- Monorepo: frozen pnpm-установки (store `./.cache/pnpm/v11`), e2e на матрице 0.2.0-rc.2, изолированный `DSH_HOME` под `.tmp/`.
- Локальная модель = один поток → очередь глобально сериализована.

## Open questions

none

## Changes

- 2026-10-04T12:06:00+03:00 -- v1, initial spec (draft + research)
- 2026-10-04T12:55:26+03:00 -- user confirmed decisions: button in `conversation.input.right` (ПКМ on Send is impossible from the plugin); a separate `interrupted` status; stats = total time + total tokens in a compact format `1h 35m, 30.5M`; reorder = drag-and-drop; on dsh restart, `running` items → `interrupted`
