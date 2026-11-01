# 2026-10-31_dsh-0.2.1-rc5-plugins: dsh 0.2.1-rc.5 в тестах + стабилизация плагинов

**Created:** 2026-10-31T23:06:44+03:00

## Scope

- В e2e-матрицу версий dsh (`E2E_DSH_VERSIONS`, `tests-helpers/e2e/dsh.ts:29`) добавить `0.2.1-rc.5`; все matrix-lanes (boot smoke, RPC, playwright acceptance) должны зелёными проходить на обеих версиях матрицы (`0.2.0-rc.2` + `0.2.1-rc.5`).
- Стабилизация плагинов под rc.5: `dsh-model-settings`, `dsh-global-queue`, `dsh-web-search-ddgs`, `dsh-attach-editor`, `dsh-ghl` (его root-AGENTS "Projects" список молча omission — добавляем в доки). `image-editor` без dsh-зависимостей — вне работ.
- Адаптация manifests: совместимость-гейт dsh (и в rc.2, и в rc.5) читает сырые peer-ranges; `"catalog:"` — невалидный range → отказ установки/молча disabled. Переводим peers в конкретные ranges, удовлетворяющие обе версии.
- Обновление дефолтов версии (`dsh.ts:55/:82`, `scripts/e2e-live.ts:88`) и доков (`AGENTS.md`, `CONTRIBUTING.md`, package AGENTS.md — ghl "E2E none yet" stale).

Out of scope:
- Патчи upstream dsh (баг rpc-host — апстрим; у нас workaround остаётся).
- Новые фичи плагинов; включение мёртвого v1-клиент code (`CLIENT_ENABLED`) model-settings — только если rc.5 его ломает активным кодом.

## Approach

- Матрица расширяется одной строкой в `E2E_DSH_VERSIONS`; provisioning rc.5 авто (throwaway проект `.tmp/dsh-versions/0.2.1-rc.5`).
- Empirical probes вместо догадок: статус гейта (`plugin add` exit/stderr, disabled rows), native rpc-host на rc.5 (двойной mount с нашим workaround), shadow attachment seat, HMR/config-reload wait в warmModel. Результаты probes — в research.md.
- Совместимость обеих версий через concrete ranges: `^0.2.0-rc.2` удовлетворяет 0.2.1-rc.5 (includePrerelease) — special-casing по версии в коде плагинов не нужен.
- TDD: на rc.5 lanes красные → фиксы manifests/плагинов/хелперов → зелёные на обеих версиях; rc.2 не деградировать.
- Модельный ряд: дефолты CLI/launch переезжают на `0.2.1-rc.5` как валидированный baseline; rc.2 остаётся в матрице.

## Constraints

- Frozen pnpm installs (исключение — auto-provisioned `.tmp/dsh-versions/<version>`); изолированный test `DSH_HOME`; temp в `.tmp/`; никогда `playwright install`.
- Гейт в rc.2 peers-only; `engines.dsh` решает solo только в rc.5 → `engines.dsh` не даёт cross-version fix; конкретные peer ranges чинят обе версии.
- Профильный проект плагинов: `catalog:` в package.json не раскрывается при `dsh plugin add` (link'd manifestsKeep literal) — значит peer ranges и dsh-зависимости должны быть literal в manifests.
- Точечные пины `@deepseek-ai/dsh-home-paths: 0.2.0-rc.2` (deps global-queue/attach-editor) тащат rc.2-копию рядом с rc.5 runtime — расширяем до `^0.2.0-rc.2`.
- Denied plugins не попадают в activation audit (`did not activate`) → boot-тесты зелёные при молча disabled: стабилизация требует assert активности (RPC/UI), не только audit-строк.
- Ready-URL/token→cookie контракт идентичен на rc.5 — хелперы (`READY_LINE`, `exchangeSession`) не меняем.

## Open questions

- ~~Факт двойного RPC-mount на rc.5~~ — решён probe P3: conflict'ов нет, баг `connection.rpc.handle` остаётся в rc.5, workaround stays.
- Нужен ли `e2e:live` скрипт для ghl (отсутствует при наличии playwright lane) — добавляем заодно, дёшево.

## Changes

- 2026-10-31T23:06:44+03:00 -- v1, initial spec (draft + research R1–R3)
- $(date -Isecond) -- после прогона acceptance lanes (Stage 4): scope расширен — стабилизация включает (1) version-agnostic dismissal нового rc.5 onboarding-диалога `Get started` во всех acceptance-specs; (2) адаптацию model-settings acceptance к rc.5 sidebar (нет кнопки `Settings` — секция reachable через другой nav); (3) фиксы version-independent product gaps, обнаруженные в красных lanes на rc.2: global-queue (drag opacity, Edit affordance/edit field) и ghl (`ghl-missing-repo` empty state не рендерится).
