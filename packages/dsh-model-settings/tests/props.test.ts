import { describe, expect, it } from 'vitest'
import { parseProps } from '../src/props.ts'

// A compact slice of the live llama.cpp /props reply recorded in
// docs/specs/model-settings/draft.md: default_generation_settings carries
// n_ctx + params; modalities sits at the top level.
const FIXTURE = JSON.stringify({
  default_generation_settings: {
    params: { temperature: 0.699999988079071, top_k: 20 },
    n_ctx: 120064,
  },
  modalities: { vision: false, video: false, audio: false },
})

describe('parseProps', () => {
  it('extracts nCtx, params and modalities from a /props body', () => {
    expect(parseProps(FIXTURE)).toEqual({
      nCtx: 120064,
      params: { temperature: 0.699999988079071, top_k: 20 },
      modalities: { vision: false, video: false, audio: false },
    })
  })

  it('omits params/modalities when absent', () => {
    expect(parseProps(JSON.stringify({ default_generation_settings: { n_ctx: 8192 } }))).toEqual({
      nCtx: 8192,
    })
  })

  it('returns null when n_ctx is absent', () => {
    expect(parseProps(JSON.stringify({ default_generation_settings: { params: {} } }))).toBeNull()
  })

  it('returns null when n_ctx is not a positive integer', () => {
    expect(parseProps(JSON.stringify({ default_generation_settings: { n_ctx: 0 } }))).toBeNull()
    expect(parseProps(JSON.stringify({ default_generation_settings: { n_ctx: -10 } }))).toBeNull()
    expect(parseProps(JSON.stringify({ default_generation_settings: { n_ctx: 'big' } }))).toBeNull()
  })

  it('returns null for non-JSON and empty bodies', () => {
    expect(parseProps('this is not json')).toBeNull()
    expect(parseProps('')).toBeNull()
  })
})
