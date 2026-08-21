import { describe, it, expect } from 'vitest'
import {
  THINKING_LEVELS,
  planReasoningWrite,
  validateEfforts,
  persistReasoning,
  type ReasoningEfforts,
} from '../src/efforts.ts'
import { type SettingsStore, type LlmModelEntry, type LlmSection } from '../src/settings-io.ts'

/** A route profile as stored in the llm-pi-ai section. */
type Route = { api?: string; baseURL?: string; apiKeyEnv?: string; models?: LlmModelEntry[] }

describe('THINKING_LEVELS', () => {
  it('matches the dsh escalation order (off through max)', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })
})

describe('planReasoningWrite (§3.2 explicit edit)', () => {
  const efforts: ReasoningEfforts = { low: 'low', high: 'high', xhigh: 'max' }

  it('creates a model entry when absent, appending at the end', () => {
    const res = planReasoningWrite([{ id: 'A' }], 'B', efforts)
    expect(res.changed).toBe(true)
    expect(res.models).toEqual([{ id: 'A' }, { id: 'B', reasoningEfforts: efforts }])
  })

  it('sets reasoningEfforts on an existing entry that has none yet', () => {
    const res = planReasoningWrite([{ id: 'A', name: 'Model A', contextWindow: 80000 }], 'A', efforts)
    expect(res.changed).toBe(true)
    // sibling fields are preserved; only reasoningEfforts is added
    expect(res.models).toEqual([{ id: 'A', name: 'Model A', contextWindow: 80000, reasoningEfforts: efforts }])
  })

  it('replaces an existing mapping (an explicit edit always wins)', () => {
    const res = planReasoningWrite(
      [{ id: 'A', reasoningEfforts: { low: 'low' }, contextWindow: 4096 }],
      'A',
      { medium: 'medium' },
    )
    expect(res.changed).toBe(true)
    expect(res.models[0]).toEqual({ id: 'A', contextWindow: 4096, reasoningEfforts: { medium: 'medium' } })
  })

  it('is a no-op (changed:false) when the mapping is already identical', () => {
    const res = planReasoningWrite([{ id: 'A', reasoningEfforts: efforts }], 'A', efforts)
    expect(res.changed).toBe(false)
    expect(res.models).toEqual([{ id: 'A', reasoningEfforts: efforts }])
  })

  it('does not disturb other model entries or their order', () => {
    const res = planReasoningWrite([{ id: 'X' }, { id: 'Y', contextWindow: 4096 }], 'Z', efforts)
    expect(res.models).toEqual([{ id: 'X' }, { id: 'Y', contextWindow: 4096 }, { id: 'Z', reasoningEfforts: efforts }])
  })

  it('never mutates its input list or entries', () => {
    const input: LlmModelEntry[] = [{ id: 'A' }]
    planReasoningWrite(input, 'A', efforts)
    expect(input).toEqual([{ id: 'A' }])
  })

  describe('clearing (an empty mapping)', () => {
    it('replaces a stored mapping with reasoningEfforts:false (dsh non-reasoning spelling)', () => {
      const res = planReasoningWrite([{ id: 'A', reasoningEfforts: { low: 'low' }, contextWindow: 4096 }], 'A', {})
      expect(res.changed).toBe(true)
      expect(res.models).toEqual([{ id: 'A', contextWindow: 4096, reasoningEfforts: false }])
    })

    it('is a no-op (changed:false) when the entry already carries false', () => {
      const res = planReasoningWrite([{ id: 'A', reasoningEfforts: false }], 'A', {})
      expect(res.changed).toBe(false)
      expect(res.models).toEqual([{ id: 'A', reasoningEfforts: false }])
    })

    it('creates an entry with false when the model is absent', () => {
      const res = planReasoningWrite([], 'B', {})
      expect(res.changed).toBe(true)
      expect(res.models).toEqual([{ id: 'B', reasoningEfforts: false }])
    })
  })
})

describe('validateEfforts (mirrors dsh rules)', () => {
  it('accepts a mapping that offers at least one non-off level', () => {
    expect(validateEfforts({ low: 'low', high: 'high', xhigh: 'max' })).toEqual([])
  })

  it('accepts an off-with-null alongside real levels (send-nothing option)', () => {
    expect(validateEfforts({ low: 'low', off: null })).toEqual([])
  })

  it('accepts an empty mapping (the clear spelling for a non-reasoning model)', () => {
    expect(validateEfforts({})).toEqual([])
  })

  it('rejects a mapping that offers only "off" (no level beyond off)', () => {
    expect(validateEfforts({ off: null })).not.toEqual([])
  })

  it('rejects a null wire value on a non-off level', () => {
    expect(validateEfforts({ low: null, high: 'high' })).not.toEqual([])
  })

  it('rejects an empty-string wire value', () => {
    expect(validateEfforts({ low: '' })).not.toEqual([])
  })

  it('reports one error per offending level', () => {
    const errors = validateEfforts({ low: null, medium: '', high: 'high' })
    // low (null on non-off) + medium (empty string); high is fine
    expect(errors.length).toBe(2)
  })
})

/** In-memory SettingsStore double; mirrors the settings-io test. */
class FakeStore implements SettingsStore {
  section: LlmSection
  revision = 1
  conflictsLeft = 0
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

describe('persistReasoning (fenced write + single retry)', () => {
  const baseSection = (): LlmSection => ({
    providers: {
      myroute: { api: 'openai-completions', baseURL: 'http://x/v1', models: [{ id: 'm1' }, { id: 'm2', contextWindow: 8000 }] },
    },
  })

  it('writes reasoningEfforts for a model on a clean revision', async () => {
    const store = new FakeStore(baseSection())
    await persistReasoning(store, 'myroute', 'm1', { low: 'low', high: 'high' })
    expect(store.section.providers!.myroute.models![0]).toEqual({ id: 'm1', reasoningEfforts: { low: 'low', high: 'high' } })
    // sibling model untouched
    expect(store.section.providers!.myroute.models![1]).toEqual({ id: 'm2', contextWindow: 8000 })
  })

  it('appends a model entry that is absent from the list', async () => {
    const store = new FakeStore(baseSection())
    await persistReasoning(store, 'myroute', 'm3', { high: 'high' })
    expect(store.section.providers!.myroute.models![2]).toEqual({ id: 'm3', reasoningEfforts: { high: 'high' } })
  })

  it('skips quietly when the route is not in the section', async () => {
    const store = new FakeStore(baseSection())
    await persistReasoning(store, 'ghost-route', 'm1', { low: 'low' })
    expect(store.writeCount).toBe(0)
  })

  it('retries once after a single conflict and lands the write', async () => {
    const store = new FakeStore(baseSection())
    store.conflictsLeft = 1
    await persistReasoning(store, 'myroute', 'm1', { low: 'low' })
    expect(store.writeCount).toBe(1)
    expect(store.section.providers!.myroute.models![0]).toEqual({ id: 'm1', reasoningEfforts: { low: 'low' } })
  })

  it('gives up after a second conflict (SETTINGS_CONFLICT)', async () => {
    const store = new FakeStore(baseSection())
    store.conflictsLeft = 2
    await expect(persistReasoning(store, 'myroute', 'm1', { low: 'low' })).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  })

  it('propagates non-conflict errors as-is', async () => {
    const store = new FakeStore(baseSection())
    const err = new Error('schema rejected')
    store.forceError = err
    await expect(persistReasoning(store, 'myroute', 'm1', { low: 'low' })).rejects.toBe(err)
  })
})
