import { describe, it, expect } from 'vitest'
import { hasVisionInput, inputForVision, TEXT_INPUT, VISION_INPUT } from '../../../src/client/vision-input.ts'

describe('vision-input', () => {
  it('hasVisionInput is true only when the stored list declares image', () => {
    expect(hasVisionInput(['text', 'image'])).toBe(true)
    expect(hasVisionInput(['image'])).toBe(true)
    expect(hasVisionInput(['text'])).toBe(false)
    expect(hasVisionInput([])).toBe(false)
    expect(hasVisionInput(undefined)).toBe(false)
  })

  it('inputForVision writes the canonical lists (text always present)', () => {
    expect(inputForVision(true)).toEqual(['text', 'image'])
    expect(inputForVision(false)).toEqual(['text'])
  })

  it('the canonical lists are frozen spellings and each call returns a fresh copy', () => {
    expect(VISION_INPUT).toEqual(['text', 'image'])
    expect(TEXT_INPUT).toEqual(['text'])
    const a = inputForVision(true)
    a.push('bogus') // mutating one write must not affect the canonical spelling
    expect(VISION_INPUT).toEqual(['text', 'image'])
    expect(inputForVision(true)).toEqual(['text', 'image'])
  })
})
