/** A successfully parsed llama.cpp `/props` reply (deferred per-model probe, §5). */
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
 * Parse and validate a llama.cpp `/props` body. The only field the deferred
 * per-model probe requires is `default_generation_settings.n_ctx` (a positive
 * integer); `params` and `modalities` are read for later stages but optional.
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

/** The context-related keys parsed out of a llama-server INI preset. */
export interface ParsedPreset {
  /** The explicit `--ctx-size` (the real prompt-context size), when present. */
  ctxSize?: number
  /** The `--fit-ctx` floor, used as a fallback when there is no `ctx-size`. */
  fitCtx?: number
}

/**
 * Parse the context keys out of a llama-server INI preset (the `status.preset`
 * field of a `/v1/models` entry). Lines look like `ctx-size = 120000`; only the
 * two integer keys v1 cares about are extracted, everything else is ignored.
 * @param preset - the INI text, or undefined when the entry has no preset.
 * @returns the found keys; `{}` when none apply.
 */
export function parsePreset(preset: string | undefined): ParsedPreset {
  if (typeof preset !== 'string' || preset.length === 0) return {}
  const result: ParsedPreset = {}
  for (const line of preset.split('\n')) {
    const match = line.match(/^\s*(ctx-size|fit-ctx)\s*=\s*(\d+)\s*$/)
    if (match === null) continue
    const value = Number(match[2])
    if (match[1] === 'ctx-size') result.ctxSize = value
    else result.fitCtx = value
  }
  return result
}

/** A minimal shape of a `/v1/models` listing entry, enough to read its context. */
export interface ModelEntry {
  id?: string
  status?: { preset?: string }
}

/**
 * Extract the context window from one `/v1/models` entry: prefer an explicit
 * `ctx-size`, fall back to `fit-ctx`. @returns the size, or `null` when neither
 * key is present or positive (the model's context is unknown from the listing).
 */
export function contextWindowFromEntry(entry: ModelEntry): number | null {
  const parsed = parsePreset(entry.status?.preset)
  if (parsed.ctxSize !== undefined && parsed.ctxSize > 0) return parsed.ctxSize
  if (parsed.fitCtx !== undefined && parsed.fitCtx > 0) return parsed.fitCtx
  return null
}
