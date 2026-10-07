# 2026-10-05_global-queue-improvements: доработки dsh-global-queue

**Created:** 2026-10-05T12:23:59+03:00

## Scope

Шесть доработок плагина `packages/dsh-global-queue`:

1. **Стилизация кнопки «Add to queue»** (+ иконка) — по `docs/ai/ui-guideline.md` и паттерну `dsh-model-settings`.
2. **Пункт «Show queue» во вкладке «Start»** правого сайдбара (по аналогии с «Workspace files» / «New terminal»).
3. **Убрать две лишние кнопки** после «Add to queue»; цель (новая сессия / продолжение) выводится из контекста, где пишется сообщение: пишу в новой сессии (там же выбираются профиль и воркспейс) → новая сессия; пишу в уже открытой сессии → продолжить её.
4. **queued → running при отсутствии активности** — задача, добавленная в очередь, когда никто не активен, должна уходить в running.
5. **Новая сессия видна, ссылка «open session» работает** + e2e с фейковым провайдером. (Дополнение пользователя: именно новая сессия не работает, продолжение текущей — отработало. Уточнение после исполнения: сессия создаётся и видна, но её turn падает с `prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")` — сессии из очереди не подцепляется текущая модель, выбранная в композере (слот `conversation.input.model`).)
6. **Стилизация панели очереди** (вкладка «Show queue»).

Вне scope: другие плагины, локализация, поведение хоста dsh — кроме случаев, когда это требуется пунктами 3 и 5 (см. Open questions).

## Approach

**1. Кнопка «Add to queue».** CSS модуль в плагине (токены `--dsw-alias-*`); доставка — vendored `dsh-css-inline` tsdown-плагин + `lightningcss` (как в model-settings). Кнопка — компактный sm-капсул (h28 r14, 12/18) на общем атоме `Button` из `@deepseek-ai/dsh-client-ui-primitives` (platform external, общий identity) + иконка 16px (`stroke: currentColor`; каталог `ui-primitives/src/icons` или рукописный SVG).

**2. Вкладка Start.** Добавить поле `guide: [{ id: 'show-queue', order: 40, title, description?, icon? }]` в существующий вызов `sidebarRightTabs.register(...)` (`src/client/index.ts:113-117`). Поле существует в `0.2.0-rc.2` (проверено в provisioned-дереве). Default-капсула `EntryBox` достаточна; кастомная карточка не нужна.

**3. Контекст вместо меню.** Убрать dropdown; `targetSessionId` выводится из состояния текущей сессии: пишу в **новой (blank) сессии** — там, где выбираются профиль и воркспейс (кнопка там рендерится, подтверждено пользователем) → `targetSessionId = null` (новая сессия); пишу в сессии с диалогом → `targetSessionId = <текущая>`. Точный клиентский сигнал «новая сессия» в 0.2.0-rc.2 (что exposes `useSessions`/slot props: `blank`? `seq`? event count?) — deep research как стадия плана (проверять в provisioned-дереве `0.2.0-rc.2`, не в более свежем checkout).

**4. running без активности.** Root cause: RPC `add` не будит watcher (watcher просыпается только на `agent/status`, `session/event` и boot — `src/queue/watcher.ts:121-129`; при нуле агентов событий никогда не будет). Бужать watcher на мутациях хранилища (`add`, плюс `reorder`/`remove` — влияют на «next в строю», см. Open questions).

**5. Новая сессия + e2e.** Root causes: (a) сессия создаётся голым `agents.create` — не прикреплена к workspace → ungrouped + blank → отфильтрована браузером (`dsh/.../ui-workspace/.../tree.ts:26-32, 238-257`) — FIXED; (b) `item.text` не доставляется в ветках `create`/`resume` (только в `followup`) → turn не стартует → сессия blank навсегда — FIXED; (c) гонка: клиентский каталог ещё не знает сессию → `sessions.retain` бросает `unknown session` в `onClick` ссылки — FIXED (attach до delivery). Остаточный root cause: (d) сессия, созданная watcher-ом, не получает модель/deployment → turn падает с `{{model}}` в `deployment:persona-prefix` (пользовательский отчёт). Подход: ждать реального `Promise<AgentHandle>` от `create`, доставить текст через `followup`, прикрепить сессию к workspace (`attachSession`, cwd = `item.workspacePath`), передать сессии модель, выбранную в композере (слот `conversation.input.model`) — точный механизм передаётся deep research (стадия плана). E2E: фейковый провайдер в `<root>/.dsh/profiles/web/cordis.patch.yml` по паттерну `warmModel`/`upsertLlmEntry` из `tests-helpers/e2e/dsh-fixture.ts` (`llm-pi-ai`, `openai-completions`, закрытый локальный порт, `e2e-model`) — ошибка коннекта допустима; тесты утверждают, что сессия запустилась (см. Open questions про набор ассертов).

