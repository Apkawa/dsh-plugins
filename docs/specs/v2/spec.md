# v2: настройка мышления (reasoning-effort)

Самодостаточная спецификация второй итерации плагина `dsh-model-settings`. Исходные требования — [draft.md](./draft.md); результаты исследования — [research.md](./research.md). Полный контекст проекта и отложенные задачи (T2–T5) — в [../model-settings/spec.md](../model-settings/spec.md).

## 1. Цель

Дать пользователю **выбор уровня мышления** для hand-declared моделей (llama.cpp / openai-completions routes):
1. **Кнопка в composer** со всплывающим меню выбора уровня у текущего модели.
2. **Секция настроек**, где задаётся маппинг `reasoningEfforts` по моделям (level → wire value), с сохранением в нативный section `llm-pi-ai` (работает и ручная правка yaml).

По умолчанию ничего не передаём (как сейчас): уровень не выбран → dsh шлёт запрос без `reasoning_effort`. Маппинг пишется туда, куда dsh уже умеет читать — `models[].reasoningEfforts` в `llm-pi-ai`.

## 2. Принятые решения

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Куда писать маппинг | **Прямо в `llm-pi-ai`** — `providers.<route>.models[<id>].reasoningEfforts`. Это нативный seam, который dsh уже материализует в pi-ai (`thinkingLevelMap`). Ручная правка yaml продолжает работать (пишем в тот же section). |
| 2 | Wildcard knowledge base `model-settings.entries` (из reference project) | **Не в v2.** Это часть guidance/reference-проекта (glob provider/model + note → генерация YAML-сниппета), dsh её не читает. Появится позже вместе с температурой/семплерами, когда будет смысл агрегировать несколько per-model настроек в своём namespace. См. §4 |
| 3 | `compat` (reference project) | **Не трогаем.** Подтверждено: на llama.cpp endpoint объявленные `reasoningEfforts` реально шлют `reasoning_effort` БЕЗ compat-переключателя — pi-ai автодетект даёт generic openai-completions endpoint'у `supportsReasoningEffort:true` + `thinkingFormat:"openai"`. Compat нужен только для zai/deepseek и т.п., что не наш кейс |
| 4 | Слот кнопки | **`conversation.input.right`** (list slot). Строго «после» model seat слота нет: render order `.trailing` = `[input.right] [model seat] [ContextMeter] [stop] [send]`, т.е. `input.right` рендерится вплотную **слева** от селектора моделей — ближайший доступный слот. Кнопка не заменяет нативный ModelSelect (у него уже есть effort-панель drill-in) — это быстрый доступ |
| 5 | Уровень «default» | Отдельного уровня `default` в dsh нет. В меню показываем уровни из `model.reasoning.efforts` + строку **«provider default»** (когда `defaultEffort === undefined`) = не отправлять effort. Выбрано → `directory.select({provider, model, reasoningEffort?})` |
| 6 | Секция настроек: где и что | **Новый топ-уровневый entry** в `settings.section` (id `model-settings`, label «Model Settings»). Редактирует per-model `reasoningEfforts` hand-declared routes. Не расширяем нативный Models UI (readonly dsh, у него намеренно нет effort-control) |
| 7 | Архитектура записи | Переиспользуем v1: host-модули чистые c injected `SettingsStore`, запись через RPC `/model-settings` с **revision fencing** (+retry на `SETTINGS_CONFLICT`). Новая plan/persist-пара для `reasoningEfforts` по той же механике, что `contextWindow` (не трогая contextWindow-override) |
| 8 | Наборы уровней | Ключи из dsh `THINKING_LEVELS = off/minimal/low/medium/high/xhigh/max`. Значение — произвольная wire-строка (в т.ч. числовой бюджет токенов как строка). Правила валидации dsh: ≥1 уровень ≠ off; `null` только для `off`; пустая wire-строка запрещена |

## 3. Правила v2

### 3.1 Кнопка в composer (slot `conversation.input.right`)

