import { describe, it, expect } from 'vitest'
import {
  isCandidateRoute,
  planContextWindowWrite,
  planContextWindowOverwrite,
  persistModels,
  persistContextWindow,
  type SettingsStore,
  type LlmModelEntry,
  type LlmSection,
} from '../src/settings-io.ts'

/** A route profile as stored in the llm-pi-ai section (we only touch a few fields). */
type Route = { api?: string; baseURL?: string; apiKeyEnv?: string; models?: LlmModelEntry[] }

describe('isCandidateRoute (§3.1)', () => {
  it('accepts an openai-completions route with a baseURL', () => {
    expect(isCandidateRoute({ api: 'openai-completions', baseURL: 'http://x' })).toBe(true)
  })
  it('accepts a llama.cpp route with a baseURL (type already confirmed)', () => {
    expect(isCandidateRoute({ api: 'llama.cpp', baseURL: 'http://x' })).toBe(true)
  })
  it('rejects any other wire protocol', () => {
    expect(isCandidateRoute({ api: 'anthropic-messages', baseURL: 'http://x' })).toBe(false)
    expect(isCandidateRoute({ api: 'openai-responses', baseURL: 'http://x' })).toBe(false)
  })
  it('rejects a route with no or empty baseURL', () => {
    expect(isCandidateRoute({ api: 'openai-completions' })).toBe(false)
    expect(isCandidateRoute({ api: 'openai-completions', baseURL: '' })).toBe(false)
  })
  it('rejects a route with no api (catalog route)', () => {
    expect(isCandidateRoute({ baseURL: 'http://x' })).toBe(false)
  })
})

describe('planContextWindowWrite', () => {
  it('creates a model entry when absent, appending at the end', () => {
    const res = planContextWindowWrite([{ id: 'A' }], 'B', 120000)
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A' }, { id: 'B', contextWindow: 120000 }])
  })
  it('fills an existing entry that has no contextWindow yet', () => {
    const res = planContextWindowWrite([{ id: 'A', name: 'Model A' }], 'A', 8000)
    expect(res.changed).toBe(true)
    // sibling fields are preserved; only contextWindow is added
    expect(res.models).toEqual([{ id: 'A', name: 'Model A', contextWindow: 8000 }])
  })
  it('never overwrites an existing nonzero contextWindow (user override)', () => {
    const res = planContextWindowWrite([{ id: 'A', contextWindow: 50000 }], 'A', 120000)
    expect(res.changed).toBe(false)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 50000 }])
  })
  it('treats a zeroed contextWindow as unset and fills it', () => {
    const res = planContextWindowWrite([{ id: 'A', contextWindow: 0 }], 'A', 8000)
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 8000 }])
  })
  it('does not disturb other model entries or their order', () => {
    const res = planContextWindowWrite([{ id: 'X' }, { id: 'Y', contextWindow: 4096 }], 'Z', 1000)
    expect(res.models).toEqual([{ id: 'X' }, { id: 'Y', contextWindow: 4096 }, { id: 'Z', contextWindow: 1000 }])
  })
})

/** In-memory SettingsStore double; simulates revision bumps and conflicts. */
class FakeStore implements SettingsStore {
  section: LlmSection
  revision = 1
  /** Writes that will conflict before succeeding. */
  conflictsLeft = 0
  /** When set, setRouteModels throws this instead of persisting. */
  forceError?: unknown
  writeCount = 0

  constructor(section: LlmSection) {
    this.section = structuredClone(section)
  }

  read(): { value: LlmSection; revision: number } {
    return { value: this.section, revision: this.revision }
  }

  async setRouteModels(routeId: string, models: readonly LlmModelEntry[], expectedRevision: number): Promise<void> {
    if (this.forceError !== undefined) throw this.forceError
    if (this.conflictsLeft > 0) {
      this.conflictsLeft--
      this.revision++ // an external write moved the namespace
      const err = new Error('settings conflict')
      err.name = 'SettingsConflictError'
      ;(err as { code?: string }).code = 'SETTINGS_CONFLICT'
      throw err
    }
    this.writeCount++
    const providers: Record<string, Route> = { ...(this.section.providers ?? {}) }
    const current = providers[routeId] ?? {}
    providers[routeId] = { ...current, models: [...models] }
    this.section = { ...this.section, providers }
    this.revision++
  }
}

