import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { SettingsProvider as Settings, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '../../../src/index.ts'

/** In-memory settings provider double: stores nothing on disk, resolves sections live. */
class MemorySettings extends Settings {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

const NS = settingsNamespace('model-settings')
const LLM_NS = settingsNamespace('llm-pi-ai')

describe('model-settings composition root', () => {
  it('registers the model-settings namespace so the settings card appears', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    // The llm-pi-ai section is owned by another plugin; register an empty one so
    // this root has something to read and observe (the watcher target).
    ctx.settings.register(LLM_NS, z.object({}) as never, { base: {} })
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).toContain(NS)
    // The card's data comes from the host RPC, not this section; it resolves empty.
    expect(ctx.settings.get(NS)).toEqual({})
  })

  it('disposes cleanly and removes its namespace on fiber teardown', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    ctx.settings.register(LLM_NS, z.object({}) as never, { base: {} })
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).toContain(NS)
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(NS)
  })
})
