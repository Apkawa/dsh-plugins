# Спецификация: vision-поддержка модели (plugin `dsh-model-settings`)

Две задачи из [draft.md](./draft.md): чекбокс «модель поддерживает vision» в секции Model settings и автозаполнение этого поля из `architecture.input_modalities` при добавлении модели.

## 1. Что такое `input` (контекст dsh)

Поле `input` модели — список входных модальностей (`text`, `image` — только они существуют в dsh). Разрешение: `input` самой модели → каталог → `defaultInput` маршрута (по умолчанию `[text]`). Поле отсутствует или пустое = «не указано», dsh применяет fallback. Явная `input: [text]` — каноническая запись «модель текстовая». Мы пишем только `input` конкретной модели; route-level `defaultInput` трогать не будем.

## 2. Чекбокс vision (UI, клиент)

- В строке модели секции Model settings (рядом с полем Context window) появляется чекбокс **«Supports image input»**.
- Состояние чекбокса: выбрано ⇔ у модели в настройках `input` содержит `image`; `input` отсутствует ⇔ не выбран.
- **Отметка** → в сохранение идёт часть `input: ["text","image"]`.
- **Снятие** → в сохранение идёт часть `input: ["text"]` (явная текстовая; гарантированно текстовая даже при route-level `defaultInput: [text, image]`, и автозаполнение никогда её не перетрёт — нечётная `input` считается пользовательским решением).
- Ключ `input` никогда НЕ удаляется UI-ом: снятая галочка всегда оставляет явный `["text"]`.
- Чекбокс подчиняется той же схеме Save, что и уровни мышления / ctx: локальный draft, dirty-трекинг, кнопка Save активируется когда что-то dirty; один Save коммитит все изменённые части одним ревизионным write (текущий механизм `persistModelSave`).
- Внешняя перезагрузка строк (изменение настроек вне секции) переносит сохранённое состояние в draft, только пока чекбокс не dirty (тот же паттерн, что у аккордеона reasoning).

## 3. Автозаполнение (хост)

Тот же круг autofill, что сейчас заполняет `contextWindow` при событии `settings/updated` (секция `llm-pi-ai`) и для тех же candidate-маршрутов (openai-completions / llama.cpp + baseURL):

- Для каждой модели без явной `input` (отсутствует или пустой список): если `architecture.input_modalities` записи `/v1/models` содержит `image` → писать `input: ["text","image"]` (text всегда).
- Модель с явной `input` не трогается (пользовательское решение).
- Эндпоинт без `input_modalities` → ничего не пишется; модель остаётся на dsh-fallback. Последствие: такой маршрут, как и сейчас модель без `ctx-size`, будет прошиваться при каждом коммите — допустимая цена (те же свойства, что уже есть у ctx).
- Написанная часть `input` и `contextWindow` одной модели коммитятся **одним** write (вместе с существующим механизмом `persistModelSave`).

Self-cycle guard расширяется: маршрут пропускается, только если все его модели имеют ненулевой `contextWindow` **и** явную `input`.

## 4. RPC-контракт (`/model-settings`)

- `saveModel` принимает новую часть `input?: string[]`. Валидация: непустой массив, каждый элемент ∈ {`text`,`image`} → иначе `bad-request`. Отсутствующая часть = не тронута; «save без частей» по-прежнему `bad-request`.
- `listReasoningRows` возвращает у строки `input?: string[]` (только если в настройках это массив строк).
- `refreshContextWindow` без изменений (переписывает только ctx; vision приходит из autofill при добавлении).

## 5. Вне скоупа

- Редактирование route-level `defaultInput`.
- Поведение кнопки Refresh (ctx-only).
- Отключённая v1-карточка (`CLIENT_ENABLED = false`).
- Catalog providers (не candidate-маршруты — у них нет baseURL).

## 6. Тесты

Юнит (vitest node, без jsdom/сети):
- `props` — `entrySupportsVision`: text+image → true; только text → false; нет architecture → false; мусорные формы → false.
- `settings-io` — `planInputOverwrite`: создать запись; заменить; no-op при совпадении (порядок не важен); сестринские поля не задеты.
- `model-save` — `input`-часть в `planModelSave`/`persistModelSave` (комбинированные write; no-op).
- `autofill` — vision-заполнение из листинга; явная `input` не трогается; нет `input_modalities` → нет write; guard: маршрут без незаполненных моделей не перечитывается.
- `rpc` — `listReasoningRows` отдаёт `input`; `saveModel` с `input` (валидный/невалидный).
- Клиент: `reasoning-controller` — `save` шлёт/не шлёт `input`; `vision-input` — чистая логика draft.
- E2E (live `dsh web`, без браузера): `saveModel` с `input` roundtrips через живой хост (схема dsh валидирует) и `listReasoningRows` показывает `input`.

## 7. Доки

- README плагина: добавить vision-чекбокс и vision-автозаполнение.
- `docs/ai/key-moments.md` §2 (shape `/v1/models`) и §9 (семантика llm-pi-ai): упомянуть `architecture.input_modalities` и поле `input`.
