import { describe, it, expect } from 'vitest'
import { autofill } from '../src/autofill.ts'
import type { Fetcher } from '../src/probe.ts'
import type { ModelEntry } from '../src/props.ts'
import type { SettingsStore, LlmSection, LlmModelEntry } from '../src/settings-io.ts'

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

/**
 * Fetcher double that answers the /v1/models listing with a fixed set of entries.
 * `listing` is null when the server should answer 404 (not llama.cpp); `fail` makes
 * the fetch throw (network error). Tracks how many listings were fetched.
 */
class FakeListingFetcher implements Fetcher {
  fetchCount = 0
  constructor(private listing: ModelEntry[] | null, private fail = false) {}
  async fetch(_url: string): Promise<Response> {
    this.fetchCount++
    if (this.fail) throw new Error('listing fetch failed')
    if (this.listing === null) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({ data: this.listing }), { status: 200 })
  }
}

/** Build a listing entry with an INI preset carrying `ctx-size = n`. */
function entry(id: string, ctxSize?: number): ModelEntry {
  const lines = ['jinja = 1']
  if (ctxSize !== undefined) lines.push(`ctx-size = ${ctxSize}`)
  return { id, status: { preset: lines.join('\n') } }
}

function sectionWith(routeId: string, api: string, baseURL: string, modelIds: string[]): LlmSection {
  return { providers: { [routeId]: { api, baseURL, models: modelIds.map(id => ({ id })) } } }
}

describe('autofill', () => {
  it('fills candidate models from the listing and ignores non-candidate routes', async () => {
    const section: LlmSection = {
      providers: {
        good: { api: 'openai-completions', baseURL: 'http://h', models: [{ id: 'm1' }, { id: 'm2' }] },
        other: { api: 'anthropic-messages', baseURL: 'http://h', models: [{ id: 'mx' }] },
      },
    }
    const store = new FakeStore(section)
    // m1 has a ctx-size in the listing; m2 does not (unknown from the listing).
    const fetcher = new FakeListingFetcher([entry('m1', 120064), entry('m2')])
    await autofill({ store, fetcher })
    expect(store.section.providers?.['good']?.models).toEqual([{ id: 'm1', contextWindow: 120000 }, { id: 'm2' }])
    // the non-candidate route is untouched and never fetched
    expect(store.section.providers?.['other']?.models).toEqual([{ id: 'mx' }])
    expect(fetcher.fetchCount).toBe(1) // only the candidate route was listed
  })

  it('fetches one listing per route and fills every model in it', async () => {
    const ids = ['m1', 'm2', 'm3', 'm4']
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ids))
    const fetcher = new FakeListingFetcher(ids.map(id => entry(id, 90000)))
    await autofill({ store, fetcher })
    expect(fetcher.fetchCount).toBe(1) // one listing, not per-model probes
    const models = store.section.providers?.['r']?.models ?? []
    expect(models.every(m => m.contextWindow === 90000)).toBe(true)
  })

  it('is idempotent: a fully-sized route is not re-listed on the next round', async () => {
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ['m1']))
    const fetcher = new FakeListingFetcher([entry('m1', 120064)])
    await autofill({ store, fetcher })
    expect(store.section.providers?.['r']?.models).toEqual([{ id: 'm1', contextWindow: 120000 }])
    // second round over the same (now sized) section: nothing to do
    const fetchesAfterFirst = fetcher.fetchCount
    const writesAfterFirst = store.writeCount
    await autofill({ store, fetcher })
    expect(fetcher.fetchCount).toBe(fetchesAfterFirst) // no new listing (self-cycle guard)
    expect(store.writeCount).toBe(writesAfterFirst) // no new writes
  })

  it('skips a failing listing without leaking an exception', async () => {
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ['m1']))
    const fetcher = new FakeListingFetcher([entry('m1', 120064)], true) // network error
    await expect(autofill({ store, fetcher })).resolves.toBeUndefined()
    expect(store.writeCount).toBe(0)
    expect(store.section.providers?.['r']?.models).toEqual([{ id: 'm1' }])
  })

  it('never writes when no model in the listing carries a context size', async () => {
    const store = new FakeStore(sectionWith('r', 'openai-completions', 'http://h', ['m1']))
    const fetcher = new FakeListingFetcher([entry('m1')]) // no ctx-size / fit-ctx anywhere
    await autofill({ store, fetcher })
    expect(store.writeCount).toBe(0)
    expect(store.section.providers?.['r']?.models).toEqual([{ id: 'm1' }] as LlmModelEntry[])
  })
})
