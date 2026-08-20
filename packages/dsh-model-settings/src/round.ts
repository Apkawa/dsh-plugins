/**
 * Floor an n_ctx value down to the nearest thousand so a route never claims
 * more context than it actually has. Values at or below 1000 are returned
 * unchanged; any non-finite or non-positive input yields `null` so a caller
 * can treat it as "no usable context size" and skip.
 * @param nCtx - the raw context size read from llama.cpp `/props`.
 * @returns the floored size, or `null` when the input is unusable.
 */
export function roundDown(nCtx: number): number | null {
  if (!Number.isFinite(nCtx) || nCtx <= 0) return null
  const value = Math.floor(nCtx)
  return value <= 1000 ? value : Math.floor(value / 1000) * 1000
}
