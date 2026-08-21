/**
 * Field text ↔ token-count conversion for the context-window field, mirroring
 * dsh Models editor capacity notation: a user reads 64000 as `64K` and may type
 * `120K` instead of counting zeroes. The stored value stays a plain integer
 * token count.
 */

/** Accepted spellings: a decimal count with an optional K/M suffix, Latin or Cyrillic (Russian keyboard). */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([kKmMкКмМ])?$/

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE: Record<string, number> = { k: 1_000, m: 1_000_000, к: 1_000, м: 1_000_000 }

/**
 * Read a typed context window so a user can write `256K` or `1M`.
 * @param text - raw field text.
 * @returns the count; `undefined` when blank (unchanged), `NaN` when unreadable.
 */
export function parseContextWindow(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  // The pattern only admits k/m spellings, so the lookup is total; `?? 1` keeps it honest.
  const scale = suffix !== undefined ? CAPACITY_SCALE[suffix] ?? 1 : 1
  const scaled = Number(match[1]) * scale
  // A decimal multiple is exact in intent but not in binary floating point
  // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * Spell a stored count in the shortest form that survives a round trip through
 * {@link parseContextWindow}; counts that are not a whole number of thousands
 * stay written out.
 * @param value - stored context window.
 * @returns the field text.
 */
export function formatContextWindow(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % 1_000_000 === 0) return `${String(value / 1_000_000)}M`
  if (value % 1_000 === 0) return `${String(value / 1_000)}K`
  return String(value)
}
