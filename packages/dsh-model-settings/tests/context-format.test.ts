/**
 * Unit tests for the context-window field's text ↔ count conversion (client half).
 * Mirrors dsh Models editor capacity notation — a user reads 64000 as `64K` and
 * may type `120K` instead of counting zeroes; the stored value stays a plain
 * integer token count.
 */

import { describe, expect, it } from 'vitest'
import { formatContextWindow, parseContextWindow } from '../src/client/context-format.ts'

describe('formatContextWindow', () => {
  it('spells whole thousands with K', () => {
    expect(formatContextWindow(20_000)).toBe('20K')
    expect(formatContextWindow(64_000)).toBe('64K')
    expect(formatContextWindow(128_000)).toBe('128K')
  })

  it('spells whole millions with M', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M')
    expect(formatContextWindow(8_000_000)).toBe('8M')
  })

  it('keeps counts that are not a whole number of thousands written out', () => {
    expect(formatContextWindow(123_456)).toBe('123456')
    expect(formatContextWindow(1_234_567)).toBe('1234567')
  })

  it('passes through unusable values as-is', () => {
    expect(formatContextWindow(0)).toBe('0')
    expect(formatContextWindow(1.5)).toBe('1.5')
  })
})

describe('parseContextWindow', () => {
  it('reads a plain count', () => {
    expect(parseContextWindow('64000')).toBe(64_000)
  })

  it('reads K and M suffixes case-insensitively', () => {
    expect(parseContextWindow('120K')).toBe(120_000)
    expect(parseContextWindow('120k')).toBe(120_000)
    expect(parseContextWindow('1M')).toBe(1_000_000)
  })

  it('reads Cyrillic K/M spellings (Russian keyboard)', () => {
    expect(parseContextWindow('120К')).toBe(120_000)
    expect(parseContextWindow('1М')).toBe(1_000_000)
  })

  it('reads decimal multiples and snaps integral intent', () => {
    expect(parseContextWindow('1.5K')).toBe(1_500)
    expect(parseContextWindow('2.3M')).toBe(2_300_000)
  })

  it('returns undefined for blank text (unchanged)', () => {
    expect(parseContextWindow('')).toBeUndefined()
    expect(parseContextWindow('   ')).toBeUndefined()
  })

  it('returns NaN for unreadable text', () => {
    expect(Number.isNaN(parseContextWindow('abc'))).toBe(true)
    expect(Number.isNaN(parseContextWindow('12K3'))).toBe(true)
    expect(Number.isNaN(parseContextWindow('-5K'))).toBe(true)
  })
})
