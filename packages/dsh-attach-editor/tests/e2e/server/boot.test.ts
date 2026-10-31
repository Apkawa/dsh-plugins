import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { startDsh, stopDsh, pluginListed, type DshHandle } from '@root/tests-helpers/e2e/dsh-fixture.ts'
import { E2E_DSH_VERSIONS } from '@root/tests-helpers/e2e/dsh.ts'

/**
 * Live e2e boot smoke, one iteration per dsh version: an independent `dsh web`
 * boots with this plugin linked into the fresh `web` profile. The launcher
 * already asserted HTTP 200 before its ready line; these tests re-prove
 * reachability, that the plugin is in the profile, and that the startup audit
 * reported no inactive entry (`app-boot` writes "warning: N entries did not
 * activate" to the child's stderr when a row fails to activate — the launcher
 * keeps the whole stdout+stderr buffer readable through `handle.readOutput()`).
 */
describe.each(E2E_DSH_VERSIONS)('attach-editor e2e (live dsh web, %s)', (version) => {
  let handle: DshHandle | undefined

  beforeAll(async () => {
    handle = await startDsh({ packageName: 'dsh-attach-editor', version })
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

  it('activates the plugin row: the boot reports no inactive entry', async () => {
    const output = handle!.readOutput()
    expect(output).not.toContain('did not activate')
    expect(output).not.toContain('startup failed')
  })
})