- Компонент регистрируется в list-slot `conversation.input.right` через
  `ctx.inject(['slots', 'modelDirectories'], …)` — тот же seam, что нативный ModelSelect.
- **Inject face**: `{ available, directory: SnapshotStore<ModelDirectoryState>, select(ModelSelection) }`.
- Кнопка читает `directory.store`: `state.current` (выбранный provider/model/effort) + ищет модель в `state.groups` → `model.reasoning.efforts` (`{id,name}[]`) + `defaultEffort?`.
- **Popup menu**: уровни текущего модели. Если у модели нет `reasoning` — показываем disabled/пустое состояние («no reasoning levels»), не ломаем composer. Строка «provider default» (не шлём effort) появляется, когда `defaultEffort === undefined`.
- **Submit**: `directory.select({ provider: current.provider, model: current.model, reasoningEffort })` — тот же путь, что ModelSelect; успех обновляет shared store, отказ → состояние ошибки в store.
- Кнопка **не заменяет** model seat (single-kind slot, один occupant) — это отдельный entry в list-slot рядом.

### 3.2 Секция настроек (`settings.section`, id `model-settings`)

- Топ-уровневая страница (рядом с General/Models/Plugins). Не в `settings.plugin.item` (это child slot → улетит в accordion Plugins, pitfall #3).
- Показывает hand-declared routes-кандидаты (`api ∈ {openai-completions, llama.cpp}` + `baseURL`) и их модели.
- Для каждой модели — редактор `reasoningEfforts`: таблица level → wire value; можно включить/выключить уровни, задать wire-значение (строка).
- **Валидация** на клиенте перед сохранением (зеркалируем правила dsh §2): ≥1 уровень ≠ off; `null` только для `off`; wire-значения не пустые. Ошибка → не отправляем.
- **Сохранение**: host RPC `setReasoningEfforts(routeId, modelId, efforts)` → пишет в `llm-pi-ai` c revision fencing. Читаем section, меняем только `reasoningEfforts` одной модели (остальные поля opaque сохраняются), пишем весь models list обратно.

### 3.3 Wire-поведение (подтверждено, не реализуем — для понимания)

- dsh материализует `reasoningEfforts` → pi-ai `{reasoning:true, thinkingLevelMap}`; undeclared уровни пинятся `null`; `off` без значения → absent («supported, send nothing»).
- pi-ai dispatch (openai-completions): шлёт `params.reasoning_effort = thinkingLevelMap[level] ?? level` только если выбран уровень и `compat.supportsReasoningEffort` (для generic llama.cpp endpoint = true по автодетекту).
- Не выбран уровень → параметр не отправляется («по умолчанию ничего не передаём»).

## 4. Явно НЕ в v2 (отложено)

- **`model-settings.entries`** wildcard knowledge base (reference project): glob provider/model + note + efforts → генерация YAML. Появится, когда в своём namespace будет несколько per-model настроек (температура, семплеры) и смысл их агрегировать.
- **Температура / самплеры** (T2/T3 draft «позже»): новые поля per-model, свой модуль-потребитель поверх той же `SettingsStore`.
- **`compat`**: не нужен для llama.cpp; добавим как отдельный переключатель, если понадобится для zai/deepseek routes.

## 5. Риски / открытые вопросы

1. **Финальный тест** (момент остановки): реальная отправка `reasoning_effort` в живой endpoint подтверждается только при добавлении плагина в профиль (`dsh plugin add`) и живом запуске. Автодетект pi-ai проверен по коду, но live-проверка обязательна.
2. **Слот кнопки**: «после» model seat не достижимо; `input.right` = вплотную слева. Если пользователь insists на строго «после» — единственный путь: занять `conversation.input.model` (single slot) и отрендерить нативный селектор + кнопку самим (подход reference project, «перегружен»). Не делаем в v2.
3. **Редукция scope секции**: редактор только для hand-declared routes c моделями; catalog-модели (у которых effort уже есть) не редактируем — у них `reasoningEfforts` наследуется каталогом.
