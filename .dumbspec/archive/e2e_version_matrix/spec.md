# Spec — e2e_version_matrix

## Цель

Убрать дублирование e2e-инфраструктуры и сделать версию dsh первым классом:
один универсальный лаунчер-ядро, хелпер провижнинга версии по параметру,
матрица версий в тестах (`describe.each`), явная версия в фикстуре, алиас
`@root/tests-helpers/…` вместо глубоких относительных импортов.

## Требования (из draft, по пунктам)

### T1. Хелпер создания dsh заданной версии

- `ensureDshVersion(version: string): Promise<string>` в общем ядре
  (`tests-helpers/e2e/dsh.ts`):
  - если `.tmp/dsh-versions/<version>/node_modules/.bin/dsh` существует — вернуть путь;
  - иначе создать одноразовый проект `.tmp/dsh-versions/<version>/`
    (`package.json`: `private`, dep `@deepseek-ai/dsh: <version>`,
    `pnpm.onlyBuiltDependencies` — тот же список, что в текущем базлайне
    `0.1.1-rc.2`) и выполнить `pnpm install` c `CI=true` и
    `pnpm_config_store_dir=<repo>/.cache/pnpm/v11`; ненулевой exit — hard fail.
- Конкурентная защита: атомарный lock-дир
  `.tmp/dsh-versions/<version>/.provision-lock` (mkdir) + цикл ожидания со
  stale-timeout; два параллельных витест-воркера не должны гониться в один
  каталог.
- CLI получает флаг `--version <v>` (по умолчанию `0.1.1-rc.2`).

### T2. Матрица версий в тестах

- Константа в ядре: `E2E_DSH_VERSIONS = ['0.1.1-rc.2', '0.1.2-rc.1']`
  (альфа `0.1.3-alpha.2` не включена).
- `describe.each(E2E_DSH_VERSIONS)` с собственными `beforeAll`/`afterAll`
  на итерацию (внутри файла итерации идут последовательно).
- **Область применения (резолюция 405):**
  - ddgs `boot.test.ts` — полная матрица (boot + `pluginListed` + HTTP 200;
    без RPC, зелёно на обеих версиях).
  - model-settings RPC-свит — **закреплён за `0.1.1-rc.2`** (документированный
    405 на `0.1.2-rc.1`; владение — `fix_0.1.2-rc1`). Комментарий в тесте
    указывает на причину; константа матрицы позволяет позже расширить свит
    без перепроектирования.
  - playwright-приёмка model-settings — закреплена за `0.1.1-rc.2`, пока
    спайк не подтвердит, что на `0.1.2-rc.1` empty-state UI рендерится
    без console-ошибок (405 RPC на загрузке может попасть в
    `trackConsoleErrors`).
  - В lane model-settings добавляется маленький boot-смак
    (`pluginListed` + HTTP 200, без RPC) на **полной матрице** — чтобы
    «версия входит в e2e» было видно и в этом пакете.
- Порты: ядро всегда стартует `web --port 0` и читает реальный порт из
  ready-URL в `DshHandle.port` (текущий `E2E_PORT = 3091` убирается).
  Ручной CLI сохраняет `--port` (default 3081).

### T3. Версия в фикстуре, env остаётся

- `startDsh({ packageName, version?, port? })` — явная версия в параметре.
- `launchPluginTestHome(packageName, version?)` — аналогично.
- Цепочка разрешения бинаря:
  `E2E_DSH_BIN` (обязателен к существованию, hard fail — **оставлен**) →
  `ensureDshVersion(version ?? '0.1.1-rc.2')`.
  Старый PATH-fallback на `dsh` **убирается** (автоматический провижнинг
  делает его бессмысленным; тихий fallback на неизвестную PATH-версию ломает
  смысл матрицы).

### T4. Алиас импортов `@root/tests-helpers/…`

- Импорт в тестах: `@root/tests-helpers/e2e/dsh-fixture.ts` вместо
  `../../../../../tests-helpers/e2e/dsh-fixture.ts` (и короче для
  `tests/e2e/` — четыре `../` вместо пяти).
- **vitest**: `resolve.alias: { '@root/tests-helpers': <repo>/tests-helpers }`
  в `vitest.e2e.config.ts` каждого пакета (Vite prefix-match).
- **playwright 1.62.1**: опции `alias` нет, но ESM-лоадер читает
  tsconfig `paths` → в `tsconfig.json` пакета добавить
  `baseUrl: "."` и `"paths": { "@root/tests-helpers/*": ["../../tests-helpers/*"] }`.
  `pnpm typecheck` не затрагивается (tests исключены из tsconfig).
- Точная форма паттерна и работа лоадера подтверждаются спайком на закреплённом
  `@playwright/test@1.62.1`.

### T5. Один универсальный лаунчер вместо двух

