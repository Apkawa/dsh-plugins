/**
 * Repo detection (host half). Derives a `RepoRef` from a git remote URL so the
 * plugin knows which GitHub repository to query. `resolveWorkspacePath`
 * resolves which workspace's git remote to read; `detectRepo` composes the
 * injected remote-URL boundary with that resolution; `gitRemoteUrl` is the
 * production boundary that shells out to `git remote get-url origin`.
 */

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { dbg } from './log.ts'
import type { RepoRef } from './issues.ts'

/**
 * The origin remote URL of the working tree rooted at `cwd` (the process CWD
 * when omitted): the only place git is invoked. A given `cwd` must carry its
 * own git root (`.git` directory or file) — git's parent search must not leak
 * an enclosing repository's remote — and a failing command (no git, no origin
 * remote) also resolves null, so detection degrades to "no repo" instead of
 * throwing.
 */
export async function gitRemoteUrl(cwd?: string): Promise<string | null> {
  if (cwd !== undefined) {
    const rooted = await stat(path.join(cwd, '.git')).then(() => true, () => false)
    if (!rooted) { dbg.debug('gitRemoteUrl: no git root', cwd); return null }
  }
  return new Promise(resolve => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd }, (error, stdout) => {
      const remote = stdout.trim()
      dbg.debug('gitRemoteUrl', { cwd: cwd ?? '(process CWD)', remote: error !== null || remote === '' ? null : remote })
      resolve(remote === '' ? null : remote)
    })
  })
}

/** Parse a GitHub remote URL into `{owner, repo}`; null for non-GitHub/malformed. */
export function parseGithubRemote(url: string): RepoRef | null {
  const scp = parseScp(url)
  if (scp) return scp
  return parseUrl(url)
}

/** The workspace whose git remote to read. */
export type WorkspaceResolution =
  | { ok: true; path: string }
  | { ok: false; code: 'no-workspace' | 'ambiguous-workspace'; message: string }

/**
 * Resolve the workspace whose git remote to read: a non-empty payload path
 * wins, else exactly one registered workspace wins; zero → no-workspace, more
 * than one → ambiguous-workspace (the message lists the paths).
 */
export function resolveWorkspacePath(payloadPath: string | undefined, workspaces: readonly { path: string }[]): WorkspaceResolution {
  if (payloadPath !== undefined && payloadPath !== '') { dbg.debug('resolveWorkspacePath: payload path wins', payloadPath); return { ok: true, path: payloadPath } }
  if (workspaces.length === 0) { dbg.debug('resolveWorkspacePath: no-workspace'); return { ok: false, code: 'no-workspace', message: 'no workspace is registered' } }
  const single = workspaces[0]?.path
  if (workspaces.length === 1 && single !== undefined) { dbg.debug('resolveWorkspacePath: single workspace wins', single); return { ok: true, path: single } }
  dbg.debug('resolveWorkspacePath: ambiguous-workspace', workspaces.map(w => w.path).join(', '))
  return { ok: false, code: 'ambiguous-workspace', message: `multiple workspaces: ${workspaces.map(w => w.path).join(', ')}` }
}

/** The outcome of a workspace-aware repo detection. */
export type DetectionResult =
  | { ok: true; repo: RepoRef }
  | { ok: false; code: 'no-workspace' | 'ambiguous-workspace' | 'no-remote' | 'not-github'; message: string }

/**
 * Derive the repo from the injected remote-URL boundary at the resolved
 * workspace: resolution failures pass through, a null URL is no-remote, a
 * non-GitHub URL is not-github.
 */
export async function detectRepo(getRemoteUrl: (cwd: string) => Promise<string | null>, resolution: WorkspaceResolution): Promise<DetectionResult> {
  if (!resolution.ok) { dbg.debug(`detectRepo: ${resolution.code}`, resolution.message); return resolution }
  const url = await getRemoteUrl(resolution.path)
  if (url === null) { dbg.debug('detectRepo: no-remote', resolution.path); return { ok: false, code: 'no-remote', message: `no git origin remote at ${resolution.path}` } }
  const repo = parseGithubRemote(url)
  if (repo === null) { dbg.debug('detectRepo: not-github', url); return { ok: false, code: 'not-github', message: `not a GitHub remote: ${url}` } }
  dbg.debug('detectRepo', `${repo.owner}/${repo.repo}`)
  return { ok: true, repo }
}

/** SCP-like form: `git@github.com:owner/repo(.git)`. */
function parseScp(url: string): RepoRef | null {
  const match = /^git@github\.com:([^/]+)\/([^/]+)/.exec(url)
  if (!match) return null
  const owner = match[1]
  const repo = match[2]
  if (owner === undefined || repo === undefined) return null
  return { owner, repo: stripGit(repo) }
}

/** URL form: `https://github.com/owner/repo(.git)` (and `ssh://git@github.com/...`). */
function parseUrl(url: string): RepoRef | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname !== 'github.com') return null
  const parts = parsed.pathname.split('/').filter(part => part !== '')
  const owner = parts[0]
  const repo = parts[1]
  if (owner === undefined || repo === undefined) return null
  return { owner, repo: stripGit(repo) }
}

/** Strip a trailing `.git` suffix. */
function stripGit(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo
}
