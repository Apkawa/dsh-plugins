# fix_0.1.2-rc1 — спецификация

Статус: **refined + reviewed** (draft + research). Детальные факты — в [research.md](./research.md); план — в [plan.md](./plan.md).

## Проблема

На dsh `0.1.2-rc.1` загрузка плагина `@apkawa/dsh-model-settings` падает:

```
failed to import loader entry 65fa33dc (@apkawa/dsh-model-settings): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table — not a platform seed word, not a materialized profile, and no registered package factory
```

Рабочий обход (наблюдение пользователя): удаление записей плагина из `~/.dsh/profiles/web/package.json`; если dsh всё равно не стартует — удаление `~/.dsh/profiles/web/` целиком.

## Корневая причина (факты из research.md §1–§4)

Точечный require клиентского бандла плагина `require("@deepseek-ai/dsh-client-runtime/client")` резолвится в dsh ровно тремя ветками (`dsh/packages/client/modules/src/client/system.ts:208-211`): **platform seed** → **materialized record** → **registered factory**. На 0.1.1-rc.2 ответ давала третья ветка: пакет `@deepseek-ai/dsh-client-runtime` (`packages/client/runtime`) был **parser-preloaded** (`PARSER_PRELOAD_IDS` + строка `client-runtime` в web-app patch с `immediately: true`), поэтому его фабрика уже была в `factories`.

Между 0.1.1-rc.2 и 0.1.2-rc.1:

- пакет `packages/client/runtime` **удалён целиком** (коммит `be531688f3`);
- движок store переиздан как **статический platform seed `@deepseek-ai/dsh-client-store`** (новый пакет `packages/client/store`, коммит `1b535f611c`; `createSnapshotStore` в `src/index.ts:103`);
- `PLATFORM_MODULES` обрёл seed `dsh-client-store`, `PRELOADED_CLIENT_EXTERNALS` → `[]` (`packages/client/web/src/platform.ts`);
- в 0.1.2-rc.1 **нет никакого поставщика** старого спецификатора — все три ветки miss → throw.

Сторона плагина: `tsdown.config.ts:25` external-ит мёртвый спецификатор `@deepseek-ai/dsh-client-runtime/client`; локальная копия `PLATFORM_MODULES` устарела (совпадает ни с одним из тегов, seed'а `dsh-client-store` нет); в `dsh.client` **нет поля `external`**, inject-имя `dsh-client-runtime` на новой версии молча пропускается (строки в графе нет — `system.ts:165-168`).

Работарайд работает, потому что удаление записей из `profiles/web/package.json` сбрасывает patch-слой плагина → entry `model-settings` не попадает в loader-дерево → падающий импорт фабрики не выполняется вообще (research.md §4).

## Область (подтверждена)

1. **Основное:** исправить плагин так, чтобы клиентский half загружался **на обеих версиях dsh: 0.1.1-rc.2 и 0.1.2-rc.1**, без ручного ремонта профиля.
2. **Второстепенное (по предшествующему решению пользователя, задокументировано в архивных задачах):** 405 на `POST /model-settings/*` в 0.1.2-rc.1 — host-баг apply-ordering (плагинные RPC-каналы регистрируются до активации `client-connection`), «owned by `.dumbspec/current/fix_0.1.2-rc1`» (`.dumbspec/archive/playwright_e2e_tests/plan.md:62`, `.dumbspec/archive/e2e_version_matrix/research.md`). Хост сам по себе не меняется (read-only `dsh/`); в области — **plugin-side обход** (архивное предложение: `ctx.inject(['settings','connection'])`), после чего RPC-лейн разблокируется с 0.1.1-rc.2.

## Подход (решено в Stage 1 — deep investigation, research.md §6–§9)

**Выбран механизм B: runtime dual-require с shadowed `require` в tsdown banner.**

- Source: value-import `createSnapshotStore` из `@deepseek-ai/dsh-client-store` (новый static platform seed, 0.1.2-rc.1); тип-импорты (`ClientContext`, `SnapshotStore`) остаются на старом спецификаторе — erased при сборке, d.ts дают devDependencies.
- `tsdown.config.ts`: `CLIENT_EXTERNALS` получает `@deepseek-ai/dsh-client-store` вместо мёртвого спецификатора; устаревшая локальная копия `PLATFORM_MODULES` синхронизируется с union реальных seed-списков обоих тегов.
- Banner (после `factory: (require) => {`): `require` shadowed — при miss по `@deepseek-ai/dsh-client-store` (только 0.1.1-rc.2) синхронный throw ловится, и require падает на `@deepseek-ai/dsh-client-runtime/client`, чья фабрика parser-preloaded в старой версии.
- Оправдание и rejected-варианты — research.md §9: A отклонён (`external` сам по себе строку в графе не создаёт в обеих версиях — нужен бы ещё patch-ряд + 0.1.0-era npm-бандл под новой хост-протоколом + дублирующий entry на старой); C отклонён как самый тяжёлый.

Подтверждённые факты (research.md §6): `createSnapshotStore`/`SnapshotStore` в новом пакете идентичны старому (signature/byte-identical); `ClientContext` = plain cordis `Context`; immer/zustand не становятся новым runtime-требованием плагина. Оставшиеся риски (механика shadowing в tsdown-бандле; инертность npm-peer'а `dsh-client-runtime` в новом профиле) проверяются e2e в Stage 2/3.

## Открытые вопросы — статус

| Вопрос (первичный pass) | Разрешение |
| --- | --- |
| 1. Сторона причины | **Плагин**: build-time externals указывают на удалённый пакет; dsh легитимно изменил контракт |
| 2. Что изменилось в runtime | research.md §2 (удаление пакета, seed `dsh-client-store`, пустые preloads) |
| 3. Какую версию выпускать | **Обе** (подтверждено пользователем) |
| 4. Почему чинит удаление из profile | research.md §4 (сброс patch-слоя → entry не в дереве) |
| **Новый:** какой механизм dual-version | **Решено: B (runtime dual-require)** — research.md §9 |
| **Новый:** 405 в области? | Да, plugin-side обход — по архивному решению пользователя; хост не трогаем |

## Вне области

- Изменение самого dsh (`dsh/` — read-only ссылка; host-баг 405 остаётся на стороне dsh, здесь только plugin-side обход).
- Новый функционал плагина; любые изменения вне `packages/dsh-model-settings/` (кроме задокументированных исключений: заметки в `AGENTS.md`/`docs/ai/` об e2e-пинах).

## Критерий готовности (высокосредний)

1. `pnpm build` + `pnpm typecheck` зелёные в `packages/dsh-model-settings/`.
2. E2E boot smoke зелёный на **обоих** dsh-версиях (`0.1.1-rc.2`, `0.1.2-rc.1`) с установленным плагином — без ручного ремонта профиля.
3. (Stage 4) RPC/acceptance e2e зелёные на обеих версиях; пин RPC-лейна на 0.1.1-rc.2 снят (заметки в AGENTS.md обновлены).
