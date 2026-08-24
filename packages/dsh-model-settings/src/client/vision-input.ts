/**
 * The vision checkbox's draft logic (browser half): the checkbox state is a
 * boolean over the model's stored `input` list, and a save writes one of two
 * canonical lists. Keeping the spellings here (rather than in the component)
 * makes them unit-testable without a DOM and guarantees the host's
 * `text`-always-present invariant at the source.
 */

/** The modalities a vision-capable model carries; `text` is always present (mirrors the Host autofill spelling). */
export const VISION_INPUT: readonly string[] = ['text', 'image']

/** The explicit text-only spelling: written on uncheck so the key is never absent. */
export const TEXT_INPUT: readonly string[] = ['text']

/** True when the stored list declares image input; an absent or empty list is not vision-capable. */
export function hasVisionInput(input?: readonly string[]): boolean {
  if (input === undefined) return false
  return input.includes('image')
}

/** The modality list to write for the checkbox state: vision → `[text, image]`, uncheck → `[text]`. */
export function inputForVision(vision: boolean): string[] {
  return vision ? [...VISION_INPUT] : [...TEXT_INPUT]
}
