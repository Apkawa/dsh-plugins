import { describe, it, expect } from 'vitest'
import { makeRpcHandler } from '../src/index.ts'
import { type SettingsStore, type LlmModelEntry, type LlmSection } from '../src/settings-io.ts'
import { type Fetcher } from '../src/probe.ts'

/** A route profile as stored in the llm-pi-ai section. */
type Route = { api?: string; baseURL?: string; apiKeyEnv?: string; models?: LlmModelEntry[] }

/** In-memory SettingsStore double (mirrors efforts.test.ts). */
class FakeStore implements SettingsStore {
  section: LlmSection
  revision = 1
  writeCount = 0

  constructor(section: LlmSection) {
    this.section = structuredClone(section)
  }

  read(): { value: LlmSection; revision: number } {
    return { value: this.section, revision: this.revision }
  }

  async setRouteModels(routeId: string, models: readonly LlmModelEntry[], expectedRevision: number): Promise<void> {
    this.writeCount++
    const providers: Record<string, Route> = { ...(this.section.providers ?? {}) }
    const current = providers[routeId] ?? {}
    providers[routeId] = { ...current, models: [...models] }
    this.section = { ...this.section, providers }
    this.revision++
  }
}

const baseSection = (): LlmSection => ({
  providers: {
    urabe: {
      api: 'openai-completions',
      baseURL: 'http://192.168.1.69:8080/v1',
      models: [
        { id: 'Zed-Qwen3.8-27B', contextWindow: 80000, reasoningEfforts: { low: 'low', high: 'high' } },
        { id: 'Other-Model', name: 'no efforts yet' },
      ],
    },
    // A non-candidate route (no baseURL) must be excluded from the listing.
    catalog: { models: [{ id: 'DeepSeek-V4' }] },
  },
})

/** The /v1/models listing refreshContextWindow reads through the injected fetcher. */
const REFRESH_LISTING = JSON.stringify({
  data: [
    { id: 'Zed-Qwen3.8-27B', status: { preset: 'ctx-size = 90000\nfit-ctx = 4096' } },
    { id: 'Other-Model', status: { preset: 'ctx-size = 123456' } },
  ],
})

/** A stub Fetcher returning a fixed 200 JSON reply (mirrors probe.test.ts). */
function okFetcher(body: string): Fetcher {
  return {
    fetch: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
  }
}

describe('makeRpcHandler — v2 reasoning endpoints', () => {
  it('listReasoningRows returns candidate routes\' models with their current efforts and contextWindow', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('listReasoningRows', null)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Only the candidate route's models are listed; non-candidate routes excluded.
    expect(res.value).toEqual([
      { routeId: 'urabe', modelId: 'Zed-Qwen3.8-27B', contextWindow: 80000, efforts: { low: 'low', high: 'high' } },
      { routeId: 'urabe', modelId: 'Other-Model' },
    ])
  })

  it('still reports an unknown endpoint as a carrier-conformant internal error', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('nope', null)
    expect(res).toEqual({ ok: false, error: { message: 'unknown endpoint "nope"', code: 'internal', details: {} } })
  })
})

