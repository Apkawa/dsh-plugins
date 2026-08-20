import { describe, expect, it } from 'vitest'
import { roundDown } from '../src/round.ts'

describe('roundDown', () => {
  // Floor to the nearest thousand; values at or below 1000 are kept as-is.
  it.each([
    [21345, 21000],
    [120064, 120000],
    [8192, 8000],
    [1000, 1000],
    [999, 999],
  ])('floors %p to %p', (input, expected) => {
    expect(roundDown(input)).toBe(expected)
  })

  it('keeps a value just above a thousand at that thousand', () => {
    expect(roundDown(1001)).toBe(1000)
    expect(roundDown(1999)).toBe(1000)
    expect(roundDown(2000)).toBe(2000)
  })

  it('skips non-positive and non-finite inputs', () => {
    expect(roundDown(0)).toBeNull()
    expect(roundDown(-5)).toBeNull()
    expect(roundDown(NaN)).toBeNull()
    expect(roundDown(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
