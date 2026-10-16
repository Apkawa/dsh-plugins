# @apkawa/dsh-ghl

A read-only **Issues** pane for dsh: it opens a GitHub repo's issues in a
right-sidebar tab (list → detail). The Host serves the repo's issues over the
`/ghl` RPC channel, and the Client shows them in the sidebar.

## Features

- **"Issues" sidebar tab** — one row per issue (`#number`, title, an
  `open`/`closed` status token, label chips); clicking a row opens the detail
  view (title, `#number`, body, a **View on GitHub** link, and a **Back**
  control). The repo is the workspace's GitHub repo, resolved from its git
  `origin` remote.
- **No token required** — the plugin works unauthenticated against
  GitHub's public REST API; there is no token configuration. A local
  sliding-window budget (60 requests/hour by default) guards the host-side
  calls so the unauthenticated rate limit is not exceeded, and repeated
  lookups are served from a short TTL cache.
- **Workspace-aware repo detection** — the pane's own workspace path is used
  first, falling back to the host's registered workspaces; exactly one must
  resolve.
- **Transparent errors** — failures reach the pane as a message + code
  instead of a silent empty state. Detection codes: `no-workspace`,
  `ambiguous-workspace`, `no-remote`, `not-github`. API codes: `not-found`,
  `rate-limit`, `internal`. The pane shows the message and the code.

## Debugging

Logs are quiet by default. Run dsh with `DEBUG=1` to see the plugin's trace
output (workspace/git resolution, GitHub API calls, RPC failures); error
lines are always printed regardless of the flag.

## Development

See [AGENTS.md](./AGENTS.md) for project structure and
[../../AGENTS.md](../../AGENTS.md) for repo-wide principles + pitfalls.
`pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` from the
package directory.
