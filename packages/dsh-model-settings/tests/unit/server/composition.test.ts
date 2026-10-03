import { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import { apply } from '../../../src/index.ts'

const NS = 'model-settings' as SettingsNamespace
const LLM_NS = 'llm-pi-ai' as SettingsNamespace

/** In-memory settings double: one descriptor read (the llm-pi-ai row), a no-op path-op write. */
function fakeSettings() {
  return {
    describe: () => [{ ns: LLM_NS, value: {}, revision: 1 }],
    mutate: () => Promise.resolve(),
  } as never
}

describe('model-settings composition root', () => {
  it('does not register a model-settings namespace (card is client-side; data lives in llm-pi-ai)', async () => {
    const ctx = new Context()
    ctx.provide('settings', fakeSettings())
    const registered: Array<{ kind: string; path: string }> = []
    // The webServer service is a 0.2.0 host seam; the fake captures the channel route.
    ctx.provide('webServer', { register: (route: { kind: string; path: string }) => { registered.push(route); return () => {} } } as never)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const namespaces = ctx.settings.describe().map(row => row.ns)
    expect(namespaces).not.toContain(NS)
    expect(namespaces).toContain(LLM_NS)
    // The composition root mounts the /model-settings prefix route on the host web server.
    expect(registered.map(route => route.path)).toContain('/model-settings')
  })

  it('disposes cleanly on fiber teardown without leaving a namespace', async () => {
    const ctx = new Context()
    ctx.provide('settings', fakeSettings())
    ctx.provide('webServer', { register: () => () => {} } as never)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(NS)
    // A throwing teardown would fail this test directly.
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(NS)
  })
})
