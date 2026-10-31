# @apkawa/dsh-attach-editor

Cordis plugin for dsh (`dsh web`): annotate a session attachment's image with
the [`@apkawa/image-editor`](../image-editor) **before the message is sent**.
Pure browser half — attachments live in the browser until send, so the host
half is only the plugin composition root.

## What it does

1. **Composer rail replacement** — the plugin registers its own attachment
   rail on the `conversation.input.attachments` seat at **priority −1**,
   shadowing the shipped `ComposerAttachments`: thumbnails, file rows with
   upload progress, remove buttons, drop overlay.
2. **Preview with "Edit image"** — clicking an image thumbnail opens a
   portal preview overlay; its header sits **above** the image and holds an
   **Edit image** button (plus Close; mask click and Escape close it — the
   overlay closes before the editor mounts so its mask cannot swallow canvas
   pointer events).
3. **"Annotate image" right-sidebar tab** — Edit opens the plugin's tab
   (`sidebarRightTabs` type, guide entry capsule on the Start page, order 45)
   through `sidebarRight.openTab`, retried until the mounted session's
   surface is adopted. The editor mounts in the tab body.
4. **Save replaces the attachment** — the exported PNG becomes a new draft
   image (`createDrafts`), is added (`addAttachments`), the edited attachment
   is removed and its draft released (`removeAttachment` +
   `releaseDraftAttachment`) — all before send. While the composer is locked
   (`submitting`/`adjudicating`) the pane shows a refusal banner and touches
   nothing.

## Install

```
pnpm --filter @apkawa/dsh-attach-editor build   # host lib/ + client bundle first
```

Then add it to a running profile — from this repo, by local path (the way the
e2e launcher does it):

```
dsh plugin --profile web add packages/dsh-attach-editor
```

or from the published repo, mirroring the other plugins:

```
dsh plugin --profile web add github:apkawa/dsh-plugins#path:/packages/dsh-attach-editor
```

The package is picked up through its cordis bundle patch (`cordis.patch.yml`,
mounted via `dsh.bundle.patch` in `package.json`) and registers its browser
half through the `dsh.client` block. The client bundle embeds
`@apkawa/image-editor` privately — no cross-plugin runtime imports. Host
changes need a full `dsh web` restart, client-only changes a page reload.

## Commands (run from this package dir)

| Command | What it runs |
| --- | --- |
| `pnpm build` | `tsc` (host → `lib/`) + `tsdown` (client bundle → `lib/client/index.js`) |
| `pnpm bundle` | `tsdown` only (client bundle) |
| `pnpm typecheck` | both tsconfigs (`tsconfig.json --noEmit`, `tsconfig.client.json`) |
| `pnpm test` | vitest unit lane (pure modules, node env, no jsdom) |
| `pnpm test:e2e` | vitest boot lane (version matrix) + playwright acceptance lane |
| `pnpm e2e:live` | manual throwaway instance (`scripts/e2e-live.ts --package dsh-attach-editor`) |

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `scratchDir` | `$DSH_HOME/attach-editor` | Reserved host scratch dir; **unused in the MVP** — attachments never leave the browser before send. |

## MVP limits

- A saved edit **appends the annotated image at the end** of the composer's
  attachment list — the conversation facade has no public in-place swap, so
  the edited attachment loses its original position. Accepted trade-off.
- The send-side image-modality refusal path is **unit-covered only**: the
  fixture model accepts image attachments, so the banner (composer locked →
  `attach-editor-blocked`) is verified against the injected
  `ConversationActions` stub, not against a live refusing model.
- `scratchDir` is declared but unused (see Configuration).
- The editor's text tool commits once via an inline input; in-place text
  editing is deferred (see [`../image-editor`](../image-editor)).

See [AGENTS.md](./AGENTS.md) for project structure and
[../../AGENTS.md](../../AGENTS.md) for repo-wide principles + pitfalls.
