# 2026-10-16_utils-package: общий пакет utils с логгером

**Created:** 2026-10-16T13:44:02+03:00

## Scope

Вcluded:
- новый пакет `packages/utils` (`@apkawa/utils`) — общий код монорепо, чистый TypeScript, без зависимостей от Cordis/dsh;
- `packages/utils/src/log.ts` — класс `Log`:
  - конструктор принимает namespace: `new Log('model-settings')`;
  - синглтон на каждый ns: повторный `new Log('model-settings')` возвращает тот же экземпляр;
  - `newLog(sub)` — сублоггер: `logger.newLog('core')` → ns `model-settings/core`;
  - формат вывода: `LEVEL [ns] message`, где LEVEL — уровень заглавными (например `DEBUG [model-settings] foo`, `INFO [model-settings/core] bar`);
  - уровни: `log`, `info`, `warn`, `debug`, `error` (все пять — существующие call sites мигрируют 1:1);
  - гейтинг сохраняется: `log/info/warn/debug` молчат, если не `DEBUG=1` (точное значение), `error` всегда выводится («failures stay loud»);
- миграция `dsh-ghl`, `dsh-model-settings`, `dsh-web-search-ddgs` с копипасты `src/log.ts` на `@apkawa/utils`; удаление копий и их юнит-тестов.

Out of scope:
- `dsh-global-queue` — в нём нет логирования, мигрировать нечего;
- `ctx.logger` (платформенный логгер dsh, `dsh-model-settings/src/index.ts:298–299`) — не трогаем;
- прочие утилиты в utils, кроме `log` (добавляются по мере необходимости).

## Approach

- `packages/utils`: `type: module`, сборка `tsc -p tsconfig.json` → `lib/` (`declaration: true`), тесты vitest, без `dsh`-блока. Пакет автоматически попадает в workspace по глобу `packages/*` в `pnpm-workspace.yaml` — править workspace-файл не нужно.
- Плагины объявляют `@apkawa/utils` в `dependencies` с протоколом `workspace:*` (первая внутренняя workspace-зависимость в репо; по паттерну linked checkout из `dsh/docs/user/develop/basic/publish.md` stateless-утилиты живут в `dependencies`). В e2e плагины ставятся как `link:` (симлинк в репо), поэтому workspace-связанный `@apkawa/utils` резолвится через `node_modules` самого репо.
- В каждом из трёх плагинов: удалить `src/log.ts` и `tests/unit/server/log.test.ts`; заменить `import { dbg }` на `import { Log } from '@apkawa/utils'`; `dbg.<level>(...)` → `logger.<level>(...)`, где `const logger = new Log('<ns>')` создаётся там, где логгер используется (синглтон — повторные `new Log` безопасны).
- В `packages/utils` — собственные юнит-тесты `Log`: синглтон на ns, иерархия `newLog`, формат `LEVEL [ns] msg`, гейтинг `DEBUG=1` с негейтированным `error`.

## Constraints

- pnpm: только frozen-установки, без `pnpm add` / `--no-frozen-lockfile`; lockfile 9.0; кэш `pnpm_config_store_dir=./.cache/pnpm/v11`. Новый пакет и зависимости добавляются правкой `package.json` + `pnpm install` (обновление lockfile — штатная операция).
- Сборка: tsc (host) → `lib/`, tsdown только для client-половины (utils не нужен); без composite/references; потребление из `lib/`.
- Регистровый (npm/tarball) install плагинов в продакшене потребует опубликованного `@apkawa/utils` в `dependencies` — deployment-ограничение, за рамками задачи.
- Поведение существующего логгера — фиксированный факт: гейтинг `DEBUG=1`, `error` никогда не гейтится.
- Стиль: без `any`, без `else`, early returns, минимальные модули, TDD (фailing test → implementation → refactor).

## Open questions

- none (уровни — все пять для 1:1-миграции; гейтинг сохранён; синглтон — реестр на ns; `@apkawa/utils` в `dependencies` с `workspace:*`).

## Changes

- 2026-10-16T13:44:02+03:00 -- v1, initial spec (draft + research)
