# 2026-10-16_pnpm-catalog: вынос общих зависимостей в pnpm catalog

**Created:** 2026-10-16T16:28:25+03:00

## Scope

В рамках: перенос версий всех зависимостей, объявленных в 2+ пакетах (dependencies, peer, dev), в `catalog:` в `pnpm-workspace.yaml`; замена на `catalog:` в package.json пакетов.

Вне рамок: `@apkawa/utils` (`workspace:*`, внутренний пакет, pnpm 11 не поддерживает workspace: в каталоге); одиночные зависимости `@deepseek-ai/dsh-home-paths` (global-queue) и `@deepseek-ai/dsh-web` (ddgs) — остаются как есть.

## Approach

1. Добавить секцию `catalog:` в `pnpm-workspace.yaml` с 14 общими зависимостями (версии — существующие, конфликтов нет).
2. Заменить спецификаторы на `catalog:` в package.json всех пяти пакетов.
3. Обновить lockfile (`pnpm install` один раз после изменения манифестов), проверить, что резолвы не изменились.
4. `pnpm typecheck` + `pnpm build` на пакетах.

## Constraints

- pnpm 11.22.0; файл воркспейса — `pnpm-workspace.yaml` (не .json, как в примере запроса).
- Все 14 общих зависимостей стоят с одинаковыми спецификаторами во всех пакетах — конфликтов версий нет.
- `pnpm publish`/`pack` подменяют `catalog:` на реальные версии — peerDependencies опубликованных пакетов останутся корректными.
- Кэш pnpm: `pnpm_config_store_dir=./.cache/pnpm/v11`.

## Open questions

none

## Changes

- 2026-10-16T16:28:25+03:00 -- v1, initial spec (draft + research)
