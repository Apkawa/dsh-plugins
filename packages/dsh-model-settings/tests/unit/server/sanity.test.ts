import { describe, expect, it } from 'vitest'

describe('sanity', () => {
  it('exposes the plugin identity and apply hook', async () => {
    const plugin = await import('../../../src/index.ts')
    expect(plugin.name).toBe('model-settings')
    expect(typeof plugin.apply).toBe('function')
  })
})
