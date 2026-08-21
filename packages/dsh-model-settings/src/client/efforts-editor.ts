/**
 * Pure logic for the reasoning section's per-model editor. It converts between
 * the stored mapping (`reasoningEfforts`) and the editor's per-level drafts, and
 * validates a draft before it is sent — mirroring the Host `efforts` rules so the
 * user gets immediate feedback without a round-trip. No React, no runtime imports
 * beyond the level list: unit-testable in node.
 */

import { THINKING_LEVELS, type ReasoningEfforts } from './reasoning-controller.ts'

/** One level's editor state: whether it is offered and the wire value to send. */
export interface LevelDraft {
  /** True when this level is offered to dsh (present in the saved mapping). */
  offered: boolean
  /** The wire string sent for a non-off level; ignored for `off` (which sends nothing). */
  wire: string
}

/**
 * Initialize the editor drafts from a stored mapping. A level present in the
 * mapping is offered with its stored wire value; one absent from it is unoffered
 * but pre-filled with the level name — the wire value that usually matches — so
 * checking it on is immediately valid instead of tripping "non-empty wire value".
 */
export function draftsFromEfforts(efforts?: ReasoningEfforts): Record<string, LevelDraft> {
  const drafts: Record<string, LevelDraft> = {}
  for (const level of THINKING_LEVELS) {
    const value = efforts?.[level]
    drafts[level] = value !== undefined ? { offered: true, wire: value === null ? '' : String(value) } : { offered: false, wire: level }
  }
  return drafts
}

/** True when the user changed anything in the level editor versus what is stored. */
export function draftsDirty(drafts: Record<string, LevelDraft>, stored?: ReasoningEfforts): boolean {
  const base = draftsFromEfforts(stored)
  return THINKING_LEVELS.some(level => {
    const draft = drafts[level] ?? { offered: false, wire: '' }
    const stored_ = base[level] ?? { offered: false, wire: '' }
    return draft.offered !== stored_.offered || draft.wire !== stored_.wire
  })
}

/** Build the mapping to save from the drafts: only offered levels; `off` → null. */
export function effortsFromDrafts(drafts: Record<string, LevelDraft>): ReasoningEfforts {
  const efforts: ReasoningEfforts = {}
  for (const level of THINKING_LEVELS) {
    const draft = drafts[level]
    if (draft === undefined || !draft.offered) continue
    efforts[level] = level === 'off' ? null : draft.wire
  }
  return efforts
}

/**
 * Validate a mapping against the Host rules before sending: at least one non-off
 * level must be offered, and an offered non-off level needs a non-empty wire value.
 * Returns human-readable errors (empty when valid).
 */
export function validateEffortsClient(efforts: ReasoningEfforts): string[] {
  const errors: string[] = []
  let nonOff = false
  for (const level of THINKING_LEVELS) {
    if (!(level in efforts)) continue
    if (level !== 'off') nonOff = true
    const value = efforts[level]
    if (value === null && level !== 'off') errors.push(`"${level}" may only be null for "off"`)
    else if (typeof value === 'string' && value.length === 0) errors.push(`"${level}" needs a non-empty wire value`)
  }
  if (!nonOff) errors.push('offer at least one thinking level beyond "off"')
  return errors
}
