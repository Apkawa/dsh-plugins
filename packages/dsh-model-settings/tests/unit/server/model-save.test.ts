import { describe, it, expect } from 'vitest'
import { planModelSave, persistModelSave } from '../../../src/model-save.ts'
import type { ReasoningEfforts } from '../../../src/efforts.ts'
import { type SettingsStore, type LlmModelEntry, type LlmSection } from '../../../src/settings-io.ts'

const EFFORTS: ReasoningEfforts = { medium: 'medium', high: 'high' }

describe('planModelSave (one commit for ctx + efforts)', () => {
  it('applies only the contextWindow part when efforts is omitted', () => {
    const res = planModelSave([{ id: 'A', reasoningEfforts: EFFORTS }], 'A', { contextWindow: 120000 })
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A', reasoningEfforts: EFFORTS, contextWindow: 120000 }])
  })

  it('applies only the efforts part when contextWindow is omitted', () => {
    const res = planModelSave([{ id: 'A', contextWindow: 8000 }], 'A', { efforts: EFFORTS })
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 8000, reasoningEfforts: EFFORTS }])
  })

  it('updates both parts of an existing entry in one plan', () => {
    const res = planModelSave([{ id: 'A', contextWindow: 8000, reasoningEfforts: { low: 'low' } }], 'A', { efforts: EFFORTS, contextWindow: 120000 })
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 120000, reasoningEfforts: EFFORTS }])
  })

  it('creates a single merged entry when the model is absent', () => {
    const res = planModelSave([{ id: 'X' }], 'B', { efforts: EFFORTS, contextWindow: 120000 })
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'X' }, { id: 'B', contextWindow: 120000, reasoningEfforts: EFFORTS }])
  })

  it('reports no change when both parts already match', () => {
    const res = planModelSave([{ id: 'A', contextWindow: 8000, reasoningEfforts: EFFORTS }], 'A', { efforts: EFFORTS, contextWindow: 8000 })
    expect(res.changed).toBe(false)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 8000, reasoningEfforts: EFFORTS }])
  })

  it('reports a change when only one part differs', () => {
    const res = planModelSave([{ id: 'A', contextWindow: 8000, reasoningEfforts: EFFORTS }], 'A', { efforts: EFFORTS, contextWindow: 120000 })
    expect(res.changed).toBe(true)
    const res2 = planModelSave([{ id: 'A', contextWindow: 8000, reasoningEfforts: EFFORTS }], 'A', { efforts: { low: 'low' }, contextWindow: 8000 })
    expect(res2.changed).toBe(true)
  })

  it('does not disturb other model entries or their order', () => {
    const res = planModelSave([{ id: 'X' }, { id: 'A', contextWindow: 8000 }], 'A', { contextWindow: 120000 })
    expect(res.models).toEqual([{ id: 'X' }, { id: 'A', contextWindow: 120000 }])
  })

  it('applies an empty efforts part as a clear (reasoningEfforts:false), preserving the contextWindow', () => {
    const res = planModelSave([{ id: 'A', contextWindow: 8000, reasoningEfforts: EFFORTS }], 'A', { efforts: {} })
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A', contextWindow: 8000, reasoningEfforts: false }])
  })

  it('reports no change when the only part is a clear of an already-false entry', () => {
    const res = planModelSave([{ id: 'A', reasoningEfforts: false }], 'A', { efforts: {} })
    expect(res.changed).toBe(false)
    expect(res.models).toEqual([{ id: 'A', reasoningEfforts: false }])
  })

  it('applies a null contextWindow part as a clear (removes the key), preserving the mapping', () => {
    const res = planModelSave([{ id: 'A', contextWindow: 8000, reasoningEfforts: EFFORTS }], 'A', { contextWindow: null })
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A', reasoningEfforts: EFFORTS }])
  })

  it('reports no change when the only part is a clear of an entry without a contextWindow', () => {
    const res = planModelSave([{ id: 'A' }], 'A', { contextWindow: null })
    expect(res.changed).toBe(false)
    expect(res.models).toEqual([{ id: 'A' }])
  })
})

/** A route profile as stored in the llm-pi-ai section (we only touch a few fields). */
type Route = { api?: string; baseURL?: string; apiKeyEnv?: string; models?: LlmModelEntry[] }

/** In-memory SettingsStore double; simulates revision bumps and conflicts. */
class FakeStore implements SettingsStore {
  section: LlmSection
  revision = 1
  /** Writes that will conflict before succeeding. */
  conflictsLeft = 0
  writeCount = 0

  constructor(section: LlmSection) {
    this.section = structuredClone(section)
  }

  read(): { value: LlmSection; revision: number } {
    return { value: this.section, revision: this.revision }
  }

  async setRouteModels(routeId: string, models: readonly LlmModelEntry[], expectedRevision: number): Promise<void> {
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

describe('persistModelSave (fenced combined write + single retry)', () => {
  const section = (): LlmSection => ({
    providers: {
      myroute: { api: 'openai-completions', baseURL: 'http://h', models: [{ id: 'm1' }] },
    },
  })

  it('commits both parts in a single write', async () => {
    const store = new FakeStore(section())
    await persistModelSave(store, 'myroute', 'm1', { efforts: EFFORTS, contextWindow: 120000 })
    expect(store.writeCount).toBe(1)
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1', contextWindow: 120000, reasoningEfforts: EFFORTS }])
  })

  it('does not write when both parts already match', async () => {
    const s = section()
    s.providers!.myroute!.models![0] = { id: 'm1', contextWindow: 8000, reasoningEfforts: EFFORTS }
    const store = new FakeStore(s)
    await persistModelSave(store, 'myroute', 'm1', { efforts: EFFORTS, contextWindow: 8000 })
    expect(store.writeCount).toBe(0) // no-op Save must not churn the revision
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1', contextWindow: 8000, reasoningEfforts: EFFORTS }])
  })

  it('skips quietly when the route is not in the section', async () => {
    const store = new FakeStore(section())
    await persistModelSave(store, 'ghost-route', 'm1', { contextWindow: 8000 })
    expect(store.writeCount).toBe(0)
  })

  it('re-reads and retries once after a single conflict', async () => {
    const store = new FakeStore(section())
    store.conflictsLeft = 1 // first write conflicts, second succeeds
    await persistModelSave(store, 'myroute', 'm2', { contextWindow: 8000 })
    expect(store.writeCount).toBe(1)
    expect(store.section.providers?.['myroute']?.models).toEqual([{ id: 'm1' }, { id: 'm2', contextWindow: 8000 }])
  })

  it('propagates the error when two consecutive conflicts occur', async () => {
    const store = new FakeStore(section())
    store.conflictsLeft = 2 // both attempts conflict
    await expect(persistModelSave(store, 'myroute', 'm2', { contextWindow: 8000 })).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    expect(store.writeCount).toBe(0)
  })
})
