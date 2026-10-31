# dsh-attach-editor

Cordis plugin for annotating session attachments with an image editor before
the message is sent (host + client halves). The editor itself lives in
[`../image-editor`](../image-editor); this package is the dsh wiring: the
attachment rail (shadowing the shipped composer rail), the "Annotate image"
right-sidebar tab, and the attachment replacement on save. Install and MVP
limits: [README.md](./README.md).

Repo-wide rules (style, commits, TDD, sandbox): [../../AGENTS.md](../../AGENTS.md).

## Build

One command: `pnpm build` = `tsc -p tsconfig.json` → host into `lib/`, then
`tsdown` (also `pnpm bundle`) → client bundle (`lib/client/index.js`). Host
changes need a full `dsh web` restart; client-only changes need a page reload.
`pnpm typecheck` runs both tsconfigs (`tsconfig.json` with `--noEmit` and
`tsconfig.client.json`). `pnpm test` (unit) and `pnpm test:e2e` (vitest boot
lane, then the playwright acceptance lane) are separate runs.

The client bundle is a `window.__ModuleLoader__.load({ id: '@apkawa/dsh-attach-editor', factory })`
envelope (`tsdown.config.ts`, vendored from global-queue): only the dsh
platform module-table entries stay external (`react`, `react/jsx-runtime`,
`react-dom`, `react-dom/client`, `@deepseek-ai/cordis`,
`@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
`@deepseek-ai/dsh-client-ui-primitives`); everything else — including
`@apkawa/image-editor` — is bundled privately into the plugin. The css-inline
plugin auto-injects `<style data-plugin>` tags for the CSS Modules the rail,
preview overlay, and pane use (`--dsw-*` tokens only).

## Project structure

**Host half** (`src/*.ts`; composition root only):

* `index.ts` — plugin `name` (`attach-editor`), the `Config` schema
  (`scratchDir`, default `$DSH_HOME/attach-editor` via `@deepseek-ai/dsh-home-paths`,
  declared but unused in the MVP — attachments live in the browser until send),
  and `apply` returning a disposer. The replacement is entirely client-side;
  the host half stays the composition root.

**Client half** (`src/client/*`; React, no jsdom — pure logic lives in the
`.ts` file that is unit-tested):

* `index.ts` — registers the "Annotate image" tab type into
  `ctx.sidebarRightTabs` (`id: '@apkawa/dsh-attach-editor'`,
  `kind: 'attach-editor'`, guide entry `attach-editor` order 45 on the Start
  page), the body under the keyed, session-scoped `sidebar.right.pane.tab`
  seat keyed by the plugin id, and the attachment rail on the
  `conversation.input.attachments` seat at priority -1 (shadows the shipped
  `ComposerAttachments`). Seam access is structural mirrors
  (`ctx.get(...) as …`), so no `@deepseek-ai/dsh-*` package is declared as a
  dependency; the save-replace actions resolve `conversation`/`sessions` per
  save (this plugin activates before ui-conversation provides `conversation`).
* `AttachEditorPane.tsx` — the tab body, `data-testid="attach-editor-pane"`:
  idle hint (`attach-editor-idle`), registry miss (`attach-editor-missing`),
  composer refusal banner (`attach-editor-blocked`, "Cannot replace while
  sending"), and `mountImageEditor` into `attach-editor-body` for the active
  edit; save composes the replacement through `conversationReplace.ts`.
* `AttachmentsRail.tsx` + `PreviewOverlay.tsx` + `attachmentRail.ts` — the
  composer's attachment occupant: thumbnails, file rows with upload progress,
  remove buttons, drop overlay, and the preview overlay whose Edit button
  starts an edit (the overlay closes so its mask cannot swallow canvas
  pointer events).
* `attachmentRegistry.ts` — pure module: `rememberAttachment` /
  `forgetAttachment` / `lookup`; images only, a re-remember replaces the entry.
* `conversationReplace.ts` — pure save-replace composition (createDrafts →
  addAttachments → removeAttachment → releaseDraftAttachment) against an
  injected `ConversationActions` interface; refuses on a locked phase before
  creating any draft.
* `editSession.ts` — pure module: `EditSession` (`sessionId`, `attachmentId`,
  `openedAt`), `beginEdit` / `endEdit` / `activeEdit` / `subscribeEdit`, and
  `planOpenAttempt(mountedSessionId, adopted)` → `open | retry | skip` (the
  rule for opening the tab once the mounted session's surface is adopted).

**Tests**: `tests/unit/editSession.test.ts`, `tests/unit/attachmentRail.test.ts`,
`tests/unit/attachmentRegistry.test.ts`, `tests/unit/conversationReplace.test.ts`
(vitest node env, no jsdom) — `pnpm test`.

**E2E**: `tests/e2e/server/boot.test.ts` — live boot smoke over the vitest
wrapper `tests-helpers/e2e/dsh-fixture.ts` on the shared core
`tests-helpers/e2e/dsh.ts`, `describe.each(E2E_DSH_VERSIONS)`
(`0.2.0-rc.2`): the plugin is listed in the fresh `web` profile, the app
answers HTTP 200, and the child's captured stdout+stderr contains no
`did not activate` (`handle.readOutput()`).
`tests/e2e/ui/acceptance.spec.ts` + `playwright.config.ts` — the playwright
lane (helpers from `tests-helpers/e2e/live.ts` and the core launcher), three
tests over one instance: a fresh home connects a workspace through a `zenity`
shim under `.tmp/`; the Start page lists
`[data-sidebar-right-guide-entry="attach-editor"]` and picking it opens
`getByRole('tab', { name: 'Annotate image' })` with its pane; a 320x200 PNG
fixture fed through the composer's hidden file input renders a rail thumbnail,
previews with `attach-editor-edit-button` above the image, opens the tab, and
removes; the full annotate → save flow draws a rect in the tab, saves, and
asserts the rail holds exactly one (edited) thumbnail at naturalWidth 320.
Artifacts under `.tmp/playwright/attach-editor`. `pnpm test:e2e` runs both
lanes; `pnpm e2e:live` boots a throwaway instance manually. Test files import
the helpers via the `@root/tests-helpers/…` alias.

## Hard constraints

- frozen pnpm installs only — no `pnpm add`, no `--no-frozen-lockfile`
  (`pnpm_config_store_dir=./.cache/pnpm/v11 pnpm install`)
- never `playwright install` — the shared chromium build is already cached
- isolated test `DSH_HOME` only — never the real `~/.dsh`
- temp state in `.tmp/` (e2e homes, provisioned versions, artifacts)
- `dsh/` is a read-only symlink — research only, never edit
- `pnpm typecheck` from the package dir, never bare `tsc`
