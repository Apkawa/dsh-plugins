# Спецификация: web-search (ddgs) — p.1–3 черновика

## Цель

Заменить текущий веб-поиск (провайдер на DeepSeek API) поиском на базе
[ddgs](https://github.com/deedy5/ddgs) (Python) — как **новый плагин**
`packages/dsh-web-search-ddgs` в этом репозитории, регистрирующий провайдер
поиска в seam `ctx.web` dsh. Инструмент `web_search` (схема, UI-карточка,
презентация) остаётся существующим — под него просто появляется новый
бэкенд.

## Что выяснилось при исследовании (кратко; детали — research.md)

1. **Яндекс — единственный работающий бэкенд на этой сети**: все остальные
   хосты ddgs (duckduckgo, brave, google, mojeek, startpage, wikipedia,
   grokipedia, yahoo) заблочены whitelist'ом; `yandex.com`/`yandex.ru` доступны.
2. **Яндекс в ddgs 9.16 существует, но выключен автором** (`disabled = True`).
   Включение тривиально: инъекция класса в реестр `ENGINES` после импорта.
   Проверено: реальные результаты. **Стабильность ограничена**: ≥2 быстрых
   запроса подряд → `No results found` (rate-limit/антибот); одиночные
   запросы с паузой работают.
3. **CLI ddgs не годится как транспорт**: `-o json` пишет файл в cwd c
   непредсказуемым именем, не stdout. → в пакете свой скрипт: ddgs + JSON на
   stdout.
4. **uvx как транспорт слишком медленный** (3.7–13 c на запуск, мерно). →
   управляемый uv-venv: одноразово `uv venv && uv pip install ddgs`, дальше
   `<venv>/bin/python ddgs-search.py` (~1–2 c). uvx остаётся запасным
   вариантом (через config).
5. **Нюанс выбора провайдера**: если зарегистрировано ≥2 пригодных
   провайдера (deepseek + ddgs), dsh требует явного выбора
   (`DSH_WEB_SEARCH_PROVIDER=ddgs` или `searchProvider: ddgs`). Сейчас deepseek
   unavailable (нет ключа) — автовыбор ddgs работает сам.
6. npm-реестр и github недостижимы → новый пакет использует только уже
   установленные в workspace зависимости (cordis 4.0.1, schemastery 3.18.1,
   typescript, vitest, tsdown). Типы web-seam объявляются локально в пакете.

## Компоненты

### 1. Пакет-плагин `packages/dsh-web-search-ddgs`

Функциональный плагин Cordis (образец — `web-search-exa` в dsh и
`dsh-model-settings` в этом репозитории):

| Поле | Значение |
| ---- | -------- |
| `name` | `web-search-ddgs` |
| `inject` | `['web']` |
| `apply(ctx, config)` | `ctx.web.registerSearchProvider(new DdgsSearchProvider(…))` |
| wiring | `cordis.patch.yml` — `insert: [{ id: web-search-ddgs, name: '@apkawa/dsh-web-search-ddgs' }]` |

**Config** (schemastery `z`, всё опционально, значения из cordis.yml):

| Поле | По умолчанию | Назначение |
| ---- | ------------ | ---------- |
| `backend` | `yandex` | бэкенд ddgs (`-b`) |
| `maxResults` | `8` | лимит источников (совпадает с `WEB_SEARCH_MAX_RESULTS` dsh) |
| `timeoutMs` | `30_000` | таймаут на один поиск (subprocess) |
| `venvDir` | `~/.cache/dsh-web-search-ddgs/venv` | каталог управляемого uv-venv |
| `ddgsVersion` | `ddgs` | pin версии для `uv pip install` |

### 2. `DdgsSearchProvider` (interface dsh `WebSearchProvider`)

- `id: 'ddgs'`
- `available()`: дешёвая локальная проверка — venv существует **или**
  `uv` доступен на PATH (первый поиск поднимет venv). Без сети.
- `search(request, signal)`:
  - **сериализация**: все поиски идут последовательно через очередь внутри
    провайдера (инструмент стреляет до 4 запросов параллельно — сериализация
    снимает rate-limit);
  - раннер: при первом поиске idempotent `uv venv <venvDir> && uv pip install
    <ddgsVersion>`, затем `<venvDir>/bin/python <pkg>/ddgs-search.py
    --query … --backend … --max-results … --timeout …`;
  - результат: JSON-массив → `WebSearchResult { sources, truncated: false,
    content: undefined }`; маппинг `{title, href, body}` → `{title, url: href,
    snippet: body}`, пустые поля пропускаются;
  - ошибки: ненулевой exit / stderr → `Error` с сообщением ddgs; timeout →
    убиваем subprocess, ошибка; `AbortSignal` → убиваем subprocess.
    **Ретраев нет** (MVP; rate-limit покрывается сериализацией).

### 3. `ddgs-search.py` (в пакете)

Одноразовый скрипт: `argparse` (`--query`, `--backend`, `--max-results`,
`--timeout`), включение выключенного движка yandex
(`ENGINES["text"]["yandex"] = Yandex`), `DDGS().text(…)`, JSON на stdout.
Exit 0 = JSON; non-zero = `DDGSException: <msg>` на stderr.

## Тесты (TDD: красный тест → реализация → коммит)

| Слой | Что покрывает |
| ---- | ------------- |
| unit (`tests/unit/server/`) | runner (fake spawn: успех, маппинг JSON, ошибки, timeout, abort, venv-setup), provider (сериализация, available, маппинг, forwarded signal), composition (`apply` регистрирует провайдер в `ctx.web`), sanity (name/apply) |
| integration/e2e | живой запуск `<venv>/bin/python ddgs-search.py` против яндекса (self-skip без uv/сети); e2e-live по образцу `dsh-model-settings` (чистый `dsh web` + `dsh plugin add`, плагиn грузится) |

## Явные пределы MVP (не делаем сейчас)

- **Ретраев и искусственных пауз нет** — rate-limit яндекса покрыт только
  сериализацией; при агрессивных сериях запросов возможны провалы.
- **Только текстовый поиск** (категория `text`): images/news/videos — нет.
- **Без API-ключа** (по условию): brave/google и т.д. не включаются.
- **Выбор провайдера** при двух пригодных провайдерах — вручную
  (env/config), плагин сам ничего не решает.
- **Типы seam декларированы локально** — если `@deepseek-ai/dsh-web`
  станет доступен в реестре, заменить на импорт.
- **Почему yandex выключен upstream — неизвестно** (github недостижим);
  учтено как риск хрупкости, заложенный в пределы выше.

## Критерии готовности

1. `pnpm build` + `pnpm typecheck` в новом пакете — чисто.
2. Unit-тесты (TDD) зелёные; e2e-live грузит плагин в живой `dsh web`.
3. Живой поиск: `web_search` через dsh с ddgs-провайдером возвращает
   цитируемые источники (проверено в e2e/integration; сеть может потребовать
   пауз — self-skip, не красный прогон).
