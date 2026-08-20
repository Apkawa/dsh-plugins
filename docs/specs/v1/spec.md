# v1: автоподхват контекста из llama.cpp `/props`

Самодостаточная спецификация первой итерации плагина `dsh-model-settings`. Полный контекст проекта и отложенные задачи (T2–T5) — в [../model-settings/spec.md](../model-settings/spec.md).

## 1. Цель

Для OpenAI-compatible route (llama.cpp) автоматически подцепить реальный размер контекста модели из **листинга `/v1/models`**: каждый entry несёт `status.preset` — INI-конфиг llama-server, откуда берём `ctx-size` (или `fit-ctx`, если `ctx-size` нет) → округлить вниз до тысяч → записать как `contextWindow` модели в settings dsh. Сейчас модель падает на дефолт 262144, потому что discovery dsh читает top-level `context_window`, а llama.cpp его не заполняет (`null`); реальный размер живёт в конфиге модели (`status.preset`). `/props?autoload=false` работает только для **загруженной** модели (unloaded → 400), поэтому listing — основной источник; один запрос отдаёт ctx-size для всех моделей route.

## 2. Принятые решения (ответы на вопросы spec)

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Имя пакета | `@apkawa/dsh-model-settings`; публикуем в npm **не будем** — только локальный workspace-пакет |
| 2 | Прогон при старте | **Нет.** Подхват: (а) watcher на добавление новых моделей в section `llm-pi-ai`; (б) при открытии редактирования модели в UI, если у неё пустой `contextWindow` — автоподхватить |
| 3 | Округление | Floor до тысяч: `roundDown(n) = floor(n / 1000) * 1000`. Подтверждено: конфиг llama.cpp `ctx=120000` возвращает `n_ctx=120064`; меньшие контексты не используем |
| 4 | Куда писать | **Всегда per-model** — `models[<id>].contextWindow` в namespace `llm-pi-ai`, путь `providers.<route>`. `defaultContextWindow` не используем. Если записи модели нет в списке — создаём `{id, contextWindow}` (у hand-declared route список `models` обязателен: без него dsh отклоняет конфиг «resolves no models») |
| 5 | PR в dsh/pi-ai для T3 | Отложено; изучим позже, как всё расширяется в парадигме dsh |
| 6 | Новый тип провайдера `llama.cpp` | Плагин моделирует его как **логический подтип** openai-compatible: на wire — та же реализация (`openAICompletionsApi`), новых протокольных веток нет. Различие декларативное: route с `api: 'llama.cpp'` — явно llama.cpp-сервер (проб `/props` точный, без эвристики); `openai-completions` — legacy-декларация (существующие конфиги; не-llama.cpp эндпоинты тихо skip'аются). dsh **не трогаем**; промоушн в first-class `api: 'llama.cpp'` в `dsh-llm-pi-ai` — отложенный Track A (plan), при возможности декларации таргет проба становится точным автоматически |

## 3. Правила v1

### 3.1 Тип провайдера и scope

Плагин вводит **тип провайдера** как логический подтип wire-протокола: базовая ветка — `openai-completions`, над ней — специализация `llama.cpp` (те же OpenAI-compatible запросы + специфичные эндпоинты llama.cpp, прежде всего `/props`). На wire ничего не меняется — тип декларативный маркер, на который ключится scope и будущие T2–T5. dsh не трогаем: распознаём `api: 'llama.cpp'` **при возможности** (если route его объявит), иначе выводим тип пробом.

Route — **кандидат llama.cpp**, если:
- `api ∈ { 'openai-completions', 'llama.cpp' }` и задан `baseURL`;
  - `'llama.cpp'` — явная декларация (новый first-class тип dsh, см. Track A); проб всё равно идёт за `n_ctx`, но тип уже подтверждён;
  - `'openai-completions'` — базовая wire-ветка, тип выводится эвристикой.

Route **подтверждается как llama.cpp**, если успешен:
- `GET <baseURL>/v1/models` → 200;
- JSON содержит `data[]` с entries, каждый со `status.preset` (INI-конфиг).

**Парсинг контекста** из `status.preset` (INI, key = value по строкам):
```
contextWindow(entry) =
  preset["ctx-size"]   если есть и > 0        # реальный размер промпт-контекста
  else preset["fit-ctx"] если есть           # пол для --fit; используем как fallback
  else unknown                                # ни ctx-size, ни fit-ctx — не выводим
```
`--ctx-size N` = явный размер контекста (default 0 = из модели); `--fit-ctx N` = минимальный ctx для `--fit` (пол), **не** реальный размер — но единственный доступный сигнал, если явного `ctx-size` нет. Top-level `context_window`/`context_length` у llama.cpp = `null`, не используем.

В scope: hand-declared routes-кандидаты с моделями из `models[]`. Модель обрабатывается, если у неё отсутствует (или равно 0) `contextWindow`; заполняется только для подтверждённого llama.cpp (есть entry в `/v1/models` с парсируемым preset). Плагин **никогда не пишет** поле `api` в settings — тип только читается/выводится.

Любой сбой (404, нет поля, таймаут, не-llama.cpp) — тихий skip + log: route остаётся незавершённым кандидатом, маршрут и сессия не ломаются.

### 3.2 Округление

```
roundDown(n) = n <= 1000 ? n : floor(n / 1000) * 1000
```

Примеры: `21345 → 21000`, `120064 → 120000`, `8192 → 8000`, `999 → 999`.

### 3.3 Auth

Ключ route (`apiKeyEnv`) резолвится через credentials seam dsh и отправляется как `Authorization: Bearer <key>`. Если ключ не задан — запрос без auth (llama.cpp локально часто работает без ключа).

### 3.4 Запись в settings

- Namespace: `llm-pi-ai`, путь: `providers.<route>.models[<id>].contextWindow = rounded`.
- Через `settings.mutate` с ревизионным fencing; при `SettingsConflictError` — перечитать и повторить один раз.
- **Не затираем** уже выставленные значения (пользовательский override имеет приоритет): заполняем только отсутствующие/нулевые `contextWindow`.

## 4. Механизмы

### 4.1 Host-половина (плагин, namespace `model-settings`)

Модули host-половины (один = одна ответственность, SOLID/S):

| Модуль | Ответственность | Зависимости |
|--------|-----------------|-------------|
| `round.ts` | округление размера контекста вниз до тысяч | нет (чистая функция) |
| `props.ts` | разбор entry `/v1/models`: INI `status.preset` → `{ctxSize?, fitCtx?}`; правило «ctx-size else fit-ctx» (§3.1) | нет (чистая функция) |
| `probe.ts` | HTTP: **один** GET `<baseURL>/v1/models` (листинг), лимит тела ≤4МБ, таймаут, Bearer, классификация ошибок → `{entries[]}` | `Fetcher` (инжект) |
| `settings-io.ts` | тип провайдера route (кандидат/подтверждён, §3.1); чтение section `llm-pi-ai`; запись `contextWindow` per-model с fencing; создание записи при отсутствии | `SettingsStore` (инжект) |
| `autofill.ts` | оркестрация: **пачкой** заполняет contextWindow моделей без него из листинга; guard самоцикла; триггеры — добавление моделей + редактирование | `probe`, `props`, `settings-io` |
| `index.ts` | composition root плагина: `apply(ctx)` — регистрация namespace, сервиса, watcher'а; ничего не считает сам | всё выше |

1. **Листинг**: `fetchModels(route) → {entries[]}` — один GET `/v1/models`, лимит тела (≤4МБ), таймаут, Bearer из credentials. Per-model `/props`-проб **отложен** (§5): листинг уже отдаёт ctx-size для всех моделей route одним запросом.
2. **Автоподхват (пачкой)**: триггеры — (а) watcher на изменения section `llm-pi-ai` (добавление моделей), (б) редактирование модели в UI. За один листинг заполняем contextWindow для **всех** моделей route без него (`ctx-size` else `fit-ctx` → roundDown). Guard самоцикла: запись плагина не триггерит повторный прогон.
3. **По запросу**: метод сервиса для client — `fetchModels(route)` → preview `{modelId, ctxSize, rounded}[]` без записи; `applyContextWindows(route, modelIds[])` → batch-запись в settings.

### 4.2 Web-карточка (client-половина)

Слот `settings.plugin.item`, ключ namespace плагина:
- список моделей OpenAI-compatible routes (из section `llm-pi-ai`);
- на модели: текущий `contextWindow`; если пустой — автоподхват при открытии редактирования + кнопка «Fetch props» (preview → Apply);
- запись в settings.yaml через `settingsScope`.

### 4.3 Тестовые юниты (TDD)

Каждый модуль покрывается тестами **до** реализации (red → green → refactor):

- `roundDown`: таблица `21345→21000`, `120064→120000`, `8192→8000`, `1000→1000`, `999→999`; нечисловой/отрицательный → skip.
- `props.ts`: fixture из draft.md (позитив); нет `n_ctx`; `n_ctx <= 0`; не-JSON; пустое тело.
- `probe.ts` (stub `Fetcher`): успех; 404; таймаут; тело >4МБ; не-200 → skip/null, а не исключение наружу.
- `settings-io.ts` (fake `SettingsStore`): запись per-model; создание записи при отсутствии id; существующий `contextWindow` **не** затирается; `SettingsConflictError` → перечитать и повторить один раз; повторный конфликт → бросить.
- `autofill.ts` (fake события + fake store): новая модель без `contextWindow` → проб; запись плагина → не триггерит повторный прогон; конкурренция ≤3; при старте — **ноль** запросов.
- Клиент: ручная приёмка по чеклисту (этап 4/5) — unit-тесты React-карточки вне v1 (KISS).

### 4.4 KISS-ограничения v1

- Никаких config-опций в namespace `model-settings` для v1: ни тумблеров, ни настраиваемой конкурренции (лимит жёстко ≤3).
- Одна wire-протокольная ветка: оба кандидата (`llama.cpp`, `openai-completions`) резолвятся в одну реализацию; новых протокольных веток нет (тип — маркер, §3.1). Другие протоколы не абстрактируем.
- Новые зависимости сверх peer (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`) — запрещены.
- `params`/`modalities` из `/props` читаются и возвращаются пробом, но **не используются** до T3/T4 (потребители добавляются отдельно, OCP).

## 5. Не входит в v1

- Per-model **`/props`-проб** (точечный, на загруженной модели) — отложен: листинг `/v1/models` уже отдаёт ctx-size для всех моделей route одним запросом; точечный проб нужен только если в конфиге нет ни `ctx-size`, ни `fit-ctx`.
- Семплеры (температура, top_p и пр.), modalities, reasoning effort — данные из `/props` (`params`, `modalities`), использование отложено: [../model-settings/spec.md §5](../model-settings/spec.md#5-отложенные-задачи).

## 6. Форма проекта

- Локальный npm-пакет `@apkawa/dsh-model-settings` (pnpm workspace, TypeScript strict, node >= 24, ESM):
  - host: `src/` — плагин с namespace `model-settings`, сервис проба, watcher;
  - client: `src/client/` — карточка; export `./client` + `dsh.client` в package.json;
  - peer/deps: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`;
  - монтаж в deployment: строка в `cordis.yml` (+ пакет в node_modules).
- Client-bundle: lazy-CJS factory артефакт (preset dsh не опубликован — формат воспроизводим сами, cookbook adding-a-settings-card «Packaging»).
