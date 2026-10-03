# 2026-09-30_e2e-matrix-0-2-0: e2e-матрица на 0.2.0-rc.2

**Created:** 2026-09-30T14:17:09+03:00

## Scope

В scope:
- Убрать `0.1.1-rc.2` из e2e-матрицы: `E2E_DSH_VERSIONS` в `tests-helpers/e2e/dsh.ts` станет `['0.2.0-rc.2']`; все дефолты (`launchDsh`/`resolveDshBinary` в `dsh.ts`, `--version` default в `scripts/e2e-live.ts`) переводятся на `0.2.0-rc.2`.
- Адаптировать хост-половину `dsh-model-settings` под новый settings-API dsh 0.2.0-rc.2 (redesign из 0.1.7: `SettingsForms.register` удалён, namespace выводится из entry-id + `Config`-схемы плагина, событие `settings/updated` → `settings/document-updated(ns, revision)`, импорты `settingsNamespace`/`SettingsProvider` из `@deepseek-ai/dsh-settings` больше не существуют в 0.2.0-rc.2) и поднять `peerDependencies` с `^0.1.0-rc.7` на диапазоны, покрывающие `0.2.0-rc.2` (иначе `dsh plugin add` отклоняет плагин до загрузки).
- Привести клиентский `client-store` (seed-список во `tsdown.config.ts`) и acceptance-тест к одной версии (убрать 0.1.1-ветвления).
- `dsh-web-search-ddgs`: API не изменился (`ctx.web.registerSearchProvider` на месте) — обновить types-only devDep `@deepseek-ai/dsh-web` с `0.1.1-rc.2` на `0.2.0-rc.2` и проверить e2e.
- Обновить документацию (корневой `AGENTS.md`, `CONTRIBUTING.md`, `AGENTS.md` пакетов): матрица = `0.2.0-rc.2`, убрать stale-ссылки на `.dumbspec/current/fix_0.1.2-rc1` (задача заархивирована) и устаревший «pinned to 0.1.1-rc.2».

Вне scope:
- Поддержка/тестирование старых версий dsh (0.1.1-rc.2, 0.1.2-rc.1).
- Новые фичи плагинов, исправление host-багов в самом dsh (405-ордеринг остаётся багом dsh, остаётся плагиновая обвязка).
- CI (в репозитории его нет).

## Approach

- **TDD:** сначала обновить матрицу и запустить e2e на `0.2.0-rc.2` (красные тесты фиксируют поломки), затем исправлять код плагинов до зелёного, затем рефакторинг/доки.
- **Глубина адаптации settings-API** выясняется в плановом research-этапе (поверхностный research показал, что host-половина model-settings ломается в трёх местах: `register`, событие, импорты; plus namespace-вопрос — `describe()` пропускает entries без `Config`, а у host-половины `Config` нет).
- **405-воркараунд:** старый (`ctx.inject(['connection'], …)` + `conn.rpc.handle`) на 0.2.0-rc.2 НЕ работает — `rpc-host.ts` регистрирует effect в контексте connection-entry, где `webServer` нерезолвирован (Cordis 4.0.4: `cannot get property "webServer" without inject`), маршрут канала так и не монтируется (R5). Новый workaround: прямая `webServer` prefix-роут через nested-inject паттерн хоста (`ctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register(route), …))`) с самореализацией RPC wire-контракта.
- **Коммиты:** по одному в конце каждой стадии (conventional commits, ветка `2026-09-30_e2e-matrix-0-2-0`, без push).
- **Ограничения среды:** frozen pnpm везде, кроме автопрописанных throwaway-проектов `.tmp/dsh-versions/<version>`; изолированный `DSH_HOME`; `pnpm typecheck` из директории пакета; провайзинг `0.2.0-rc.2` — ~180 s разовый.

## Constraints

