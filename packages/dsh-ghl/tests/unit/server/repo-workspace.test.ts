import { describe, expect, it } from 'vitest'
import { detectRepo, resolveWorkspacePath } from '../../../src/repo.ts'

const WORKSPACE = '/ws'

const wsOk = { ok: true, path: WORKSPACE }
const noWorkspace = { ok: false, code: 'no-workspace', message: 'no workspace is registered' }
const ambiguous = { ok: false, code: 'ambiguous-workspace', message: 'multiple workspaces: /a, /b' }

describe('resolveWorkspacePath', () => {
  it('lets a non-empty payload path win over the workspaces', () => {
    expect(resolveWorkspacePath('/payload', [{ path: WORKSPACE }, { path: '/b' }])).toEqual({
      ok: true,
      path: '/payload',
    })
  })

  it('falls back to the single registered workspace', () => {
    expect(resolveWorkspacePath(undefined, [{ path: WORKSPACE }])).toEqual({ ok: true, path: WORKSPACE })
  })

  it('reports no-workspace with a message when nothing is registered', () => {
    const result = resolveWorkspacePath(undefined, [])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('no-workspace')
    expect(result.message).not.toBe('')
  })

  it('reports ambiguous-workspace listing both paths', () => {
    const result = resolveWorkspacePath(undefined, [{ path: '/a' }, { path: '/b' }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('ambiguous-workspace')
    expect(result.message).toContain('/a')
    expect(result.message).toContain('/b')
  })
})

describe('detectRepo (workspace-aware)', () => {
  const githubRemote = async (_cwd: string) => 'git@github.com:octo/ghl.git'

  it('passes a no-workspace resolution failure through', async () => {
    expect(await detectRepo(githubRemote, noWorkspace)).toEqual(noWorkspace)
  })

  it('passes an ambiguous-workspace resolution failure through', async () => {
    expect(await detectRepo(githubRemote, ambiguous)).toEqual(ambiguous)
  })

  it('reports no-remote mentioning the cwd path when the remote URL is null', async () => {
    const result = await detectRepo(async () => null, wsOk)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('no-remote')
    expect(result.message).toContain(WORKSPACE)
  })

  it('reports not-github containing the url for a non-github remote', async () => {
    const result = await detectRepo(async () => 'git@gitlab.com:a/b.git', wsOk)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('not-github')
    expect(result.message).toContain('git@gitlab.com:a/b.git')
  })

  it('resolves the repo for a valid github remote', async () => {
    expect(await detectRepo(githubRemote, wsOk)).toEqual({ ok: true, repo: { owner: 'octo', repo: 'ghl' } })
  })
})
