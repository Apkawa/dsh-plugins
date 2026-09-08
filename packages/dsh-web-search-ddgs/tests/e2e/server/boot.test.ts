import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { startDsh, stopDsh, pluginListed, type DshHandle } from '@root/tests-helpers/e2e/dsh-fixture.ts'
import { E2E_DSH_VERSIONS } from '@root/tests-helpers/e2e/dsh.ts'

/**
 * Live e2e, one iteration per dsh version: an independent `dsh web` boots with
 * this plugin linked into the fresh `web` profile. The launcher already
 * asserted HTTP 200 before its ready line; these tests re-prove reachability
 * and that the plugin is in the profile, per version.
 */
describe.each(E2E_DSH_VERSIONS)('web-search-ddgs e2e (live dsh web, %s)', (version) => {
  let handle: DshHandle | undefined

  beforeAll(async () => {
    handle = await startDsh({ packageName: 'dsh-web-search-ddgs', version })
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
    const response = await fetch(handle!.url, handle!.cookie === null ? undefined : { headers: { cookie: handle!.cookie } })
    expect(response.status).toBe(200)
  })
})
