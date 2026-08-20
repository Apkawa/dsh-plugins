# План реализации v1 — автоподхват контекста

Спецификация: [spec.md](./spec.md) (решения приняты, см. §2). Отложенные задачи T2–T5 — в конце.

## Гайдрайлы (AGENTS.md → Principles)

- **TDD**: каждый модуль начинается с падающего теста; без зелёных тестов этап не закрыт. Unit-тесты не ходят в сеть — только fixtures и stubs (`Fetcher`, `SettingsStore`).
- **KISS**: ≤6 модулей host-половины (таблица в spec §4.1), нет config-опций, нет новых зависимостей сверх peer, одна протокольная ветка (`openai-completions`).
- **SOLID**: оркестрация зависит от `Fetcher`/`SettingsStore`, а не от `fetch`/`ctx.settings`; T2–T5 подключаются новыми потребителями результата проба, без переписывания ядра.

## Track A. First-class `api: 'llama.cpp'` в dsh (отложено, отдельный репо)

Логический подтип из spec §3.1 становится first-class типом провайдера: декларация `api: 'llama.cpp'` в settings.yaml начинает работать нативно. **Не блокирует v1** — плагин уже распознаёт оба api-значения; при возможности декларации таргет проба становится точным автоматически.

- [ ] `dsh-llm-pi-ai/src/provider.ts`: PROTOCOLS table += `'llama.cpp': openAICompletionsApi` (wire = openai-completions, та же реализация).
- [ ] `discovery.ts`: LISTABLE_PROTOCOLS += `'llama.cpp'` (`GET /v1/models` работает для него как для openai-completions).
- [ ] `catalog.ts`: compat-проверки (`thinkingFormat`, `supportsReasoningEffort`) считают `llama.cpp` openai-completions («расширяет» семантика).
- [ ] Тесты: route с `api: 'llama.cpp'` резолвится в тот же pi-ai provider, что и `openai-completions`.

**Критерий:** в settings.yaml можно объявить `api: 'llama.cpp'`; dsh принимает конфиг; плагин пробует такие routes без эвристики.

## Этап 0. Каркас проекта + тестовая инфраструктура

