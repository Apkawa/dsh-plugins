/**
 * The ghl plugin, host face. The GitHub issue provider, its TTL/budget cache,
 * and the /ghl RPC route are composed in `apply`.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createIssueCache } from './cache.ts'
import { GitHubIssue } from './issues.ts'
import { detectRepo, gitRemoteUrl, resolveWorkspacePath } from './repo.ts'
import { mountChannel, type WebServerRegistry } from './rpc.ts'

export const name = 'ghl'

/** The host services this plugin's apply reads; declared so `ctx.<name>` resolves in `apply`. */
export const inject = ['workspaceRegistry']

/** The plugin config (empty in this stage). */
export interface Config {}

export const Config: z<Config> = z.object({})

/** The workspace registry seam (`ctx.workspaceRegistry`), as this plugin consumes it. */
interface WorkspaceRegistrySeam {
  list(): readonly { path: string }[]
}

// The dsh 0.2.0 host provides these seams on plugin contexts, but this plugin
// does not depend on the dsh packages that type them, so these structural
// mirrors carry the reads.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host web server's route registry. */
    webServer: WebServerRegistry
    /** The registered workspaces (this plugin reads `workspaceRegistry.list()`). */
    workspaceRegistry: WorkspaceRegistrySeam
  }
}

export function apply(ctx: Context): void {
  // Production boundaries: the global fetch and the git shell-out. Unit tests
  // inject their own `BaseIssue` and `getRepo`, so neither is exercised here.
  const cached = createIssueCache(new GitHubIssue(globalThis.fetch), { now: Date.now })
  const getRepo = (payload: unknown) => {
    const workspacePath = (payload as { workspacePath?: unknown } | null)?.workspacePath
    return detectRepo(gitRemoteUrl, resolveWorkspacePath(typeof workspacePath === 'string' ? workspacePath : undefined, ctx.workspaceRegistry.list()))
  }

  // Mount the /ghl RPC channel on the host web server. On dsh 0.2.0-rc.2 the
  // host's rpc-host effect registers in a context without webServer, so the
  // channel's route is mounted here. Resolve `webServer` with `ctx.inject` —
  // not the topology-sensitive `ctx.webServer` proxy nor the isolation-scoped
  // `ctx.get`, which return a placeholder the root fiber resolves — so the
  // prefix route lands on the instance that actually serves requests (a route
  // registered on the placeholder falls through to the SPA fallback as a 405).
  // One cache instance per host session keeps the rate-limit budget window
  // process-wide.
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => mountChannel({ issue: cached, getRepo }, webCtx.webServer), 'ghl: /ghl channel')
  })
}