describe('persistModels (fenced write + single retry)', () => {
  const baseSection = (): LlmSection => ({
    providers: {
      myroute: { api: 'openai-completions', baseURL: 'http://h', models: [{ id: 'm1' }] },
    },
  })

  it('writes contextWindow for an absent model entry on a clean revision', async () => {
    const store = new FakeStore(baseSection())
    await persistModels(store, 'myroute', 'm2', 120000)
    expect(store.writeCount).toBe(1)
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1' }, { id: 'm2', contextWindow: 120000 }])
  })

  it('does not write when the value is already a user override', async () => {
    const section = baseSection()
    section.providers!.myroute!.models![0] = { id: 'm1', contextWindow: 50000 }
    const store = new FakeStore(section)
    await persistModels(store, 'myroute', 'm1', 120000)
    expect(store.writeCount).toBe(0) // no-op: existing nonzero preserved
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1', contextWindow: 50000 }])
  })

  it('skips quietly when the route is not in the section', async () => {
    const store = new FakeStore(baseSection())
    await persistModels(store, 'ghost-route', 'm1', 120000)
    expect(store.writeCount).toBe(0)
  })

  it('re-reads and retries once after a single conflict', async () => {
    const store = new FakeStore(baseSection())
    store.conflictsLeft = 1 // first write conflicts, second succeeds
    await persistModels(store, 'myroute', 'm2', 8000)
    expect(store.writeCount).toBe(1)
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1' }, { id: 'm2', contextWindow: 8000 }])
  })

  it('propagates the error when two consecutive conflicts occur', async () => {
    const store = new FakeStore(baseSection())
    store.conflictsLeft = 2 // both attempts conflict
    await expect(persistModels(store, 'myroute', 'm2', 8000)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    expect(store.writeCount).toBe(0)
  })

  it('does not retry a non-conflict error (e.g. schema rejection)', async () => {
    const store = new FakeStore(baseSection())
    const err = new Error('settings-rejected')
    ;(err as { code?: string }).code = 'SETTINGS_REJECTED'
    store.forceError = err
    await expect(persistModels(store, 'myroute', 'm2', 8000)).rejects.toBe(err)
    // a non-conflict is not retried: exactly one attempt was made
    expect(store.writeCount).toBe(0)
  })
})

describe('planContextWindowOverwrite (explicit replace)', () => {
  it('creates a model entry when absent, appending at the end', () => {
    const res = planContextWindowOverwrite([{ id: 'A' }], 'B', 120000)
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A' }, { id: 'B', contextWindow: 120000 }])
  })
  it('overwrites an existing positive contextWindow (the caller asked for a replace)', () => {
    const res = planContextWindowOverwrite([{ id: 'A', contextWindow: 50000 }], 'A', 120000)
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 120000 }])
  })
  it('is a no-op when the stored value already matches', () => {
    const res = planContextWindowOverwrite([{ id: 'A', contextWindow: 8000 }], 'A', 8000)
    expect(res.changed).toBe(false)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 8000 }])
  })
  it('fills an entry that has no contextWindow yet and preserves sibling fields', () => {
    const res = planContextWindowOverwrite([{ id: 'X', name: 'x' }, { id: 'Y' }], 'Y', 100)
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'X', name: 'x' }, { id: 'Y', contextWindow: 100 }])
  })
})

describe('persistContextWindow (fenced overwrite write + single retry)', () => {
  const section = (): LlmSection => ({
    providers: {
      myroute: { api: 'openai-completions', baseURL: 'http://h', models: [{ id: 'm1' }] },
    },
  })

  it('writes contextWindow for an absent model entry on a clean revision', async () => {
    const store = new FakeStore(section())
    await persistContextWindow(store, 'myroute', 'm2', 120000)
    expect(store.writeCount).toBe(1)
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1' }, { id: 'm2', contextWindow: 120000 }])
  })

  it('replaces an existing different value (explicit overwrite)', async () => {
    const s = section()
    s.providers!.myroute!.models![0] = { id: 'm1', contextWindow: 50000 }
    const store = new FakeStore(s)
    await persistContextWindow(store, 'myroute', 'm1', 120000)
    expect(store.writeCount).toBe(1)
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1', contextWindow: 120000 }])
  })

  it('does not write when the stored value already matches', async () => {
    const s = section()
    s.providers!.myroute!.models![0] = { id: 'm1', contextWindow: 8000 }
    const store = new FakeStore(s)
    await persistContextWindow(store, 'myroute', 'm1', 8000)
    expect(store.writeCount).toBe(0) // no-op: value already correct
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1', contextWindow: 8000 }])
  })

  it('skips quietly when the route is not in the section', async () => {
    const store = new FakeStore(section())
    await persistContextWindow(store, 'ghost-route', 'm1', 120000)
    expect(store.writeCount).toBe(0)
  })

  it('re-reads and retries once after a single conflict', async () => {
    const store = new FakeStore(section())
    store.conflictsLeft = 1 // first write conflicts, second succeeds
    await persistContextWindow(store, 'myroute', 'm2', 8000)
    expect(store.writeCount).toBe(1)
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1' }, { id: 'm2', contextWindow: 8000 }])
  })

  it('propagates the error when two consecutive conflicts occur', async () => {
    const store = new FakeStore(section())
    store.conflictsLeft = 2 // both attempts conflict
    await expect(persistContextWindow(store, 'myroute', 'm2', 8000)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    expect(store.writeCount).toBe(0)
  })

  it('does not retry a non-conflict error (e.g. schema rejection)', async () => {
    const store = new FakeStore(section())
    const err = new Error('settings-rejected')
    ;(err as { code?: string }).code = 'SETTINGS_REJECTED'
    store.forceError = err
    await expect(persistContextWindow(store, 'myroute', 'm2', 8000)).rejects.toBe(err)
    expect(store.writeCount).toBe(0)
  })
})
