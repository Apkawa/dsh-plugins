# 2026-10-06_queue-session-profile: профиль сессии для промптов из очереди

**Created:** 2026-10-06T21:49:30+03:00

## Scope
- **В рамках:** исправление бага в `packages/dsh-global-queue` — при выполнении очередного промпта, создающего новую сессию (`targetSessionId === null`), сессия создаётся **без профиля** (нет `agentPreset` в header и не смонтирован preset). Нужно, чтобы такая сессия получила профиль, выбранный пользователем в слоте `conversation.hero.agentPreset`.
- **В рамках (добавлено по итогам deep-dive):** **resume-путь** — `ctx.agents.resume` не монтирует хранящийся preset сам (host-паттерн `session-controller/src/agent.ts:466-473` передаёт `setup: mount(storedPreset)` на resume). Текущая resume-обёртка очереди (`src/index.ts:183-188`) setup не передаёт → сессия, у которой в `header.agentPreset` есть профиль, после resume (напр. рестарт хоста) «оживает» без смонтированного preset — тот же класс бага. Фикс: при resume сессии с `header.agentPreset` передавать `setup: (agentCtx) => ctx.agentPresets.mount(agentCtx, header.agentPreset)` (preset читать из `sessionPersistence.stat(id).header.agentPreset`). **Сам preset при этом НЕ меняется** (он закреплён на сессии, `agent-preset/locked`) — только перемонтируется.
- **В рамках:** обновление закреплённого теста `tests/unit/server/composition.test.ts:89-93`, который сейчас фиксирует создание без preset.
- **Вне рамок:** изменение порядка/блокировки/статусов очереди; смена preset у существующей сессии (нельзя, `agent-preset/locked`); `acquireScope` (не нужен для долгоживущих сессий — `mount` сам удерживает generation, `registry/src/index.ts:241-250`).

## Approach
Ключевое ограничение из research: **слот `conversation.hero.agentPreset` живёт на клиенте**, host-стороны нет API чтения слота, а watcher создаёт сессию на хосте по своей инициативе (когда модель свободна) — клиента в этом цикле нет. Поэтому preset должен приходить **из клиента на хост**.

Рекомендуемый мост: **клиент передаёт выбранный preset в хост в момент добавления промпта в очередь** (RPC `add`), хост сохраняет `agentPreset` в элементе очереди и применяет его при создании новой сессии по каноническому host-паттерну (webhook / session-controller):
1. Клиент при «Add to queue» читает текущий выбранный preset (из слота/seat-контроллера) и кладёт его в payload `add`.
2. `QueueItem` получает поле `agentPreset?: string`; RPC `add` принимает его; store его хранит.
3. Host: `agentPresets` добавляется в `inject`; в `create` (обёртка `ctx.agents.create`) перед созданием делается `resolve` + `acquireScope`, в `meta` идёт `{ cwd, agentPreset }`, а `setup` монтирует preset (`ctx.agentPresets.mount(agentCtx, preset.id)`).
4. **Preset всегда выбран:** в UI профиль в слоте `conversation.hero.agentPreset` всегда выбран (пустого состояния нет). Значит при `add` клиент **всегда** передаёт непустой `agentPreset`. Отдельного «фолбэка на пустой preset» нет. Для **старых** элементов очереди (без поля `agentPreset`, добавленных до фикса) сессия создаётся как сейчас — без preset (см. ниже).

**Решённые моменты:** preset захватывается **в момент добавления в очередь** (а не в момент выполнения) — следствие архитектуры: watcher запускается по инициативе хоста, клиента в цикле выполнения нет; чтение slot в момент выполнения без нового host-канала невозможно.

## Constraints
- Стек: Cordis-плагин host+client, Bun, `ctx.agents.create` — единственный путь создания сессий.
- `agentPreset` — опциональное поле `meta` (`dsh/packages/core/agent/src/index.ts:85`); в header попадает только если передан (`dsh/packages/core/session/src/index.ts:1049-1059`).
- Preset **нельзя** прикрепить после старта сессии: `AgentPresetRegistry.select` бросает `agent-preset/locked` (`dsh/packages/preset/agent-preset-registry/src/index.ts:323`). Значит preset обязан быть передан **в момент create**.
- Канонический host-паттерн: `resolve` → `acquireScope` → `meta:{cwd,agentPreset}` → `setup: mount` (`dsh/packages/webhook/webhook/src/session.ts:117-143`; `dsh/packages/api/session-controller/src/agent.ts:381-397,485-494`).
- Текущий `inject` хоста (`packages/dsh-global-queue/src/index.ts:18`) **не** содержит `agentPresets`.
- Тест `composition.test.ts:89-93` сейчас фиксирует создание без preset — обязан быть обновлён.
- Тесты: e2e на 0.2.0-rc.2; host-RPC workaround через вложенный `ctx.inject(['webServer'], …)`.

## Open questions
- **Механизм чтения preset клиентом:** как именно клиент `dsh-global-queue` получает выбранный preset из слота `conversation.hero.agentPreset` / `AgentPresetSeatController` (доступ к seat-контроллеру из своего scope)? — уточняется на deep-dive этапе (см. plan). Единственное технически нерешённое.

**Решено пользователем:**
- Момент захвата — **при добавлении в очередь** (RPC `add`).
- Preset **всегда** выбран (пустого состояния нет) → отдельного фолбэка на пустой preset нет.
- Старые элементы очереди (без поля `agentPreset`) — **не трогать**: создаются как сейчас (без preset).

## Changes

- 2026-10-06T21:49:30+03:00 -- v1, initial spec (draft + research)
- 2026-10-06T22:44:41+03:00 -- пользователь подтвердил: захват preset при добавлении в очередь; preset всегда выбран (нет пустого состояния, фолбэк не нужен); старые элементы очереди не трогать
- 2026-10-07T08:44:28+03:00 -- deep-dive показал resume-баг того же класса (`agents.resume` не монтирует хранящийся preset; host-паттерн session-controller передаёт `setup: mount` на resume). Пользователь подтвердил: включить resume-путь в фикс (перемонтировать `header.agentPreset` при resume, сам preset не менять). `acquireScope` в рамок не входит (не нужен для долгоживущих сессий)
