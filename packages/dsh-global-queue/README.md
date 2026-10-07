# @apkawa/dsh-global-queue

A global queue of prompts for dsh (`dsh web`): prompts posted to the queue run
one at a time, and the next prompt starts as soon as the model is globally
free — across all workspaces and sessions. The queue lives in a single file
under `$DSH_HOME`, shared by every workspace of the installation, and
survives restarts.

## Features

- **Global prompt queue** — items are kept in `$DSH_HOME/.global-queue.json`
  (atomic writes, cross-process file lock). Each item is bound to a workspace
  path and to a target session: an existing session to continue, or none for
  a new session.
- **Automatic execution** — a background watcher starts the next queued item
  as soon as every live agent is idle: a new session is created in the
  item's workspace, or the target session is continued (a live agent gets a
  followup, a persisted one is resumed).
- **"Show queue" tab** — a right-sidebar tab listing the items in queue
  order: reorder by drag-and-drop, edit the text inline, remove items, and
  open the session for items that already have one.
- **"Add to queue" composer control** — a button in the composer's right
  control area that queues the current draft for the current session or a
  new one.
- **Per-item stats** — total runtime and token count in a compact line
  (`1h 35m, 30.5M`); finished items are never auto-deleted.

## Usage

- **Show queue tab** — the tab appears in the right sidebar and opens the
  page for the on-screen session. Each row shows the item text, its status,
  and (for finished items) the compact stats line; click the text to edit it
  inline (Enter or blur saves, Escape cancels), drag a row onto another to
  reorder, and use **Remove** to delete an item. Items that have a session
  (`running`/`done`/`interrupted`) carry an **open session** link.
- **Add to queue** — the composer's right control area (next to the model
  selector) hosts an **Add to queue** button: it queues the composer's draft
  for the **current session** or a **new session**, then clears the draft.
- **In the background** — the watcher treats the model as globally free when
  every live agent is idle and then runs the first queued item. Statuses are
  `queued` → `running` → `done` (the turn completed) or `interrupted` (the
  turn ended for any other reason — aborted, blocked, error — or dsh was
  restarted mid-run). Each finished item records its total runtime and
  total tokens (for a continued session, the token delta of the run). The
  queue file survives a restart: `running` items whose session has no live
  agent are marked `interrupted` at boot. Items are never auto-deleted —
  they stay in the file until you remove them.

## Install

```
dsh plugin --profile web add github:apkawa/dsh-plugins#path:/packages/dsh-global-queue
```

The package is picked up through its cordis bundle patch
(`cordis.patch.yml`, mounted via `dsh.bundle.patch` in `package.json`) and
registers its browser half through the `dsh.client` block. The host half
needs a full `dsh web` restart, not a page reload.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `path` | `$DSH_HOME/.global-queue.json` | The queue file (a dotfile shared by all workspaces). |

## Development

See [AGENTS.md](./AGENTS.md) for project structure and
[../../AGENTS.md](../../AGENTS.md) for repo-wide principles + pitfalls.
