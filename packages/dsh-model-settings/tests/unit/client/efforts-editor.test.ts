import { describe, it, expect } from 'vitest'
import { draftsDirty, draftsFromEfforts, effortsFromDrafts, validateEffortsClient } from '../../../src/client/efforts-editor.ts'

describe('efforts-editor (pure client logic)', () => {
  it('draftsFromEfforts copies stored values for offered levels', () => {
    const drafts = draftsFromEfforts({ low: 'low', high: 'high', off: null })
    expect(drafts.low).toEqual({ offered: true, wire: 'low' })
    expect(drafts.high).toEqual({ offered: true, wire: 'high' })
    expect(drafts.off).toEqual({ offered: true, wire: '' })
  })

  it('draftsFromEfforts pre-fills an unoffered level with the level name', () => {
    // A level not in the mapping is not offered, but its field is pre-filled with
    // the level name (the wire value that usually matches) so checking it on is
    // immediately valid.
    const drafts = draftsFromEfforts({ low: 'low' })
    expect(drafts.medium).toEqual({ offered: false, wire: 'medium' })
  })

  it('draftsFromEfforts treats an absent mapping as all-unoffered, name-prefilled', () => {
    const drafts = draftsFromEfforts(undefined)
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(drafts[level]).toEqual({ offered: false, wire: level })
    }
  })

  it('a freshly-offered level is immediately valid (pre-filled wire)', () => {
    const drafts = draftsFromEfforts(undefined)
    drafts.low.offered = true // its wire was already pre-filled to 'low'
    expect(validateEffortsClient(effortsFromDrafts(drafts))).toEqual([])
  })

  it('effortsFromDrafts keeps only offered levels; "off" maps to null', () => {
    const drafts = draftsFromEfforts(undefined)
    drafts.low.offered = true
    drafts.high.offered = true
    drafts.off.offered = true
    // pre-filled wires are the level names, so nothing needs editing
    expect(effortsFromDrafts(drafts)).toEqual({ low: 'low', high: 'high', off: null })
  })

  it('validateEffortsClient accepts a valid mapping (>=1 non-off level)', () => {
    expect(validateEffortsClient({ low: 'low', off: null })).toEqual([])
  })

  it('validateEffortsClient rejects an all-off / empty mapping', () => {
    const errors = validateEffortsClient({ off: null })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('validateEffortsClient rejects a non-off level with an empty wire value', () => {
    const errors = validateEffortsClient({ low: '' })
    expect(errors.some(e => e.includes('low'))).toBe(true)
  })

  describe('draftsDirty', () => {
    it('is false when the drafts are untouched', () => {
      const stored = { low: 'low', high: 'high' }
      expect(draftsDirty(draftsFromEfforts(stored), stored)).toBe(false)
    })

    it('is false for an absent mapping left untouched', () => {
      expect(draftsDirty(draftsFromEfforts(undefined), undefined)).toBe(false)
    })

    it('ignores key order in the stored mapping', () => {
      const stored = { high: 'high', low: 'low' }
      expect(draftsDirty(draftsFromEfforts(stored), stored)).toBe(false)
    })

    it('is true when a level is checked on', () => {
      const drafts = draftsFromEfforts({ low: 'low' })
      drafts.medium.offered = true
      expect(draftsDirty(drafts, { low: 'low' })).toBe(true)
    })

    it('is true when an offered level is unchecked', () => {
      const drafts = draftsFromEfforts({ low: 'low' })
      drafts.low.offered = false
      expect(draftsDirty(drafts, { low: 'low' })).toBe(true)
    })

    it('is true when an offered wire value changes', () => {
      const drafts = draftsFromEfforts({ low: 'low' })
      drafts.low.wire = 'custom'
      expect(draftsDirty(drafts, { low: 'low' })).toBe(true)
    })

    it('is false again when the change is reverted', () => {
      const stored = { low: 'low' }
      const drafts = draftsFromEfforts(stored)
      drafts.medium.offered = true
      drafts.medium.offered = false
      expect(draftsDirty(drafts, stored)).toBe(false)
    })
  })
})