describe('makeRpcHandler — saveModel', () => {
  it('commits both parts in a single write', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('saveModel', { routeId: 'urabe', modelId: 'Other-Model', efforts: { medium: 'medium', high: 'high' }, contextWindow: 120000 })
    expect(res).toEqual({ ok: true, value: null })
    expect(store.writeCount).toBe(1)
    expect(store.section.providers!.urabe.models![1]).toEqual({ id: 'Other-Model', name: 'no efforts yet', reasoningEfforts: { medium: 'medium', high: 'high' }, contextWindow: 120000 })
  })

  it('commits only the efforts part when contextWindow is omitted', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('saveModel', { routeId: 'urabe', modelId: 'Other-Model', efforts: { medium: 'medium' } })
    expect(res).toEqual({ ok: true, value: null })
    expect(store.writeCount).toBe(1)
    // the stored entry gains the mapping and nothing else
    expect(store.section.providers!.urabe.models![1]).toEqual({ id: 'Other-Model', name: 'no efforts yet', reasoningEfforts: { medium: 'medium' } })
  })

  it('commits only the contextWindow part when efforts is omitted', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('saveModel', { routeId: 'urabe', modelId: 'Other-Model', contextWindow: 64000 })
    expect(res).toEqual({ ok: true, value: null })
    expect(store.writeCount).toBe(1)
    expect(store.section.providers!.urabe.models![1]).toEqual({ id: 'Other-Model', name: 'no efforts yet', contextWindow: 64000 })
  })

  it('clears a stored contextWindow when the part is null, preserving the mapping', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('saveModel', { routeId: 'urabe', modelId: 'Zed-Qwen3.8-27B', contextWindow: null })
    expect(res).toEqual({ ok: true, value: null })
    expect(store.writeCount).toBe(1)
    // the key is dropped so dsh falls back to its own resolution; the mapping stands
    expect(store.section.providers!.urabe.models![0]).toEqual({ id: 'Zed-Qwen3.8-27B', reasoningEfforts: { low: 'low', high: 'high' } })
  })

  it('rejects an invalid mapping (only "off") without writing', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('saveModel', { routeId: 'urabe', modelId: 'Other-Model', efforts: { off: null } })
    expect(res.ok).toBe(false)
    if (res.ok) return
    // the dsh carrier validates errors against a closed code union with required details
    expect(res.error.code).toBe('bad-request')
    expect(res.error.details).toEqual({ issues: [] })
    // the store was not touched
    expect(store.writeCount).toBe(0)
    expect(store.section.providers!.urabe.models![1]).toEqual({ id: 'Other-Model', name: 'no efforts yet' })
  })

  it('rejects a non-positive contextWindow without writing', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('saveModel', { routeId: 'urabe', modelId: 'Other-Model', contextWindow: 0 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('bad-request')
    expect(store.writeCount).toBe(0)
  })

  it('rejects a non-integer contextWindow without writing', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    const res = await handler('saveModel', { routeId: 'urabe', modelId: 'Other-Model', contextWindow: 12.5 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('bad-request')
    expect(store.writeCount).toBe(0)
  })

  it('rejects a payload missing required fields', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store)
    expect((await handler('saveModel', { routeId: 'urabe' })).ok).toBe(false) // no modelId
    expect((await handler('saveModel', { routeId: 'urabe', modelId: 'Other-Model' })).ok).toBe(false) // nothing to save
    expect(store.writeCount).toBe(0)
  })
})

describe('makeRpcHandler — refreshContextWindow', () => {
  it('writes the rounded value from the listing and returns it', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store, okFetcher(REFRESH_LISTING))
    const res = await handler('refreshContextWindow', { routeId: 'urabe', modelId: 'Other-Model' })
    expect(res).toEqual({ ok: true, value: { contextWindow: 123000 } }) // 123456 floored to the thousand
    expect(store.writeCount).toBe(1)
    expect(store.section.providers!.urabe.models![1]).toEqual({ id: 'Other-Model', name: 'no efforts yet', contextWindow: 123000 })
  })

  it('fails loud when the model is absent from the listing', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store, okFetcher(REFRESH_LISTING))
    const res = await handler('refreshContextWindow', { routeId: 'urabe', modelId: 'Ghost-Model' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.message).toContain('Ghost-Model')
    // The dsh carrier validates errors against a closed code union with required
    // details; a non-conformant result reaches the client as raw zod issues.
    expect(res.error.code).toBe('internal')
    expect(res.error.details).toEqual({})
    expect(store.writeCount).toBe(0)
  })

  it('fails loud when the entry has no ctx-size or fit-ctx', async () => {
    const store = new FakeStore(baseSection())
    const listing = JSON.stringify({ data: [{ id: 'Other-Model', status: { preset: 'jinja = 1' } }] })
    const handler = makeRpcHandler(store, okFetcher(listing))
    const res = await handler('refreshContextWindow', { routeId: 'urabe', modelId: 'Other-Model' })
    expect(res.ok).toBe(false)
    expect(store.writeCount).toBe(0)
  })

  it('fails loud when the route has no baseURL', async () => {
    const store = new FakeStore(baseSection())
    const handler = makeRpcHandler(store, okFetcher(REFRESH_LISTING))
    const res = await handler('refreshContextWindow', { routeId: 'catalog', modelId: 'DeepSeek-V4' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.message).toContain('baseURL')
    expect(store.writeCount).toBe(0)
  })
})
