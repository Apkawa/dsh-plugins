import { describe, expect, it } from 'vitest'
import { contextWindowFromEntry, parseProps, parsePreset } from '../../../src/props.ts'

describe('parseProps (deferred per-model /probe)', () => {
  const FIXTURE = JSON.stringify({
    default_generation_settings: { params: { temperature: 0.7 }, n_ctx: 120064 },
    modalities: { vision: false, video: false, audio: false },
  })

  it('extracts nCtx, params and modalities from a /props body', () => {
    expect(parseProps(FIXTURE)).toEqual({
      nCtx: 120064,
      params: { temperature: 0.7 },
      modalities: { vision: false, video: false, audio: false },
    })
  })

  it('returns null when n_ctx is absent or not a positive integer', () => {
    expect(parseProps(JSON.stringify({ default_generation_settings: { params: {} } }))).toBeNull()
    expect(parseProps(JSON.stringify({ default_generation_settings: { n_ctx: 0 } }))).toBeNull()
    expect(parseProps('not json')).toBeNull()
    expect(parseProps('')).toBeNull()
  })
})

// A realistic llama-server INI preset as recorded in the live /v1/models listing
// (docs/specs/v1): ctx-size is the explicit prompt-context size; fit-ctx is the
// --fit floor and only a fallback. Other keys are ignored by v1.
const PRESET_WITH_CTX = [
  '[empero-ai_Qwen3.8-27B-Ridge-3.7bpw]',
  'chat-template-kwargs = {"reasoning_effort": "medium"}',
  'jinja = 1',
  'temperature = 0.7',
  'top-k = 20',
  'ctx-size = 120000',
  'cache-type-k = q8_0',
  'n-gpu-layers = 999',
].join('\n')

const PRESET_FIT_ONLY = [
  '[Zed-Qwen3.8-27B]',
  'jinja = 1',
  'fit-ctx = 4096',
  'temperature = 0.7',
].join('\n')

describe('parsePreset', () => {
  it('extracts ctx-size from an INI preset', () => {
    expect(parsePreset(PRESET_WITH_CTX)).toEqual({ ctxSize: 120000 })
  })

  it('extracts fit-ctx when there is no ctx-size', () => {
    expect(parsePreset(PRESET_FIT_ONLY)).toEqual({ fitCtx: 4096 })
  })

  it('extracts both when both are present', () => {
    expect(parsePreset(`${PRESET_WITH_CTX}\nfit-ctx = 8192`)).toEqual({ ctxSize: 120000, fitCtx: 8192 })
  })

  it('returns {} for an empty or absent preset', () => {
    expect(parsePreset('')).toEqual({})
    expect(parsePreset(undefined)).toEqual({})
  })

  it('returns {} when neither key appears', () => {
    expect(parsePreset('[x]\ntemperature = 0.7\njinja = 1')).toEqual({})
  })

  it('ignores non-integer values for the ctx keys', () => {
    expect(parsePreset('ctx-size = auto\nfit-ctx = on')).toEqual({})
  })
})

describe('contextWindowFromEntry', () => {
  it('prefers ctx-size over fit-ctx', () => {
    const entry = { status: { preset: `${PRESET_WITH_CTX}\nfit-ctx = 8192` } }
    expect(contextWindowFromEntry(entry)).toBe(120000)
  })

  it('falls back to fit-ctx when ctx-size is absent', () => {
    expect(contextWindowFromEntry({ status: { preset: PRESET_FIT_ONLY } })).toBe(4096)
  })

  it('returns null when neither key is present', () => {
    expect(contextWindowFromEntry({ status: { preset: '[x]\ntemperature = 0.7' } })).toBeNull()
    expect(contextWindowFromEntry({})).toBeNull()
    expect(contextWindowFromEntry({ status: {} })).toBeNull()
  })

  it('returns null for a zero or absent ctx-size', () => {
    expect(contextWindowFromEntry({ status: { preset: 'ctx-size = 0' } })).toBeNull()
    expect(contextWindowFromEntry({ status: { preset: 'fit-ctx = 0' } })).toBeNull()
  })
})
