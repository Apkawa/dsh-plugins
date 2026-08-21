# Research notes — v2 (reasoning effort)

Полезные факты из исследования, чтобы не потерять при компакте. Дата: 2026-08-20.

## 1. Нативный ModelSelect dsh УЖЕ умеет effort

`dsh/packages/client/ui-model-selection/src/client/ModelSelect.tsx` (375 строк):

- Компонент composer model seat (`conversation.input.model`) — двухуровневое меню:
  корень = строки **Model / Effort** (+ chevron), каждая drill-in'ит в свой список.
- Trigger показывает `model name · effort` (caption tone).
- Effort-панель: уровни из `model.reasoning.efforts` (адаптер, не клиент) + строка
  «provider default», если `reasoning.defaultEffort === undefined`.
- Выбор effort → `directory.select({provider, model, reasoningEffort})` — тот же путь,
  что и смена модели. Отказ host'а → toast у composer card.
- **Вывод**: как только у hand-declared модели появятся уровни (см. §3), нативный
  seat сам предложит выбор мышления в меню модели. Кнопка из draft — быстрый доступ
  без drill-in, не замена seat'у.

## 2. Slot system: где можно повесить кнопку

`dsh/packages/client/ui-slots/src/index.ts`, `web-react/scoped-slots.tsx`:

- Каждый slot рендерится в `<div data-slot="<key>">` (отсюда «после
  data-slot='conversation.input.model'» в draft).
- **single-kind slot: один победитель на cell**; `priority` = shadowing rank,
  **меньшее значение рендерит**; регистрация на том же priority — throw.
  Reference project заменил seat целиком (priority -100) своим виджетом — это и есть
  «перегруженность»: он дублирует model list внутри.
- DOM trailing row composer'а (`ui-conversation/skeleton/InputBar.tsx`):
  `[conversation.input.right items] [model seat] [ContextMeter] [stop] [send]`.
  **Слота после model seat нет.** Ближайший доступный — `conversation.input.right`:
  list slot, owner `InputZone`, entries с опциями `{id, order, label}`. Рендерится
  вплотную слева от селектора моделей («the model select sits in its own named seat
  just left of here» — контракт в `ui-conversation/contract/slots.ts`).
- Регистрационный паттерн (как ui-model-selection, Entry 2):
  ```ts
  ctx.inject(['slots', 'modelDirectories'], (scope) => {
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id: '...', order: N, label: '...',
      inject: (sessionId) => ({ ... }),
    }, Component))
  })
  ```
- `modelDirectories` service (`ctx.modelDirectories`): `directoryFor(sessionId)` →
  `{store: SnapshotStore<ModelDirectoryState>, load(), select(ModelSelection)}`.
  State: `groups[].models[]` c `model.reasoning?: {efforts: [{id,name}], defaultEffort?}`,
  `current?: {provider, model, reasoningEffort?}`.

## 3. llm-pi-ai: как работают reasoningEfforts (host)

`dsh/packages/llm/llm-pi-ai/src/{catalog.ts,config.ts}`:

- `models[].reasoningEfforts` — dict **level → wire value** (string). Ключи из
  `THINKING_LEVELS = off/minimal/low/medium/high/xhigh/max` (escalation order).
- Не объявленные уровни пинятся `null` (не предлагаются); значение `null` допустимо
  только для `off`. Пустой dict → ошибка резолва. Нужен хотя бы один уровень ≠ off:
  «offers no level beyond "off"; declare a thinking level, or set reasoningEfforts
  to false for a non-reasoning model».
- `false` — отключить reasoning (для catalog моделей); absent — наследовать каталог
  (у hand-declared модели reasoning отсутствует).
- Ошибки резолва **fail loud при загрузке** config'а.
- `compat: {thinkingFormat, supportsReasoningEffort}` — только для
  openai-completions; model-level бьёт route-level; если не задано ни то ни другое —
  fallback на baseURL-derived detection pi-ai.
- **WithheldThinkingFormat**: `chat-template`/`qwen-chat-template` (единственные,
  которые прокидывают `chat_template_kwargs` для llama.cpp) в конфиге dsh НЕ
  объявляются. Для нашего llama.cpp endpoint вопрос wire-поведения решается
  detection pi-ai / compat-переключателем — проверить при финальном тесте.

## 4. Settings UI: секции и слоты

`dsh/packages/client/ui-settings/src/client/contract/slots.ts`:

- `settings.section` (list, root) — **одна страница настроек на entry**; опции
  `{id, order, label}`; nav rows [General, Models, Plugins]. Топ-уровневая секция =
  регистрация сюда.
- `settings.plugins.tab` → `settings.plugin.item` (keyed) — карточки ВНУТРИ accordion
  Plugins (куда упала v1-карточка; pitfall из AGENTS.md).
- `sidebar.settings` — trigger row внизу сайдбара, занята ui-settings-general.
  В draft «добавляется sidebar.settings» = имеется в виду панель настроек вообще.

## 5. Models UI (ui-settings-models) НЕ редактирует effort — намеренно

`CustomProviderCard.tsx`: «There is deliberately no reasoning-effort control, here or
on the editor card: effort is a per-MODEL capability … The composer's model picker
offers each model its own levels instead.» Модели в редакторе — opaque
`Record<string, unknown>` (id/name/contextWindow/maxTokens). **Gap dsh**: у
hand-declared моделей нет UI для `reasoningEfforts` — только ручная правка yaml.
Наша секция закрывает именно этот gap.

## 6. Reference project (examples/tmp/dsh-reasoning-effort, v0.6.2)

- Host (`src/index.ts`, inject ['settings','llm']): **read-only guidance**. Namespace
  `dsh-reasoning-effort.entries[]` = knowledge base (provider/model glob + note +
  efforts + compat). RPC `/dsh-reasoning-effort`: `diagnose(provider, model)`,
  `store`. Никогда не пишет settings — генерирует YAML-сниппет для ручного вставления.