- **Ядро** `tests-helpers/e2e/dsh.ts` (TS, erasable-only):
  - `launchDsh({ packageName, port?, keyless?, version? }): Promise<DshHandle>` —
    temp root (`.tmp/dsh-e2e-*`), env (`DSH_HOME`/`DSH_AGENTS_HOME`,
    `DSH_TELEMETRY_DISABLED`, store dir; `keyless` — strip ключей, как сейчас
    в playwright-lane), ensureBuilt (артефакты из exports map),
    `dsh plugin --profile web add`, spawn `web --port <port|0> --no-open`,
    ожидание ready-URL, обмен токена на cookie для 0.1.2+,
    `DshHandle { url (plain), port, root, package, bin, cookie, child, version }`.
  - `stopDsh(handle): Promise<{ code: number | null; rootRemoved: boolean }>` —
    SIGTERM дочернему процессу, ожидание exit, удаление root
    (уважает `E2E_KEEP=1`).
  - `resolveDshBinary(version?)`, `ensureDshVersion(version)`,
    `E2E_DSH_VERSIONS`.
  - Без импортов `@playwright/test` (ddgs-пакет не имеет этой зависимости).
- **CLI** `scripts/e2e-live.mjs` → `scripts/e2e-live.ts` (Node 24 native TS,
  спайк подтверждён): тонкая обёртка над ядром; печатает прежние строки
  (`dsh binary:`, `dsh e2e instance:`, `session cookie:`, `temp root:`, `pid:`),
  флаги `--package <name>` (required), `--port <n>` (default 3081), `--keep`,
  `--version <v>` (default `0.1.1-rc.2`). Скрипты `e2e:live` в обоих пакетах:
  `node ../../scripts/e2e-live.ts --package <name>`.
- **vitest-фикстура** `tests-helpers/e2e/dsh-fixture.ts` — тонкая обёртка:
  `startDsh` вызывает `launchDsh` (без спавна CLI и парсинга stdout),
  доменные хелперы (`rpc`, `warmModel`, `pluginListed`, `writeSettings`,
  `findRow`, `startJsonServer`, `sleep`, `ModelRow`, `ROUTE_ID`, `MODEL_ID`)
  остаются на месте.
- **playwright-lane** `tests-helpers/e2e/live.ts` — тонкая обёртка:
  `launchPluginTestHome` вызывает `launchDsh({ keyless: true, port: 0, version? })`,
  `trackConsoleErrors` остаётся.
- `stopDsh` теперь смотрит на exit code **dsh-детского** процесса (не CLI-обёртки);
  спайк проверяет, что `dsh web` завершается кодом 0 по SIGTERM — иначе
  ассерт в afterAll строится только на `rootRemoved`.

## Неприкосаемые ограничения (сохраняются)

- frozen pnpm-инсталлы в репо (провижнинг версий — отдельный одноразовый
  проект, не трогает lockfile репо);
- never `playwright install`;
- изолированный `DSH_HOME` в `.tmp/dsh-e2e-*`, реальный `~/.dsh` не трогать;
- temp в `.tmp/`, кэши в `.cache/`;
- `E2E_DSH_BIN` set-but-missing → hard fail с явной ошибкой;
- стиль: no `any`, no star/aliased imports, node: prefix, без `else`,
  Conventional Commits, no `--amend`, no push.

## Зафиксированные решения

1. Матрица: `['0.1.1-rc.2', '0.1.2-rc.1']`; env-override для набора версий
   не вводится (KISS — константа в ядре, расширение одной строкой).
2. PATH-fallback из цепочки разрешения — **убран** (решение T3).
3. Порт `0` во всех test-lanes (решение T2); CLI-порт 3081 для ручного
   запуска сохраняется.
4. model-settings RPC и playwright-приёмка закреплены за `0.1.1-rc.2`
   до приземления `fix_0.1.2-rc1`; полный coverage версий в этом пакете
   обеспечивает новый boot-смак на полной матрице.
5. Алиас — префикс `@root/tests-helpers` (не весь `@root`), в точности по
   примеру из draft; два механизма (vitest alias + tsconfig paths) —
   единственный без новой зависимости.

## Вне scope

- фикс 405 (владение `fix_0.1.2-rc1`);
- автоматическое добавление новых версий в матрицу;
- CI/демо-инфраструктура;
- переписывание unit-тестов и логоики плагинов.

## Критерии приёмки

1. ddgs `pnpm test:e2e` — boot-матрица 2×2 итерации (по 2 теста на версию)
   зелёные; live-search — pass или self-skip.
2. model-settings `pnpm test:e2e` — RPC-свит 4/4 на `0.1.1-rc.2`,
   boot-смак на обеих версиях, playwright-приёмка 1/1.
3. `pnpm e2e:live` из обоих пакетов: те же строки лога, SIGTERM → удаление
   root; `pnpm e2e:live --version 0.1.2-rc.1` стартует на 0.1.2-rc.1
   (session-cookie строка — cookie, а не `none`).
4. `pnpm typecheck` 0 в обоих пакетах.
5. Импорты `@root/tests-helpers/…` работают в vitest и playwright;
   глубокие относительные e2e-импорты в тестах отсутствуют.
6. Файлов `scripts/e2e-live.mjs`, дублирующей plumbing-копии в
   `dsh-fixture.ts`/`live.ts` нет: ядро одно (`tests-helpers/e2e/dsh.ts`).
7. `ensureDshVersion` на чистой машине: первый запуск матрицы сам
   провижнит `0.1.2-rc.1` в `.tmp/dsh-versions/0.1.2-rc.1/`.
8. Нет чужих `.tmp/dsh-e2e-*`, `~/.dsh` не тронут, lockfile репо не менялся.