- `@deepseek-ai/dsh@0.2.0-rc.2` — `latest` и `next` в npm; пакет = тонкий CLI-обёрточный `apps/cli`, все `dsh-*` пинаны на `0.2.0-rc.2`.
- Settings redesign (0.1.7-alpha.1 → в 0.2.0-rc.2): namespace = profile entry id + `Config`-схема плагина; `describe`/`mutate(ns, ops, expectedRevision)`, `SettingsConflictError` на месте; `settings.register` удалён; событие `settings/document-updated(ns, revision)`.
- Client-половина model-settings уже на новом событии `settings/document-updated` (`client/index.ts:87`) и использует `ctx.slots`/`connection`/`remote` — всё на месте в 0.2.0-rc.2.
- ~~`conn.rpc.handle(channel, handler)` — сигнатура без изменений~~ — **решено (R5):** на 0.2.0-rc.2 `rpc.handle` сломан на host-стороне (effect регистрируется в контексте без `webServer`); плагин регистрирует prefix-роут в `webServer` напрямую.
- Ready-линия `dsh web` без изменений по форме (tokenized URL + LAN-суффикс); флаги `--port`/`--no-open` те же — e2e-харнесс работает без изменений.
- ddgs: `Config`-схема плагина теперь автоматически проецируется в settings forms (namespace `web-search-ddgs`) — новый наблюдаемый эффект, не ломка.
- **Peer-dependency compatibility check (0.2.0-rc.2):** `dsh plugin add` отклоняет плагин, если `peerDependencies` несовместимы с версией dsh — model-settings пинит `^0.1.0-rc.7` на четыре `@deepseek-ai/dsh-*` пакета и отклоняется ДО загрузки кода. Исправление = bump peerDeps (escape hatch `dsh plugin --profile web allow-version … --accept-risk` не используется).
- Проверено (R4): entry `llm-pi-ai` НЕСЁТ `Config` (`providers: z.dict(profile).default({}).volatile()`), autofill `mutate('llm-pi-ai', [{op:'set', path:['providers', routeId, 'models'], …}], revision)` работает без изменений; `providers` volatile.
- **Решение (R4):** host-половина НЕ объявляет `Config`/namespace `model-settings` — v1-карта была пустой схемой (`z.object({})`), а в 0.2.0-rc.2 пустая схема не создаёт namespace (все записи бросают `has no volatile fields`); models-строки живут только в namespace `llm-pi-ai`. Импорт `settingsNamespace`/`SettingsProvider` убирается; namespace — обычный строковый id.
- **Client-слот (R4):** слот `settings.plugin.item` (`src/client/slot-contract.ts:13`) отсутствует в 0.2.0-rc.2 — актуальные settings-слоты `settings.section` и `settings.plugins.tab` (cordis-client-runner slot-catalog). Клиентская половина мигрирует слот (Stage 4).
- **Fixture-сид (R6):** `settings.yaml` в 0.2.0 читается один раз при boot (one-way импорт) и не watchится; единственный runtime-конвейер — HMR-вотчер профильного патча `$DSH_HOME/profiles/web/cordis.patch.yml`. E2E-фикстура сидит модели upsert-ом в этот файл.
- **Nested HMR-транзакция (R7):** хост шлёт `settings/document-updated` ВНУТРИ своей HMR-транзакции (settings `write` → `describe()`), а вложенные транзакции отклоняются (`HMR transactions cannot be nested`; проверка по AsyncLocalStorage — отложенный `setImmediate`/microtask не спасает). Обход на стороне плагина: раунд autofill выполняется через `executing.exit(…)` сервиса `hmr` (идиом самого hmr); персист тогда открывает собственную top-level транзакцию в очереди HMR. Upstream-заявка (emit после транзакции) — в доки Stage 6.
- **Lockfile-blocker (R8) + решение (R9):** plain `pnpm install` после bump ddgs' `dsh-web` на 0.2.0-rc.2 детерминированно падает: pnpm слияет peer-диапазоны `dsh-timeout` из 0.1.x- и 0.2.0-замыканий через `semver-range-intersect`, который сбрасывает prerelease с нижней границы → неудовлетворимый `>=0.1.1 <0.2.0-0` (в registry только prerelease-версии). Решение: единая types-база — четыре dsh-* devDeps model-settings `^0.1.0-rc.7` → `^0.2.0-rc.2` (поддержка 0.1.1 снята, 0.1.x-типы не нужны), адаптация host/client типов под 0.2.0-экспорты (`SettingsProvider`/`settingsNamespace` отсутствуют; `ClientContext` = cordis `Context`, `SnapshotStore` — generic из `dsh-client-store`) и одноразовый plain `pnpm install` для регенерации lockfile.

## Open questions

1. ~~Как host-половина должна объявить `Config` для namespace `model-settings`~~ — **решено (R4):** не объявляет; пустая схема не создаёт namespace, данные только в `llm-pi-ai`, `autoGenerate` не срабатывает (нет `Config`).
2. ~~Состоит ли entry `llm-pi-ai` с `Config`~~ — **решено (R4):** да, `providers: z.dict(profile).default({}).volatile()`; autofill жив.
3. ~~Работает ли 405-workaround на 0.2.0-rc.2~~ — **решено (R5):** старый не работает (host-баг `rpc-host.ts`); новый workaround = прямая `webServer` prefix-роут через nested-inject; e2e подтвердит (Stage 3).
4. ~~Нужен ли devDep `@deepseek-ai/dsh-settings@0.2.0-rc.2`~~ — **решено (R4):** импорты `settingsNamespace`/`SettingsProvider` убираются; при необходимости типов используются `SettingsNamespace`/`SettingsPathOp`/`SettingsConflictError` из 0.2.0-rc.2 (devDep при bump — types-only).

## Changes

- 2026-09-30T14:17:09+03:00 -- v1, initial spec (draft + research: сняты версии 0.1.1-rc.2/0.1.2-rc.1, новая версия 0.2.0-rc.2; выявлена необходимость адаптации settings-API host-половины model-settings)
- 2026-09-30T14:54:06+03:00 -- red-запуск (Stage 1): обнаружен peer-dependency compatibility check в 0.2.0-rc.2 — `dsh plugin add` отклоняет model-settings из-за `^0.1.0-rc.7` пингов; в Scope и Constraints добавлен bump peerDeps. ddgs boot на 0.2.0-rc.2 уже проходит
- 2026-10-01T10:04:53+03:00 -- Stage 5 (R8/R9): plain-install после bump ddgs' dsh-web блокирован пересечением prerelease peer-диапазонов pnpm (R8); решение — унификация devDeps-типов model-settings на `^0.2.0-rc.2` + адаптация host/client типов под 0.2.0 + одноразовая регенерация lockfile (R9)
