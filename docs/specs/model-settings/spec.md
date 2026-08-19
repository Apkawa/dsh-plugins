# Спецификация: dsh-model-settings

Плагин для `@deepseek-harness/dsh`: подхватывает актуальные настройки моделей из OpenAI-compatible API (llama.cpp) и даёт возможность управлять ими.

## 1. Проблема

1. При получении списка моделей из llama.cpp (custom-provider, openai-compatible) dsh **не подцепляет размер контекста**, установленный на сервере: `GET /v1/models` не возвращает контекст, а реальный размер (`n_ctx`) лежит в `GET /props?model=X&autoload=false`. Модель падает на дефолт dsh — `DEFAULT_CONTEXT_WINDOW = 262144`, что неверно (в примере: `n_ctx: 120064`).
2. Нет способа выставить семплеры (температура, top-p и т.д.), размер мышления (reasoning effort) на модель/алиас: одна и та же модель в API должна работать с разной температурой для планирования и написания кода (разные алиасы).

## 2. Результаты исследования dsh (relevant seams)

### 2.1 Архитектура плагинов

- Cordis-микрокернел: каждый плагин — строка в `cordis.yml` (`id` + `name` = npm-пакет). Плагин = `name`, опциональный `Config` (schemastery/zod, редактируется через settings.yaml), `apply(ctx, config)`, опциональный `inject`.
- Внешние пакеты монтируются в deployment той же строкой cordis.yml + пакетом в node_modules (паттерн `examples/`).

### 2.2 Settings seam (`@deepseek-ai/dsh-settings`)

- `ctx.settings` — `SettingsProvider`: sections settings.yaml, per-namespace схемы, ревизионное fencing (`SettingsConflictError`), watchers на изменения namespace.
- Плагин регистрирует свой namespace через `installSettingsSection(ctx, NS, Schema, config, {validate, setSource, onChange})`.
- Browser-половина регистрирует карточку в слоте `settings.plugin.item` под своим ключом; читает/пишет через `ctx.settingsScope.bind({namespace})`. Карточка появляется на странице настроек автоматически (коokingbook: adding-a-settings-card).

### 2.3 LLM-стек (`@deepseek-ai/dsh-llm`, `dsh-llm-pi-ai`)

- Профили провайдеров — в settings namespace **`llm-pi-ai`**, путь `providers.<route>`:
  - route (hand-declared, например llama.cpp): `{api: 'openai-completions', baseURL, apiKeyEnv, models[{id, contextWindow?, maxTokens?, input?, reasoningEfforts?, compat?}], defaultContextWindow?, defaultMaxTokens?, defaultInput?}`.
  - `contextWindow` модели берётся из `models[].contextWindow`, иначе `defaultContextWindow`, иначе дефолт **262144**.
- Discovery (`GET /v1/models`, только openai-completions/openai-responses): возвращает `{id, name?, contextWindow?, maxTokens?}` — llama.cpp контекст в листинге не отдаёт. Зарегистрировать вторую discovery на тот же namespace нельзя (`DUPLICATE_DISCOVERY`) — её владеет `dsh-llm-pi-ai`.
- Per-request конфиг: waterfall **`agent/request`** — слушатель получает `{agent, turn, step, signal}` и `next(): Promise<LlmCallConfig>`, может вернуть изменённый конфиг `{provider, model, reasoningEffort?, temperature?, maxTokens?, stop?}`. Это официальный шов для per-model/per-alias значений (паттерн: `installModelSelection` в `core/agent`).
- pi-ai (`@earendil-works/pi-ai`) в `StreamOptions` поддерживает только **temperature** и **maxTokens** (+ reasoning level). `top_p/top_k/min_p/presence_penalty/repeat_penalty` в стеке dsh/pi-ai не существуют.
- Reasoning: per-model `reasoningEfforts` + route-level `thinkingBudgets`; thinking format `chat-template`/`qwen-chat-template` (единственные, которые прокидывают `chat_template_kwargs` для llama.cpp) **намеренно withheld** в конфиге dsh (`WithheldThinkingFormat`).

### 2.4 Данные llama.cpp `/props`

`GET <baseURL>/props?model=<id>&autoload=false` →

```json
{
  "default_generation_settings": {
    "params": { "temperature": 0.7, "top_p": 0.8, "top_k": 20, "min_p": 0.0,
                "presence_penalty": 1.5, "repeat_penalty": 1.0, "samplers": [...], ... },
    "n_ctx": 120064
  },
  "modalities": { "vision": false, "video": false, "audio": false },
  ...
}
```

## 3. Scope v1: автоподхват контекста (нечто, что делаем сейчас)

> Самодостаточная v1-спецификация с принятыми решениями — [../v1/spec.md](../v1/spec.md). Ниже — первоначальная версия scope; ответы на вопросы §6 зафиксированы в v1 spec.

**Цель:** при появлении моделей OpenAI-compatible route в конфиге dsh автоматически подцепить реальный `n_ctx` из `/props` и проставить его как context window модели.

### 3.1 Правила

1. **Рounding:** `n_ctx` округляется в меньшую сторону до тысяч: `roundDown(n) = floor(n / 1000) * 1000`. Примеры: `21345 → 21000`, `120064 → 120000` (≈ «120К»). Если `n <= 1000` — значение не меняется.
2. **Куда писать** (namespace `llm-pi-ai`, путь `providers.<route>`):
   - если модель есть в списке `models` route → `models[<id>].contextWindow`;
   - если у route нет списка моделей (сервер отдаёт произвольные id) → `defaultContextWindow`.
