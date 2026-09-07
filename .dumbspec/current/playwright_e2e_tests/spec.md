# playwright_e2e_tests — спецификация

Исходный ввод — [draft.md](./draft.md); контекст — [research.md](./research.md).

## Цель

Автоматизированное приёмочное тестирование плагинов: e2e-тест, который добавляет плагин в тестовый `DSH_HOME`, открывает тестовый инстанс dsh и проверяет работоспособность при помощи Playwright.

## Scope

**Входит:**
- Playwright-e2e инфраструктура приёмки плагинов, переиспользуемая для плагинов репозитория (первая цель — `dsh-model-settings`):
  - изолированный тестовый `DSH_HOME` (temp-корень, env `DSH_HOME`/`DSH_AGENTS_HOME`);
  - добавление плагина в тестовый профиль;
  - запуск тестового инстанса `dsh web` и ожидание готовности (tokenized URL);
  - браузерная (headless Chromium) проверка: клиентская часть плагина загружается и работает в GUI, без console/page-ошибок.
  - возможность выбора версии dsh под тестом (env-переменная, выбирает бинарник); базовая версия — **0.1.1-rc.2**.
- Подключение теста к скриптам пакета/репозитория (`pnpm test:e2e`).

**Не входит** (отдельная задача `fix_0.1.2-rc1`): диагностика и фикс ошибки `failed to import loader entry … missed the module table`.

## Ключевые факты research (подробности — в research.md)

- **Образец** (`calculator.test.ts`) — plain `@playwright/test` + `webServer` против Vite-SPA: dsh и `DSH_HOME` там нет; переиспользуемы стиль теста (role-based локейторы, `trackConsoleErrors`-хелпер, поля конфига: `workers: 1`, trace/screenshot on failure, timeouts).
- **В этом репозитории уже есть browserless live e2e** (`packages/dsh-model-settings/tests/e2e-live.ts` + `e2e-live-utils.ts`, тот же паттерн в `dsh-web-search-ddgs`): temp-корень, env `DSH_HOME`/`DSH_AGENTS_HOME`, spawn глобального `dsh` (PATH, 0.1.2-rc.1), ready-строка `/dsh web: http…/`, seeding `<root>/.dsh/settings.yaml`, RPC-проверки. Это ближайший существующий паттерн — его расширяем, а не дублируем.
- **Механика `DSH_HOME`:** env `DSH_HOME` (default `~/.dsh`); профиль — `<home>/profiles/<name>`; установка плагина — `dsh plugin --profile <name> add <local-path>` (pnpm-форвардер в каталоге профиля; `reconcilePlugins` добавляет в `dsh.profile.bundles` зависимости с `dsh.bundle.patch`).
- **Клиентская половина плагина должна быть собранной заранее** (`pnpm build` → `lib/client.js`); живой сервер грузит собранный бандл; манифест `dsh.client` → строка module table браузера (`window.__DSH_BOOT__`), отдача на `/plugins/<id>/client.js`.
- **Ready-строка `dsh web` — токенизированный URL** `http://127.0.0.1:<port>/?token=…` (GET → 303 + cookie); `--no-open` гасит браузерный handoff; `--port 0` = эфемерный порт (именно так делают свои тесты dsh — без конфликта портов).
- **Прецедент браузерных e2e у dsh:** `apps/web/tests/*.e2e.ts` — vitest + plain `playwright` (`chromium.launch({headless:true})`), playwright 1.61.1; CLI-spawning-вариант — `apps/cli/tests/web-auth.e2e.ts` с очищенным env.
- **Сэндбокс без сети для установки браузеров:** браузеры уже стоят в общем `~/.cache/ms-playwright` (chromium-1234 + headless shell, firefox, webkit); env-переменные для переиспользования (`XDG_CACHE_HOME`, `PLAYWRIGHT_BROWSERS_PATH`, …) задокументированы в `~/.agents/docs/playwright-cli-sandbox.md`.
- **Ограничения среды:** Node >=24, pnpm-workspace (`pnpm_config_store_dir=./.cache/pnpm/v11`), temp-файлы в `./.tmp`, кэши в `./.cache`, checkout `dsh/` — read-only, в репозитории сейчас нет никакого playwright-зависимости.
- **Версии dsh (заявление пользователя):** текущее состояние плагинов работает в **dsh 0.1.1-rc.2**; глобальный dsh на PATH = 0.1.2-rc.1 — на этой версии клиент плагина ломается (`missed the module table`, отдельная задача `fix_0.1.2-rc1`). Поэтому e2e не может по умолчанию spawn'ить `dsh` с PATH — бинарник версии должен выбираться явно (provisioned 0.1.1-rc.2).

## Подход (рабочая гипотеза, уточнить на review)

- Расширить существующие launcher-утилиты e2e-live (temp-корень, env, spawn, ready-строка) — они уже дают изолированный `DSH_HOME` и живой инстанс; добавить в них шаг добавления плагина в профиль (или отдельный helper).
- Браузерный слой — headless Chromium: либо plain `playwright` внутри vitest (прецедент dsh + существующая e2e в репозитории), либо `@playwright/test` в стиле образца (конфиг с `webServer`) — решается на review.
- Ассерты: страница загружается по tokenized-URL, клиентский слот/секция плагина рендерится, нет console/page-ошибок; глубина взаимодействия — решение на review.

## Решения review

1. **Тестовый раннер:** `@playwright/test` (стиль образца `calculator.test.ts`); дш-инстанс поднимается тестом через существующие launcher-утилиты e2e-live, без `webServer`-блока в конфиге.
2. **API-ключ:** keyless обязателен — тест ходит без `DEEPSEEK_API_KEY`; ассерты только на то, что UI рендерит без моделей. (Что именно рендерится — эмпирический факт, фиксируется spike-стадией плана.)
3. **Глубина ассертов:** минимальный смоук — страница открывается по tokenized-URL, клиентский слот/секция плагина рендерится, 0 console/page-ошибок.
4. **Охват:** сначала `dsh-model-settings`; `dsh-web-search-ddgs` — опциональная стадия, если дёшево.
5. **Эмпирические вопросы** (локальное `pnpm add <local-path>` офлайн во fresh-профиле; переиспользование браузеров из `~/.cache/ms-playwright` без network-установки) — проверяются spike-стадией плана (Stage 1), факты фиксируются в `research.md`.
6. **Многоверсионность dsh:** launcher выбирает бинарник dsh через env-переменную (напр. `E2E_DSH_BIN`); дефолт — provisioned **0.1.1-rc.2** (известно-рабочая база); 0.1.2-rc.1 пока не поддерживается приёмкой (плагин на ней сломан — задача `fix_0.1.2-rc1`).
