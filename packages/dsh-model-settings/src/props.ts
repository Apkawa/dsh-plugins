/** A successfully parsed llama.cpp `/props` reply. */
export interface ParsedProps {
  /** The raw context size from `default_generation_settings.n_ctx`. */
  nCtx: number
  /** Sampling params; present only when the server returns them. */
  params?: Record<string, unknown>
  /** Modality flags at the top level of the reply. */
  modalities?: Record<string, unknown>
}

/** True for a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and validate a llama.cpp `/props` body. The only field v1 requires is
 * `default_generation_settings.n_ctx` (a positive integer); `params` and
 * `modalities` are read for later stages but are optional here.
 * @param body - the raw response text.
 * @returns the parsed values, or `null` when the body is unusable.
 */
export function parseProps(body: string): ParsedProps | null {
  if (body.length === 0) return null
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const root = isPlainObject(json) ? json : null
  if (root === null) return null
  const settings = root.default_generation_settings
  if (!isPlainObject(settings)) return null
  const nCtx = settings.n_ctx
  if (typeof nCtx !== 'number' || !Number.isInteger(nCtx) || nCtx <= 0) return null
  const result: ParsedProps = { nCtx }
  if (isPlainObject(settings.params)) result.params = settings.params
  if (isPlainObject(root.modalities)) result.modalities = root.modalities
  return result
}
