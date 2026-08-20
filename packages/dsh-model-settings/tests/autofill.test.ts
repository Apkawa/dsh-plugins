import { describe, it, expect } from 'vitest'
import { autofill } from '../src/autofill.ts'
import type { Fetcher } from '../src/probe.ts'
import type { SettingsStore, LlmSection, LlmModelEntry } from '../src/settings-io.ts'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** In-memory SettingsStore double (writes always succeed; revision bumps per write). */
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
  async setRouteModels(routeId: string, models: readonly LlmModelEntry[], _expectedRevision: number): Promise<void> {
    this.writeCount++
    const providers: Record<string, unknown> = { ...(this.section.providers ?? {}) }
    providers[routeId] = { ...(providers[routeId] as object), models: [...models] }
    this.section = { ...this.section, providers }
    this.revision++
  }
}

/** Fetcher double that confirms a set of models and tracks in-flight probes. */
class FakeFetcher implements Fetcher {
  inFlight = 0
  maxInFlight = 0
  probed: string[] = []
  constructor(private confirmed: Set<string>, private failing: ReadonlySet<string> = new Set()) {}
  async fetch(url: string): Promise<Response> {
    const model = new URL(url).searchParams.get('model') ?? ''
    this.probed.push(model)
    if (this.failing.has(model)) {
      await tick()
      throw new Error(`probe failed for ${model}`)
    }
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      await tick()
    } finally {
      this.inFlight--
    }
    if (this.confirmed.has(model)) {
      return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 120064 } }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }
}

function sectionWith(routeId: string, api: string, baseURL: string, modelIds: string[]): LlmSection {
  return { providers: { [routeId]: { api, baseURL, models: modelIds.map(id => ({ id })) } } }
}

describe('autofill', () => {
  it('fills only confirmed candidate models and ignores non-candidate routes', async () => {
    const section: LlmSection = {
      providers: {
        good: { api: 'openai-completions', baseURL: 'http://h', models: [{ id: 'm1' }, { id: 'm2' }] },
        other: { api: 'anthropic-messages', baseURL: 'http://h', models: [{ id: 'mx' }] },
      },
    }
    const store = new FakeStore(section)
    const fetcher = new FakeFetcher(new Set(['m1'])) // m2 is not confirmed; mx must never be probed
    await autofill({ store, fetcher })
    expect(store.section.providers?.['good']?.models).toEqual([{ id: 'm1', contextWindow: 120000 }, { id: 'm2' }])
    // the non-candidate route is untouched and never probed
    expect(store.section.providers?.['other']?.models).toEqual([{ id: 'mx' }])
    expect(fetcher.probed).not.toContain('mx')
  })

  it('probes with at most 3 in flight and loses no model', async () => {
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ids))
    const fetcher = new FakeFetcher(new Set(ids)) // all confirmed
    await autofill({ store, fetcher })
    expect(fetcher.maxInFlight).toBeGreaterThanOrEqual(2)
    expect(fetcher.maxInFlight).toBeLessThanOrEqual(3)
    expect([...fetcher.probed].sort()).toEqual(ids) // no model lost
    const models = store.section.providers?.['r']?.models ?? []
    expect(models.every(m => m.contextWindow === 120000)).toBe(true)
  })

  it('is idempotent: a sized model is not re-probed on the next round', async () => {
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ['m1']))
    const fetcher = new FakeFetcher(new Set(['m1']))
    await autofill({ store, fetcher })
    expect(store.section.providers?.['r']?.models).toEqual([{ id: 'm1', contextWindow: 120000 }])
    // second round over the same (now sized) section: nothing to do
    const probesAfterFirst = fetcher.probed.length
    const writesAfterFirst = store.writeCount
    await autofill({ store, fetcher })
    expect(fetcher.probed.length).toBe(probesAfterFirst) // no new probes (self-cycle guard)
    expect(store.writeCount).toBe(writesAfterFirst) // no new writes
  })

  it('skips a failing probe without leaking an exception', async () => {
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ['m1', 'm2']))
    const fetcher = new FakeFetcher(new Set(['m2']), new Set(['m1'])) // m1 fails, m2 confirms
    await expect(autofill({ store, fetcher })).resolves.toBeUndefined()
    expect(store.section.providers?.['r']?.models).toEqual([{ id: 'm1' }, { id: 'm2', contextWindow: 120000 }])
  })

  it('never writes when no model is confirmed', async () => {
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ['m1']))
    const fetcher = new FakeFetcher(new Set()) // nothing confirmed (all 404)
    await autofill({ store, fetcher })
    expect(store.writeCount).toBe(0)
    expect(store.section.providers?.['r']?.models).toEqual([{ id: 'm1' }] as LlmModelEntry[])
  })
})
