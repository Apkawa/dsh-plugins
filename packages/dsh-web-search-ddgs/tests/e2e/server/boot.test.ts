import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { startDsh, stopDsh, pluginListed, type DshHandle } from '../dsh-fixture.ts'

/**
 * Live e2e: an independent `dsh web` boots with this plugin linked into the
 * fresh `web` profile. The launcher already asserted HTTP 200 before its ready
 * line; this test re-proves reachability and that the plugin is in the profile.
 */
describe('web-search-ddgs e2e (live dsh web)', () => {
  let handle: DshHandle | undefined

  beforeAll(async () => {
    handle = await startDsh()
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    const result = await stopDsh(handle)
    expect(result.code).toBe(0)
    expect(result.rootRemoved).toBe(true)
  }, 60_000)

  it('links the plugin into the fresh web profile', async () => {
    expect(pluginListed(handle!)).toBe(true)
  })

  it('serves the web app over HTTP 200', async () => {
    const response = await fetch(handle!.url)
    expect(response.status).toBe(200)
  })
})
