import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { gitRemoteUrl } from '../../../src/repo.ts'

const TMP_ROOT = path.resolve(import.meta.dirname, '../../../../..', '.tmp')
const REMOTE_URL = 'git@github.com:octo/ghl.git'

let repoDir = ''
let emptyDir = ''

const git = (args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) => {
    execFile('git', args, { cwd }, error => (error ? reject(error) : resolve()))
  })

beforeAll(async () => {
  const [repo, empty] = await Promise.all([
    mkdtemp(path.join(TMP_ROOT, 'ghl-repo-url-')),
    mkdtemp(path.join(TMP_ROOT, 'ghl-empty-dir-')),
  ])
  repoDir = repo
  emptyDir = empty
  await git(['init'], repo)
  await git(['remote', 'add', 'origin', REMOTE_URL], repo)
})

afterAll(async () => {
  await Promise.all([
    rm(repoDir, { recursive: true, force: true }),
    rm(emptyDir, { recursive: true, force: true }),
  ])
})

describe('gitRemoteUrl(cwd)', () => {
  it('returns the origin URL of the repo at the given cwd', async () => {
    expect(await gitRemoteUrl(repoDir)).toBe(REMOTE_URL)
  })

  it('returns null when the cwd has no origin remote', async () => {
    expect(await gitRemoteUrl(emptyDir)).toBeNull()
  })
})
