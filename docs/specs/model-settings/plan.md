# План реализации: dsh-model-settings (v1 — автоподхват контекста)

> Канонический v1-план с принятыми решениями — [../v1/plan.md](../v1/plan.md). Ниже — первоначальная версия.

Спецификация: [spec.md](./spec.md). План покрывает v1; отложенные задачи (T2–T5) в конце.

## Этап 0. Каркас проекта

- [ ] pnpm workspace: корневой `package.json` (`private`, node>=24, ESM), `pnpm-workspace.yaml`.
- [ ] Пакет `@apkawa/dsh-model-settings`: `tsconfig.json` (strict, NodeNext), `src/`, `src/client/`; peerDeps: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery` (+ devDeps того же).
- [ ] Пример монтажа: `examples/deploy/cordis.yml` (строка плагина) — для проверки в реальном deployment.
- [ ] Скрипты: `build` (tsc + tsdown), `test` (vitest), `typecheck`.

**Критерий:** пустой плагин (`name`, `apply(ctx) {}`) монтируется в dsh через cordis.yml без ошибок загрузки.

## Этап 1. Ядро: props-проб и округление (чистые функции + тесты)

- [ ] `src/round.ts`: `roundDown(n)` — floor до тысяч, guard `n <= 1000` → как есть; unit-тесты (21345→21000, 120064→120000, 8192→8000, 999→999).
- [ ] `src/props.ts`: разбор ответа `/props` — валидация JSON, извлечение `default_generation_settings.n_ctx`, `params`, `modalities`; типы. Тесты на реальных fixture (пример из draft.md + негативные: нет поля, 404, не-JSON).
- [ ] `src/probe.ts`: HTTP-проб: `<baseURL>/props?model=<id>&autoload=false`, Bearer из credentials, таймаут, лимит тела ответа (паттерн discovery dsh: отклонять >4МБ), классификация ошибок (не llama.cpp → skip).

**Критерий:** `probe(route, model)` возвращает `{nCtx, rounded}` на живом llama.cpp и `null`/skip на любом другом OpenAI-эндпоинте.

## Этап 2. Settings: чтение route + запись contextWindow

- [ ] Чтение section `llm-pi-ai`: список hand-declared routes с `api: openai-completions` + `baseURL`; модели из `models[]`.
- [ ] Запись через `settings.mutate` (namespace `llm-pi-ai`, путь `providers.<route>`):
  - модель в `models[]` → `models[<id>].contextWindow = rounded`;
  - нет списка моделей → `defaultContextWindow = rounded`.
  - Ревизионное fencing: конфликт (`SettingsConflictError`) → перечитать и повторить один раз.
- [ ] Не трогать уже выставленные значения (пользовательский override имеет приоритет): заполняем только отсутствующие `contextWindow`/`defaultContextWindow` (решение по вопросу spec §6.4).

**Критерий:** после Apply в settings.yaml появляется `contextWindow: 120000` у модели; повторный прогон не меняет значение; ручной override плагин не затирает.

## Этап 3. Автоподхват

- [ ] Watcher на изменения namespace `llm-pi-ai`: новые модели без contextWindow (и route без defaultContextWindow) → очередь пробов.
- [ ] Guard самоцикла: запись плагина помечается и не триггерит повторный прогон.
- [ ] Конкурренция: очередь с лимитом параллельных запросов (например, 2–3).
- [ ] Опционально (решить по spec §6.2): pass при старте плагина по всем routes.

**Критерий:** добавление модели в `llm-pi-ai` section (через Models page discovery) → через секунды `contextWindow` появляется сам, без ручных действий; повторный цикл не возникает.

## Этап 4. Web-карточка (client-половина)

- [ ] `src/client/`: карточка в слоте `settings.plugin.item` под ключом namespace плагина (`installSettingsSection` host + card client, паттерн cookbook adding-a-settings-card).
- [ ] UI: список моделей OpenAI-compatible routes; на модель — текущий contextWindow, кнопка «Fetch props» → preview округлённого n_ctx → Apply.
- [ ] Билд `./client`: lazy-CJS factory артефакт (preset dsh не опубликован — воспроизвести формат); чистота бандла (без value-imports между плагинами).

**Критерий:** на странице настроек появляется карточка; fetch/apply работают; в deployment без host-половины карточки нет.

## Этап 5. Интеграция и приёмка

- [ ] Монтаж в реальный deployment (cordis.yml + pnpm), `dsh web`.
- [ ] E2E на живом llama.cpp: discovery моделей → автозаполнение contextWindow → проверка, что dsh использует значение (request/context в сессии).
- [ ] README пакета: монтаж, настройка, known limitations.

## Отложенные задачи (после v1)

- **T2** — температура per-модель/per-алиас: `agent/request` waterfall + UI выбора значения; дефолт из `/props` (`params.temperature`).
- **T3** — top_p/top_k/min_p/presence_penalty/repeat_penalty: сначала решить, расширяем ли dsh/pi-ai (PR) — от этого зависит архитектура.
- **T4** — modalities → `models[].input` (`vision→image`); маппинг уже готов в пробах v1.
- **T5** — reasoning effort per-модель: выбрать простейший вариант (openai-style `reasoning_effort` через profile `reasoningEfforts` + `agent/request`); `chat_template_kwargs` только после решения о PR в dsh.

## Риски

1. Написание в чужой namespace (`llm-pi-ai`) — schema-валидация dsh может отказать запись; fallback: свой namespace с копией значений + документирование (решение на этапе 2).
2. Client-bundle формат без опубликованного preset — возможны итерации под bundle-purity gate.
3. Различия версий `@deepseek-ai/dsh-*` в deployment vs devDeps плагина — фиксировать peer range.
