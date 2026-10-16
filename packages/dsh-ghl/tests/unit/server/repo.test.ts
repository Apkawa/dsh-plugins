import { describe, expect, it } from 'vitest'
import { detectRepo, parseGithubRemote } from '../../../src/repo.ts'
import type { RepoRef } from '../../../src/issues.ts'

const REPO: RepoRef = { owner: 'octo', repo: 'ghl' }

describe('parseGithubRemote', () => {
  it('parses an https remote with a .git suffix', () => {
    expect(parseGithubRemote('https://github.com/octo/ghl.git')).toEqual(REPO)
  })

  it('parses an https remote without a .git suffix', () => {
    expect(parseGithubRemote('https://github.com/octo/ghl')).toEqual(REPO)
  })

  it('parses an scp-like ssh remote', () => {
    expect(parseGithubRemote('git@github.com:octo/ghl.git')).toEqual(REPO)
  })

  it('parses an ssh:// remote', () => {
    expect(parseGithubRemote('ssh://git@github.com/octo/ghl.git')).toEqual(REPO)
  })

  it('returns null for a gitlab https remote', () => {
    expect(parseGithubRemote('https://gitlab.com/octo/ghl.git')).toBeNull()
  })

  it('returns null for a gitlab scp-like remote', () => {
    expect(parseGithubRemote('git@gitlab.com:octo/ghl.git')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseGithubRemote('')).toBeNull()
  })

  it('returns null for a github url with no repo path', () => {
    expect(parseGithubRemote('https://github.com/octo')).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(parseGithubRemote('not-a-remote')).toBeNull()
  })
})

describe('detectRepo', () => {
  const ws = { ok: true, path: '/ws' } as const

  it('returns the parsed repo for a github remote', async () => {
    expect(await detectRepo(async () => 'https://github.com/octo/ghl.git', ws)).toEqual({ ok: true, repo: REPO })
  })

  it('returns no-remote when there is no remote', async () => {
    const result = await detectRepo(async () => null, ws)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('no-remote')
  })

  it('returns not-github for a non-github remote', async () => {
    const result = await detectRepo(async () => 'https://gitlab.com/octo/ghl.git', ws)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('not-github')
  })
})