3. **Кто в scope:** hand-declared routes с `api: openai-completions`, `baseURL` задан, и `/props?model=X&autoload=false` отвечает 200 + JSON с `default_generation_settings.n_ctx > 0`. Любой сбой (404, нет поля, не-llama.cpp) — тихий skip + log; маршрут не ломается.
4. **Auth:** ключ route (`apiKeyEnv`) резолвится через credentials seam dsh и отправляется как Bearer; если ключа нет — запрос без auth.

### 3.2 Механизмы

1. **Host-сервис `modelSettings`** (внутри плагина):
   - `probeProps(route, modelId) → {nCtx, rounded, params?, modalities?}` — один GET `/props`;
   - `applyContextWindow(route, modelId)` — пишет округлённое значение в settings через `settings.mutate` (с ревизионным fencing);
   - автоподхват: watcher на изменения namespace `llm-pi-ai` — новые модели без `contextWindow` (и route без `defaultContextWindow`) автоматически пробуются и заполняются. Guard от самоцикла: запись плагина не триггерит повторный прогон (отметка/очередь).
2. **Web-карточка** (`settings.plugin.item`, ключ namespace плагина):
   - список моделей по OpenAI-compatible routes (из `llm-pi-ai` section);
   - кнопка «Fetch props» на модель: preview округлённого `n_ctx` + текущее значение в конфиге;
   - Apply — запись в settings.yaml.

### 3.3 Не входит в v1 (см. §5)

Семплеры, modalities, reasoning effort — только их **данные** из `/props` уже читаются пробом (`params`, `modalities`), использование отложено.

## 4. Форма проекта

- Внешний npm-пакет `@apkawa/dsh-model-settings` (workspace, pnpm):
  - TypeScript strict, node >= 24, ESM;
  - host-половина: `src/` (плагин: namespace `model-settings`, сервис, watcher);
  - client-половина: `src/client/` (карточка), export `./client` + `dsh.client` в package.json;
  - peer/deps: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`;
  - монтаж в deployment: строка в `cordis.yml` (+ пакет в node_modules).
- Билд client-bundle: lazy-CJS factory артефакт (preset tsdown из dsh не опубликован — формат воспроизводим сами, см. cookbook adding-a-settings-card «Packaging»).

## 5. Отложенные задачи (разбиты, раскапываем отдельно)

| # | Задача | Шов dsh | Блокеры/примечания |
|---|--------|---------|--------------------|
| T2 | Температура per-модель/per-алиас: выбор значения (по умолчанию из `/props`), применение к запросам | waterfall `agent/request` → `LlmCallConfig.temperature` → pi-ai | Алиасы = отдельные id в `models[]` route. Только temperature реально прокидывается стеком |
| T3 | Остальные семплеры: top_p, top_k, min_p, presence_penalty, repeat_penalty | — | **Нет шва**: pi-ai не поддерживает эти поля в `StreamOptions`. Варианты: PR в dsh/pi-ai (расширить StreamOptions + adapter) или прокси. Решается отдельно |
| T4 | Modalities из `/props` → `models[].input` | settings `llm-pi-ai` | dsh поддерживает только `text`/`image`; маппинг `vision→image`, audio/video игнорируются (нет шва) |
| T5 | Reasoning effort per-модель/per-алиас: выбор из off/low/medium/high/xhigh/max (+ числовой бюджет токенов размышления) | `reasoningEfforts` + `thinkingBudgets` в профиле; `agent/request` → `reasoningEffort` | Для llama.cpp нужен `chat_template_kwargs {enable_thinking, reasoning_effort}` — формат `chat-template` withheld в dsh; либо PR в dsh, либо ограничиться openai-style `reasoning_effort`. «Сделаем как можно проще и в последнюю очередь» |

## 6. Вопросы

1. **Имя пакета/namespace:** `@apkawa/dsh-model-settings` + namespace `model-settings` — ок? Или нейтральное имя (без scope apkawa)?
Ответ - dsh-model-settings, я в npm не буду публиковать. хотя... можно в packages можно и с `@apkawa/`, а то плагинов уже кучу наплодили, могут и пересекаться
2. **Автоподхват при старте:** кроме watcher на изменения, делаем ли мы прогон по всем routes при загрузке плагина (первый запуск — все модели без contextWindow заполняются разом)? Рискуем N запросами к серверу при старте; лимит/конкурренция?
Ответ - я думаю, при нажатии на редактировании модели в списке можем подхватить если пусто. а так при добавлении новых делаем подхват.
3. **Округление до тысяч** — универсально? Для n_ctx = 8192 получим 8000 (потеря 4% контекста). Вариант: округлять до «красивых» степеней (8K/16K/32K/64K/128K) или оставить floor-до-тысяч?
Ответ - Думаю да, я просто в конфиге llama.cpp использовал ctx=120000, а вернуло почему то 120064, а с меньшими контекстами dsh нет смысла использовать.

4. **defaultContextWindow vs per-model:** если у route один модельный id — пишем сразу в `models[].contextWindow` (даже если список пуст, создаём запись)? Или только `defaultContextWindow`, пока пользователь не заведёт модели явно?
Ответ - по моделям

5. **T3 (top_p и пр.):** готовы ли мы в перспективе подать PR в dsh/pi-ai, чтобы расширить `StreamOptions`? От этого зависит архитектура T2/T3 (плагин vs форк).

Хз, отложим пока, надо потом изучить как все можно расширять в парадигме dsh - все плагины.
