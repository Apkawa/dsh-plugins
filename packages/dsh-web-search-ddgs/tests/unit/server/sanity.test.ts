import { describe, expect, it } from 'vitest'

describe('sanity', () => {
  it('exposes the plugin identity and apply hook', async () => {
    const plugin = await import('../../../src/index.ts')
    expect(plugin.name).toBe('web-search-ddgs')
    expect(plugin.inject).toEqual(['web'])
    expect(typeof plugin.apply).toBe('function')
  })
})
