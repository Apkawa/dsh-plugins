import { fetchModels, type Fetcher } from './probe.ts'
import { contextWindowFromEntry, type ModelEntry } from './props.ts'
import { roundDown } from './round.ts'
import { isCandidateRoute, persistModels, type LlmModelEntry, type LlmRouteProfile, type SettingsStore } from './settings-io.ts'

/** Options for one autofill round. */
export interface AutofillOptions {
  /** The settings seam to read candidates from and write contextWindow to. */
  store: SettingsStore
  /** The fetch seam used to list `/v1/models` (production: global fetch). */
  fetcher: Fetcher
  /** Resolve a route's Bearer key (from its `apiKeyEnv`); absent means unauthenticated. */
  apiKeyFor?: (route: LlmRouteProfile) => string | undefined
}

/** True when the model already carries a usable (positive) contextWindow. */
function hasNonzeroContextWindow(model: LlmModelEntry): boolean {
  return typeof model.contextWindow === 'number' && model.contextWindow > 0
}

/** Build a map of modelId → context size from a listing, using ctx-size else fit-ctx. */
function contextSizesFromListing(entries: ModelEntry[]): Record<string, number> {
  const sizes: Record<string, number> = {}
  for (const entry of entries) {
    if (typeof entry.id !== 'string') continue
    const size = contextWindowFromEntry(entry)
    if (size !== null) sizes[entry.id] = size
  }
  return sizes
}

/**
 * Run one autofill round. For each candidate route it fetches the `/v1/models`
 * listing once and writes a contextWindow for every model that has no nonzero one
 * yet but carries a `ctx-size`/`fit-ctx` in the listing (rounded down). Routes whose
 * models are all already sized are skipped entirely — that is the self-cycle guard,
 * so our own write never schedules another round. Every failure — a failed or
 * timed-out listing, or a refused write — skips that model quietly; nothing leaks to
 * the caller, and the next round retries what was skipped.
 */
export async function autofill(options: AutofillOptions): Promise<void> {
  const section = options.store.read().value
  for (const [routeId, route] of Object.entries(section.providers ?? {})) {
    if (!isCandidateRoute(route)) continue
    const baseURL = route.baseURL
    if (typeof baseURL !== 'string' || baseURL.length === 0) continue // isCandidateRoute already checked; belt and braces
    const models = route.models ?? []
    // Self-cycle guard: a route whose models are all sized has nothing to fetch.
    if (models.every(hasNonzeroContextWindow)) continue

    const apiKey = options.apiKeyFor?.(route)
    const fetchOptions = apiKey === undefined ? undefined : { apiKey }
    const entries = await fetchModels(options.fetcher, baseURL, fetchOptions)
    if (entries === null) continue // not llama.cpp / failed; skip quietly

    const sizes = contextSizesFromListing(entries)
    for (const model of models) {
      if (hasNonzeroContextWindow(model)) continue // user override or already sized
      const raw = sizes[model.id]
      if (raw === undefined) continue // no ctx-size / fit-ctx in the listing
      const rounded = roundDown(raw)
      if (rounded === null) continue
      try {
        await persistModels(options.store, routeId, model.id, rounded)
      } catch {
        // skip this model; the next round retries it
      }
    }
  }
}