- [ ] pnpm workspace: корневой `package.json` (`private`, node>=24, ESM), `pnpm-workspace.yaml`.
- [ ] Пакет `@apkawa/dsh-model-settings`: `tsconfig.json` (strict, NodeNext), `src/`, `src/client/`; peerDeps: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery` (+ devDeps того же).
- [ ] Тестовая инфраструктура: vitest, конфиг; первый тривиальный тест (sanity) — зелёный.
- [ ] Скрипты: `build` (tsc + tsdown), `test`, `typecheck`.
- [ ] Пример монтажа: `examples/deploy/cordis.yml` (строка плагина).

**Критерий:** пустой плагин (`name`, `apply(ctx) {}`) монтируется в dsh через cordis.yml без ошибок загрузки; `pnpm test` зелёный.

## Этап 1. Ядро: округление, разбор entry `/v1/models`, HTTP-листинг

TDD: тесты пишутся первыми, затем реализация.

**Тесты (red):**
- [ ] `round.ts`: таблица `21345→21000`, `120064→120000`, `8192→8000`, `1000→1000`, `999→999`; нечисловой/отрицательный → skip.
- [ ] `props.ts`: fixture entry `/v1/models` с INI preset (`ctx-size = 120000`); есть `fit-ctx` без `ctx-size` (fallback); ни то ни другое → null; пустой/отсутствующий preset → null.
- [ ] `probe.ts` со stub `Fetcher`: успех листинга → `{entries[]}`; 404 / таймаут / тело >4МБ / не-200 → `null` (skip), наружу исключений нет.

**Реализация (green):**
- [ ] `src/round.ts`, `src/props.ts` — чистые функции, без зависимостей.
- [ ] `src/probe.ts`: один GET `<baseURL>/v1/models`; Bearer из credentials; таймаут; лимит тела ≤4МБ (паттерн discovery dsh); интерфейс `Fetcher` для инъекции.

**Критерий:** все тесты зелёные; на живом llama.cpp (ручной запуск, не unit) листинг отдаёт entries с `ctx-size` в preset; на любом другом OpenAI-эндпоинте — skip.

## Этап 2. Settings: чтение route + запись contextWindow per-model

**Тесты (red), fake `SettingsStore`:**
- [ ] Тип провайдера (§3.1): route — кандидат при `api ∈ {openai-completions, llama.cpp}` + заданном `baseURL`; `api: 'llama.cpp'` = тип уже подтверждён; любой другой api / пустой `baseURL` → не кандидат.
- [ ] Чтение: из section `llm-pi-ai` берутся только hand-declared candidate routes; модели из `models[]`.
- [ ] Запись всегда `models[<id>].contextWindow = rounded`; записи модели нет → создаётся `{id, contextWindow}`.
- [ ] Существующий ненулевой `contextWindow` **не** затирается (override пользователя).
- [ ] `SettingsConflictError` → перечитать и повторить один раз; второй конфликт → ошибка наружу.

**Реализация (green):**
- [ ] `src/settings-io.ts`: обёртка над `ctx.settings` за интерфейсом `SettingsStore`; запись через `settings.mutate` с ревизионным fencing.

**Критерий:** после Apply в settings.yaml появляется `models[].contextWindow: 120000`; повторный прогон не меняет значение; ручной override плагин не затирает.

## Этап 3. Автоподхват (watcher, без прогона при старте)

**Тесты (red), fake listing + fake store:**
- [ ] Модели в `llm-pi-ai` section без `contextWindow` → batch-заполнение из листинга (ctx-size else fit-ctx → roundDown).
- [ ] Guard самоцикла: запись плагина не триггерит повторный прогон.
- [ ] Один листинг на route (не per-model запросы).
- [ ] **При старте — ноль запросов** к серверам (assert на stub `Fetcher`).

**Реализация (green):**
- [ ] `src/autofill.ts`: триггеры (watcher `llm-pi-ai` + редактирование в UI), один GET `/v1/models`, batch-запись contextWindow моделей без него, отметки самописей.

**Критерий:** добавление модели в section → через секунды `contextWindow` появляется сам (пачкой для всех новых); при старте dsh запросы не идут; цикл не возникает.

## Этап 4. Web-карточка (client-половина)

KISS: минимальная карточка, без собственных unit-тестов React — приёмка ручная.

- [ ] `src/client/`: карточка в слоте `settings.plugin.item` под ключом namespace плагина (`installSettingsSection` host + card client, паттерн cookbook adding-a-settings-card).
- [ ] UI: список моделей OpenAI-compatible routes; на модели — текущий contextWindow.
- [ ] При открытии редактирования модели с пустым `contextWindow` → автоподхват (fetch models → batch-запись) + кнопка «Fetch models» для ручного сброса (preview листинга → batch Apply).
- [ ] Билд `./client`: lazy-CJS factory артефакт (preset dsh не опубликован — воспроизвести формат); чистота бандла (без value-imports между плагинами).

**Критерий:** на странице настроец появляется карточка; fetch/apply работают; в deployment без host-половины карточки нет.

## Этап 5. Composition root + интеграция и приёмка

- [ ] `src/index.ts`: `apply(ctx)` — регистрация namespace `model-settings`, сервиса (fetchModels/applyContextWindows для client), watcher'а; модули только связываются, логики в нём нет (SOLID).
- [ ] Монтаж в реальный deployment (cordis.yml + pnpm), `dsh web`.
- [ ] E2E на живом llama.cpp: discovery моделей → автозаполнение contextWindow → проверка, что dsh использует значение (request/context в сессии).
- [ ] README пакета: монтаж, настройка, known limitations.

## Отложенные задачи (после v1)

- **Per-model `/props`-проб** — точечный на загруженной модели; нужен только если в конфиге нет ни `ctx-size`, ни `fit-ctx`. Листинг `/v1/models` уже покрывает основной случай одним запросом.
- **T2** — температура per-модель/per-алиас: `agent/request` waterfall + UI выбора значения; дефолт из `/props` (`params.temperature`).
- **T3** — top_p/top_k/min_p/presence_penalty/repeat_penalty: сначала решить, расширяем ли dsh/pi-ai (PR) — от этого зависит архитектура. Решение отложено (spec v1 §2.5).
- **T4** — modalities → `models[].input` (`vision→image`); маппинг уже готов в пробах v1.
- **T5** — reasoning effort per-модель: выбрать простейший вариант (openai-style `reasoning_effort` через profile `reasoningEfforts` + `agent/request`); `chat_template_kwargs` только после решения о PR в dsh.

## Риски

1. Написание в чужой namespace (`llm-pi-ai`) — schema-валидация dsh может отказать запись; fallback: свой namespace с копией значений + документирование (решение на этапе 2).
2. Client-bundle формат без опубликованного preset — возможны итерации под bundle-purity gate.
3. Различия версий `@deepseek-ai/dsh-*` в deployment vs devDeps плагина — фиксировать peer range.
