# v2: план реализации (reasoning-effort)

Спецификация — [spec.md](./spec.md); исследование — [research.md](./research.md).

**Формат**: каждый этап = TDD (красный тест → зелёная реализация → рефакторинг) + коммит в конце.
Этот файл — **живой журнал прогресса**: статусы обновляются по ходу реализации.

Легенда: `[ ]` не начато · `[~]` в работе · `[x]` готово.

---

## Этап 0 — Исследование + spec + план
- [x] Прочитать draft, reference project, dsh seams (ModelSelect, slots, catalog, settings)
- [x] Подтвердить end-to-end путь: `reasoningEfforts` → pi-ai `thinkingLevelMap` → dispatch; compat НЕ нужен для llama.cpp
- [x] Подтвердить client state shape (`ModelDirectoryState`, `model.reasoning.efforts`) и DOM order (`input.right` слева от model seat)
- [x] Написать spec.md (таблица решений) + plan.md
- **Коммит**: `docs(v2): spec + plan for reasoning-effort`

## Этап 1 — Host: модуль `efforts.ts` (чистый, TDD) `[x]`
Новый чистый модуль рядом с `settings-io.ts`; оркестрация не трогает dsh-seam напрямую (SOLID).
- [x] `planReasoningWrite(models, modelId, efforts)` — новый models list c обновлённым `reasoningEfforts` одной модели; opaque сохраняется; вход не мутируется; absent → `{id, reasoningEfforts}`; no-op (`changed:false`) при идентичном маппинге.
- [x] `validateEfforts(efforts)` — правила dsh: ≥1 уровень ≠ off; `null` только для `off`; пустая wire-строка запрещена. Возвращает список ошибок.
- [x] `persistReasoning(store, routeId, modelId, efforts)` — запись c revision fencing (+1 retry на `SETTINGS_CONFLICT`), та же механика что `persistModels`.
- **Тесты** (`tests/efforts.test.ts`): 20 тестов (plan/validate/persist) — зелёные. Типчек host пройден.

## Этап 2 — Host: RPC endpoints в `/model-settings` `[x]`
Добавить в существующий handler (`src/index.ts`), не создавая новый канал.
- [x] `listReasoningRows` → candidate routes' модели c текущим `reasoningEfforts`.
- [x] `setReasoningEfforts {routeId, modelId, efforts}` → валидация + `persistReasoning`; invalid → `{ok:false, code:'INVALID_EFFORTS'}`, без записи.
- **Тесты**: `makeRpcHandler` экспортирован для тестов; `tests/rpc.test.ts` (5 тестов: list/set-valid/set-invalid/missing-fields/unknown-endpoint) — зелёные. Типчек пройден.

## Этап 3 — Client: controller (endpoints + типы секции) `[x]`
Новый модуль `src/client/reasoning-controller.ts` (рядом с v1 card controller), purity бандла не нарушена.
- [x] Типы: `ReasoningRow {routeId, modelId, efforts?}`, `ReasoningSectionState {phase,error?,rows}`, `THINKING_LEVELS`, `ReasoningEfforts`, face для секции.
- [x] Actions: `loadRows()` → `listReasoningRows`; `save(routeId, modelId, efforts)` → `setReasoningEfforts` + refresh; unwrap `{ok,value|error}`.
- **Тесты**: store инжектим (type-only импорт runtime barrel → модуль грузится в node без DOM); `tests/reasoning-controller.test.ts` (4 теста: load-ready/load-error/save-refresh/save-fail-preserves) — зелёные. Клиентный типчек пройден.
- Примечание: v1 card controller не юнитится (client barrel тянет `window` при импорте в node). Здесь store инжектим → тестируем логику без jsdom/happy-dom (не вводим новые зависимости).

## Этап 4 — Client: секция настроек (`settings.section`, id `model-settings`) `[x]`
- [x] Компонент `ReasoningSection.tsx`: list candidate routes → модели → редактор (7 уровней: checkbox «offer» + wire input; off без wire).
- [x] Чистая логика в `efforts-editor.ts`: `draftsFromEfforts`/`effortsFromDrafts`/`validateEffortsClient` (зеркалит правила host); ошибка → не отправляем + показываем.
- [x] Регистрация в `settings.section` (top-level, id `model-settings`, order 15) в `client/index.ts`; slot-contract (type-only augmentation `settings.section`) добавлен.
- **Тесты**: чистая логика — `tests/efforts-editor.test.ts` (6 тестов, node). Компонент + регистрация проверяются клиентным типчеком (DOM-тест нет: jsdom/happy-dom не введены) и live-прогоном (Этап 6).

## Этап 5 — Client: кнопка в composer (`conversation.input.right`) `[x]`
- [x] Компонент `EffortButton.tsx`: читает shared directory через inject `hooks` (→ `useDirectory`, **без** useSyncExternalStore — правило client AGENTS.md §4) → текущая модель → `reasoning.efforts`; popup menu уровней (+ «Provider default» когда `defaultEffort === undefined`).
- [x] Submit через `directory.select({provider, model, reasoningEffort})` (effort:undefined → не присылаем поле); без reasoning/selection → кнопка скрыта.
- [x] Регистрация в list-slot `conversation.input.right` (session scope) через `ctx.inject(['slots','modelDirectories'])`; resolver читаем defensively (cast, guard undefined — плагин без ui-model-selection просто без кнопки). Slot-contract (type-only augmentation `conversation.input.right`).
- **Тесты**: чистая логика — `tests/effort-button.test.ts` (7 тестов: currentReasoning/effortChoices/effortLabel, node). Компонент + регистрация проверяются клиентным типчеком и live-прогоном (Этап 6); DOM-тест нет (jsdom/happy-dom не введены), как на Этапах 3–4.

## Этап 6 — Финальное тестирование (ОСТАНОВКА — нужен пользователь)
> Момент, когда требуется добавить плагин в живой профиль (`dsh plugin add`) и запустить `dsh web`. Автономно не делаем — останавливаемся и привлекаем пользователя.
- [ ] **ПАУЗА**: попросить пользователя добавить плагин в профиль + запустить.
- [ ] Live: выбрать уровень в кнопке → проверить, что запрос несёт `reasoning_effort` (curl / живой запуск).
- [ ] Live: сохранить маппинг в секции → проверить yaml `llm-pi-ai` + что dsh подхватил уровни.
- [ ] Откатить debug-логирование (если включалось), финальный коммит.
