# Spec — общая e2e-инфраструктура + документация запуска

## Задача (дольщик, дословно)

> 1) что то я не пойму как запускать такой тест, надо обновить agents и contributing
> 2) дублирование вынести на уровень выше:
> `packages/*/scripts/e2e-live.mjs` → `./scripts`,
> `packages/*/tests/e2e/dsh-fixture.ts` → `./tests-helpers/e2e/`,
> `packages/dsh-model-settings/tests/e2e/live.ts` → `./tests-helpers/e2e/`

## Итоговая структура

```
scripts/e2e-live.mjs                 # единый лаунчер vitest-пути (--package <name>)
tests-helpers/e2e/dsh-fixture.ts     # единый vitest-фючер
tests-helpers/e2e/live.ts            # единый лаунчер playwright-пути (package name)
packages/<name>/tests/e2e/…          # тесты остаются на месте пакета (импорты на общие)
packages/<name>/vitest.e2e.config.ts # без изменений
packages/dsh-model-settings/playwright.config.ts  # без изменений
```

Копии в пакетах (`scripts/e2e-live.mjs`, `tests/e2e/dsh-fixture.ts` в обоих пакетах, `tests/e2e/live.ts` в model-settings) удаляются. Перенос — `git mv` (линия истории сохраняется); устаревшая ddgs-копия лаунчера/фючера удаляется (её содержимое поглощается общим — `pluginListed` попадает в общий фючер).

## Поведение

### 1. `scripts/e2e-live.mjs`
- Обязательный аргумент `--package <name>` → `packages/<name>` (путь от корня репо по URL самого скрипта, не зависит от cwd).
- База — текущая модель-сэттингс-копия: цепочка версий `E2E_DSH_BIN` → провижн `0.1.1-rc.2` → PATH (жёсткий фейл при битом переопределении), сессия (токен → 303 → куки), корень `.tmp/dsh-e2e-*`, `--port`/`--keep`, строки `dsh binary:` / `session cookie:`.
- Проверка артефактов пакета: `lib/index.js` всегда; `lib/client.js` — только если `exports` в `package.json` пакета содержит `./client`.

### 2. `tests-helpers/e2e/dsh-fixture.ts`
- `startDsh({ packageName, port? })` → `DshHandle { url (plain), port, root, package, bin, cookie, child }`; парсятся четыре строки лаунчера (включая `dsh binary:` → `bin`).
- `pluginListed(handle)` — через `handle.bin` (не PATH-`dsh`), ожидает `@apkawa/<handle.package>` (выводится, не хардкодится).
- `rpc<T>(handle, channel, endpoint, payload)` — канал явно (model-settings передаёт `'model-settings'`); куки-заголовок как сейчас.
- `warmModel`/`writeSettings`/`findRow`/`startJsonServer`/`sleep`/`ModelRow`/`ROUTE_ID`/`MODEL_ID` — переносятся без изменений. READY_TIMEOUT 120 s.

### 3. `tests-helpers/e2e/live.ts`
- `launchPluginTestHome(packageName)`; остальное без изменений (keyless strip, `E2E_KEEP`, port 0, цепочка версий, авто-`pnpm build` при нехватке артефактов по тому же rules of exports).

### 4. Потребители
- `model-settings.test.ts`: импорт из `tests-helpers/`, `rpc(handle, 'model-settings', …)`.
- `acceptance.spec.ts`: импорт `live.ts` из `tests-helpers/`, `launchPluginTestHome('dsh-model-settings')`.
- ddgs `boot.test.ts`: `startDsh({ packageName: 'dsh-web-search-ddgs' })`, `fetch` plain-URL + куки (без куки — без заголовка).
- `e2e:live` в обоих `package.json`: `node ../../scripts/e2e-live.mjs --package <name>`.

### 5. Документация
- `CONTRIBUTING.md` — новый раздел «E2E tests»: два пути, `pnpm test:e2e` / `pnpm e2e:live` (флаги `--port`, `--keep`, `E2E_KEEP`), цепочка выбора dsh (как провижнить базовую 0.1.1-rc.2 на чистом клоне), env для ручного запуска (`pnpm_config_store_dir`), keyless для playwright-пути, артефакты в `.tmp/playwright/<package>`, строчка про известный 405 на dsh ≥ 0.1.2 (`fix_0.1.2-rc1`).
- Корневой `AGENTS.md` — короткий раздел: где лежит общая e2e-инфра, как запускать, жёсткие правила (frozen pnpm, без `playwright install`, изолированный `DSH_HOME`).
- `AGENTS.md` обоих пакетов — строки про E2E с новыми путями.

## Приёмка

- model-settings `pnpm test:e2e` зелёный: vitest 4/4 + playwright 1/1.
- ddgs `pnpm test:e2e` зелёный: boot 2/2 (live-search self-skip без `uv` — норма).
- `pnpm e2e:live` из обоих пакетов работает (строки `dsh binary:`/`session cookie:`, корень убрался).
- `pnpm typecheck` 0 в обоих пакетах.
- Файлов e2e-инфры в пакетах не осталось; переносы видны в git как rename.
- `~/.dsh` не тронут; stray-корней в `.tmp/` нет.

## Вне скопа

- playwright-путь для ddgs (отложен предыдущей задачей, п. 7 её spec).
- 405-баг host-аппли-порядка (задача `fix_0.1.2-rc1`).
- Новые зависимости, tsconfig/package.json для `tests-helpers/` (файлы транспилируются vitest/playwright, как и lane-файлы сегодня).
