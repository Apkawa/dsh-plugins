import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import { apply, name } from '../../../src/index.ts'

/** Web seam double: records registered search providers. */
class FakeWeb {
  providers: WebSearchProvider[] = []
  registerSearchProvider(provider: WebSearchProvider): () => void {
    this.providers.push(provider)
    return () => {
      this.providers = this.providers.filter(p => p !== provider)
    }
  }
}

describe('web-search-ddgs composition root', () => {
  it('registers the ddgs search provider into ctx.web', async () => {
    const web = new FakeWeb()
    const ctx = { web } as unknown as Context
    apply(ctx, {})
    expect(web.providers).toHaveLength(1)
    expect(web.providers[0]?.id).toBe('ddgs')
  })

  it('registers exactly one provider and exposes the plugin name', async () => {
    expect(name).toBe('web-search-ddgs')
    const web = new FakeWeb()
    const ctx = { web } as unknown as Context
    apply(ctx, { backend: 'duckduckgo', maxResults: 5, timeoutMs: 20000, venvDir: '/tmp/venv', ddgsVersion: 'ddgs==9.16.0' })
    expect(web.providers).toHaveLength(1)
    expect(typeof web.providers[0]?.search).toBe('function')
    expect(typeof web.providers[0]?.available).toBe('function')
  })
})
