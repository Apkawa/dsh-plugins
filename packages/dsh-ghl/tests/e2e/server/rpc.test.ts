import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { startDsh, stopDsh, rpc, type DshHandle } from '@root/tests-helpers/e2e/dsh-fixture.ts'
import { E2E_DSH_VERSIONS } from '@root/tests-helpers/e2e/dsh.ts'

const CHANNEL = 'ghl'

/**
 * Live e2e for the /ghl RPC channel: one `dsh web` per version, pinning the
 * channel's request/response contract endpoint by endpoint. The e2e launcher
 * boots `dsh web` with a throwaway home as its CWD, which sits inside this
 * repository's working tree; `git init`-ing it makes it a fresh repository
 * with no `origin` remote. The host resolves the repo per-workspace (payload
 * `workspacePath` wins over the workspace registry, and the fresh home
 * registers none), so every request carries `workspacePath: handle.root`:
 * the resolution succeeds at the throwaway home and the git read there fails
 * with `no-remote`, which every repo-dependent endpoint passes through —
 * the pins are the result flags and error codes, no live network.
 */
describe.each(E2E_DSH_VERSIONS)('ghl e2e RPC (live dsh web, %s)', (version) => {
  let handle: DshHandle | undefined

  beforeAll(async () => {
    handle = await startDsh({ packageName: 'dsh-ghl', version })
    spawnSync('git', ['init', '--quiet'], { cwd: handle.root })
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    const result = await stopDsh(handle)
    expect(result.code).toBe(0)
    expect(result.rootRemoved).toBe(true)
  }, 60_000)

  // The fresh home registers no workspace, so the per-workspace resolution
  // must come from the payload: point it at the throwaway home (git-init'ed
  // in beforeAll, no origin remote).
  const repoPayload = () => ({ workspacePath: handle!.root })

  it('detectRepo: a workspace with no origin remote yields a no-remote failure', async () => {
    const res = await rpc<unknown>(handle!, CHANNEL, 'detectRepo', repoPayload())
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('no-remote')
  })

  it('listIssues: with no repo the channel passes the detection failure through', async () => {
    const res = await rpc<{ issues: unknown[] }>(handle!, CHANNEL, 'listIssues', repoPayload())
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('no-remote')
  })

  it('getIssue: with no repo the channel passes the detection failure through for any number', async () => {
    const res = await rpc<{ issue: unknown }>(handle!, CHANNEL, 'getIssue', { number: 1, ...repoPayload() })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('no-remote')
  })

  it('an unknown endpoint yields an internal failure', async () => {
    const res = await rpc<unknown>(handle!, CHANNEL, 'noSuchEndpoint', {})
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('internal')
  })
})