- Client: **заменяет** seat (priority -100): slider + своя модельная строка; уровни из
  `model.reasoning.efforts` каталога; выбор → `directory.select({reasoningEffort})`.
- `knowledge.ts`: `BUILTIN_ENTRIES` (glm-5.2, kimi-k3), `matchEntry` (wildcard
  scoring: точное > `*` по каждой оси), `displayLevels`.
- **Для нас**: берём логику уровня «что выбирается из ModelDirectory + select»,
  НЕ guidance/compat/entries (draft: «кроме compat»).

## 7. Наша v1-архитектура (packages/dsh-model-settings) — переиспользуем

- Host composition root `src/index.ts`: inject ['settings']; регистрирует пустой ns
  `model-settings`; watcher `settings/updated` → autofill; RPC `/model-settings`
  (authority trusted-host): `listModels`, `fetchModels`, `applyContextWindows`.
- `SettingsStore` (`settings-io.ts`): `read()` → `{value, revision}`;
  `setRouteModels(routeId, models, expectedRevision)` — пишет **весь** models list
  path op `providers.<route>.models` c revision fencing (+1 retry на SETTINGS_CONFLICT).
- `LlmModelEntry` несёт `[key: string]: unknown` → запись списка обратно
  **сохраняет reasoningEfforts и прочие поля opaque**. Для v2 достаточно новой plan/persist
  пары для `reasoningEfforts` по той же механике (не трогая contextWindow-override).
- Client: controller = SnapshotStore + RPC calls; card = dumb render. Сейчас
  `CLIENT_ENABLED=false`. Канал `/model-settings` уже существует — новые endpoints
  добавляются в тот же handler.

## 8. pi-ai (0.82.1) — открытый вопрос

`supportsReasoningEffort` встречается в provider-data JSON и types; runtime dispatch
openai-completions ещё не прочитан (dist subdir). **Ключевой end-to-end вопрос**:
объявленные `reasoningEfforts` на openai-completions route реально шлют
`reasoning_effort` в наш llama.cpp endpoint, или нужен compat-переключатель?
Проверить при финальном тесте (ручной curl / живой запуск). Reference project писал:
для zai detection по умолчанию НЕ шлёт — нужен `supportsReasoningEffort: true`;
для openai-completions compat-блок несётся только на эти маршруты.

## 8a. END-TO-END ПУТЬ ПОДТВЕРЖДЁН — compat НЕ нужен (решает вопрос §8)

pi-ai `dist/api/openai-completions.js`:
- dispatch «OpenAI-style» (строки ~632–639): `params.reasoning_effort = model.thinkingLevelMap?.[effort] ?? effort` — **только если** `compat.supportsReasoningEffort === true`.
- `detectCompat(model)` (~1149): для НЕ-grok/zai/moonshot/together/cloudflare/nvidia/ant-ling endpoint → `supportsReasoningEffort: true`, `thinkingFormat: "openai"`. Наш llama.cpp route (`http://192.168.1.69:…`) попадает в эту ветку по умолчанию.
- dsh `catalog.ts` `resolveModelReasoning`: объявленный dict → `{reasoning: true, thinkingLevelMap: map}` (level→wire); undeclared уровни пинятся `null`; `off` без значения → absent (pi-ai шлёт ничего) — единственный «supported, send nothing».
- **Вывод**: на llama.cpp endpoint объявленные `reasoningEfforts` реально шлют `reasoning_effort` БЕЗ compat-переключателя. Draft «кроме compat» подтверждён: в v2 compat не трогаем. (Для zai/deepseek и т.п. detection другой — но это не наш кейс.)

## 8b. Client state shape (для кнопки) ПОДТВЕРЖДЁН

`dsh/packages/host/apiproxy/src/api/sessions.schema.ts`:
```ts
ModelSelection = { provider: string; model: string; reasoningEffort?: string }
ModelReasoningEffort = { id: string; name: string; description?: string }
ModelReasoning = { efforts: ModelReasoningEffort[]; defaultEffort?: string }
ModelCatalogModel = { id; name; description?; reasoning?: ModelReasoning }
ModelProviderGroup = { id; name; models: ModelCatalogModel[] }
SessionModels = { current: ModelSelection|null; routable: bool|null; groups; failures }
```
Кнопка читает `directory.store` → `state.current` (выбранный provider/model/effort) + ищет модель в `state.groups` → `model.reasoning.efforts`. Submit через `directory.select({provider, model, reasoningEffort})` — тот же путь, что ModelSelect.

## 8c. DOM order ПОДТВЕРЖДЁН (InputBar.tsx `.trailing`)

`{rightItems} [conversation.input.right] → renderSlot('conversation.input.model') → ContextMeter → stop → send`.
Т.е. `input.right` рендерится **слева** от model seat (вплотную). Слота «после» model seat нет — ближайший доступный = `input.right`. Проза контракта («just left of here») вводит в заблуждение; авторитетен render order.

## 9. Открытые решения (идут в spec)

1. Кнопка: слот `conversation.input.right` (вплотную слева от model seat; строго
   «после» слота нет). Popup menu с уровнями текущего модели + «default».
2. Секция настроек: новый топ-уровневый entry в `settings.section` (id
   `model-settings`), редактирует per-model `reasoningEfforts` hand-declared routes
   через host RPC → llm-pi-ai (revision fencing). YAML-правка продолжает работать —
   пишем в тот же section.
3. Wildcard knowledge base (`model-settings.entries`) из reference project — **не**
   в v2 (это часть guidance, которую draft отбрасывает: «кроме compat»). Отложить;
   температура/семплеры тоже позже (T2/T3).
