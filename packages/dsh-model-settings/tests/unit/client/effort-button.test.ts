import { describe, it, expect } from 'vitest'
import { currentReasoning, effortChoices, effortLabel } from '../../../src/client/effort-button.ts'

const REASONING = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'low',
}

const STATE = {
  current: { provider: 'urabe', model: 'Zed-Qwen3.8-27B' },
  groups: [
    { id: 'urabe', name: 'Urabe', models: [{ id: 'Zed-Qwen3.8-27B', reasoning: REASONING }] },
    { id: 'other', name: 'Other', models: [{ id: 'X' }] },
  ],
}

describe('effort-button (pure client logic)', () => {
  it('currentReasoning finds the current model’s reasoning info', () => {
    expect(currentReasoning(STATE)).toEqual(REASONING)
  })

  it('currentReasoning is undefined when there is no current selection', () => {
    expect(currentReasoning({ ...STATE, current: null })).toBeUndefined()
  })

  it('currentReasoning is undefined when the model has no reasoning', () => {
    const state = { ...STATE, current: { provider: 'other', model: 'X' } }
    expect(currentReasoning(state)).toBeUndefined()
  })

  it('effortChoices lists offered efforts; adds a provider-default row only when defaultEffort is absent', () => {
    expect(effortChoices(REASONING)).toEqual([
      { key: 'effort:low', effort: 'low', label: 'Low' },
      { key: 'effort:high', effort: 'high', label: 'High' },
    ])
    const noDefault = { efforts: REASONING.efforts, defaultEffort: undefined }
    expect(effortChoices(noDefault)).toEqual([
      { key: 'provider-default', effort: undefined, label: 'Provider default' },
      { key: 'effort:low', effort: 'low', label: 'Low' },
      { key: 'effort:high', effort: 'high', label: 'High' },
    ])
  })

  it('effortLabel resolves the effective effort to a display name', () => {
    expect(effortLabel(REASONING, { provider: 'p', model: 'm', reasoningEffort: 'high' })).toBe('High')
    // no explicit selection → falls back to the default effort
    expect(effortLabel(REASONING, { provider: 'p', model: 'm' })).toBe('Low')
  })

  it('effortLabel reports “Provider default” when there is no default and no selection', () => {
    const noDefault = { efforts: REASONING.efforts, defaultEffort: undefined }
    expect(effortLabel(noDefault, { provider: 'p', model: 'm' })).toBe('Provider default')
  })

  it('effortLabel is undefined when the model has no reasoning', () => {
    expect(effortLabel(undefined, { provider: 'p', model: 'm' })).toBeUndefined()
  })
})