**6. Стилизация очереди.** `QueuePane` на CSS модуль: строки (hairline `border-l2`, 14/22 и 12/18), status-лейблы через state-токены (`queued`/`running`/`done`/`interrupted`), Remove — ghost sm-кнопка, edit-инпут h32 r8, темизированный скроллбар, `overflow-y: auto` + `max-height`. `data-testid`-контракт acceptance-тестов сохранить.

## Constraints

- **E2E-матрица:** только dsh `0.2.0-rc.2` (`E2E_DSH_VERSIONS`); `guide`-поле подтверждено для этой версии.
- **CSS-доставка плагина:** только через vendored `dsh-css-inline` tsdown-плагин (host-side CSS API для статических плагинов нет); без Tailwind/компонентных библиотек; `clsx` → локальный `cx`.
- **Platform externals** (value-импорты разрешены): react, react-dom, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`.
- **Токены:** только `--dsw-alias-*` + `--dsw-radius-*`/`--dsw-elevation-*` (`docs/ai/ui-guideline.md`, `dsh/docs/web-styling.md`); без literal-цветов, theme-селекторов, `:global`.
- **Настройки 0.2.0:** `<dsh_home>/profiles/web/cordis.patch.yml` — live-reconcile чоккадар-вотчером хоста; `settings.yaml` импортируется один раз при boot.
- **Жёсткие правила репо:** frozen pnpm install; `playwright install` запрещён; изолированный `DSH_HOME` (`.tmp/dsh-e2e-*`); provisioned версии в `.tmp/dsh-versions/<v>`; playwright-артефакты `.tmp/playwright/global-queue`.
- **TDD:** red → green → refactor; conventional commit в конце каждой стадии.
- **DOM-контракт:** `data-testid`-хуки acceptance-тестов (`tests/e2e/acceptance.spec.ts:15-59`) сохраняются.

## Open questions

1. **Пункт 3 — контекст «New session».** RESOLVED (пользователь): кнопка рендерится и внутри новой сессии — там же выбираются профиль и воркспейс; сигнал = новая (blank) сессия vs сессия с диалогом. Точный клиентский сигнал в 0.2.0-rc.2 — deep research как стадия плана.
2. **Пункт 5 — gap в `resume`.** RESOLVED: чинить обе ветки (`create` и `resume`).
3. **Пункт 5 — e2e-asserты.** RESOLVED: все три — (а) задача ушла в `running`; (б) сессия видна / ссылка «open session» работает; (в) ошибка коннекта → `interrupted`.
4. **Пункт 4 — какие мутации будят watcher.** RESOLVED: будит только `add`.

## Changes

- 2026-10-05T12:23:59+03:00 -- v1, initial spec (draft + research)
- 2026-10-05T12:41:12+03:00 -- пользователь уточнил пункт 3: кнопка рендерится внутри новой сессии (там выбираются профиль и воркспейс) — сигнал = новая (blank) сессия vs сессия с диалогом; решения: чинить обе ветки create+resume; e2e утверждает все три (running, сессия видна, interrupted); watcher будит только `add`
- 2026-10-06T01:40:28+03:00 -- отчёт пользователя после исполнения: сессия из очереди создаётся, но turn падает с `{{model}}` в `deployment:persona-prefix`; добавлен root cause (d) и механизм привязки модели (`agentDefaultModel.currentSelection()` при создании, как в обычных сессиях); скриншоты пропущены пользователем
