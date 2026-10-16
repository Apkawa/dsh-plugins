import { Log } from '@apkawa/utils'
import { fetchModels, type Fetcher } from './probe.ts'
import { contextWindowFromEntry, entrySupportsVision, type ModelEntry } from './props.ts'
import { roundDown } from './round.ts'
import { isCandidateRoute, type LlmModelEntry, type LlmRouteProfile, type SettingsStore } from './settings-io.ts'
import { persistModelSave, type ModelSaveParts } from './model-save.ts'

const logger = new Log('model-settings')

/** Options for one autofill round. */
export interface AutofillOptions {
  /** The settings seam to read candidates from and write the fills to. */
  store: SettingsStore
  /** The fetch seam used to list `/v1/models` (production: global fetch). */
  fetcher: Fetcher
  /** Resolve a route's Bearer key (from its `apiKeyEnv`); absent means unauthenticated. */
  apiKeyFor?: (route: LlmRouteProfile) => string | undefined
}

/** The canonical list written for a vision-capable model; `text` is always present. */
const VISION_INPUT: readonly string[] = ['text', 'image']

/** True when the model already carries a usable (positive) contextWindow. */
function hasNonzeroContextWindow(model: LlmModelEntry): boolean {
  return typeof model.contextWindow === 'number' && model.contextWindow > 0
}

/** True for a non-empty stored `input` list — a user or autofill decision, never overwritten. */
function hasExplicitInput(model: LlmModelEntry): boolean {
  return Array.isArray(model.input) && model.input.length > 0
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

/** Build the set of model ids the listing declares vision-capable (`architecture.input_modalities`). */
function visionIdsFromListing(entries: ModelEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (typeof entry.id === 'string' && entrySupportsVision(entry)) ids.add(entry.id)
  }
  return ids
}

/**
 * Run one autofill round. For each candidate route it fetches the `/v1/models`
 * listing once and, per model, fills whichever parts are missing: a contextWindow
 * for models without a nonzero one that carry a `ctx-size`/`fit-ctx` in the listing
 * (rounded down), and an `input` of `[text, image]` for models without an explicit
 * list whose entry declares image input. A part is never overwritten once stored.
 * Routes whose models are all already sized and have an explicit input are skipped
 * entirely — that is the self-cycle guard, so our own write never schedules another
 * round (a route whose endpoint reports no modalities stays unsettled and is
 * re-listed, but never re-written). Every failure — a failed or timed-out listing,
 * or a refused write — skips that model quietly; nothing leaks to the caller, and
 * the next round retries what was skipped.
 */
export async function autofill(options: AutofillOptions): Promise<void> {
  logger.debug('autofill: round start')
  const section = options.store.read().value
  for (const [routeId, route] of Object.entries(section.providers ?? {})) {
    if (!isCandidateRoute(route)) {
      logger.debug(`autofill: route "${routeId}" not a candidate (api=${route.api} baseURL=${route.baseURL}), skip`)
      continue
    }
    const baseURL = route.baseURL
    if (typeof baseURL !== 'string' || baseURL.length === 0) continue // isCandidateRoute already checked; belt and braces
    const models = route.models ?? []
    // Self-cycle guard: a route whose models are all sized and modalized has nothing to fetch.
    if (models.every(m => hasNonzeroContextWindow(m) && hasExplicitInput(m))) {
      logger.debug(`autofill: route "${routeId}" all ${models.length} models already sized and modalized, skip`)
      continue
    }

    logger.debug(`autofill: route "${routeId}" baseURL=${baseURL} models=[${models.map(m => m.id).join(', ')}]`)
    const apiKey = options.apiKeyFor?.(route)
    const fetchOptions = apiKey === undefined ? undefined : { apiKey }
    // Throws on failure → propagates to the watcher's .catch (we log it there).
    const entries = await fetchModels(options.fetcher, baseURL, fetchOptions)

    logger.debug(`autofill: got ${entries.length} models from listing`)
    const sizes = contextSizesFromListing(entries)
    logger.debug('autofill: parsed sizes:', JSON.stringify(sizes))
    const vision = visionIdsFromListing(entries)
    for (const model of models) {
      const parts: ModelSaveParts = {}
      if (!hasNonzeroContextWindow(model)) {
        const raw = sizes[model.id]
        const rounded = raw === undefined ? null : roundDown(raw)
        if (rounded !== null) parts.contextWindow = rounded
      }
      if (!hasExplicitInput(model) && vision.has(model.id)) parts.input = [...VISION_INPUT]
      const partNames = Object.keys(parts)
      if (partNames.length === 0) {
        logger.debug(`autofill: model "${model.id}" has nothing to fill, skip`)
        continue
      }
      logger.debug(`autofill: filling model "${model.id}" (${partNames.join(', ')})`)
      try {
        await persistModelSave(options.store, routeId, model.id, parts)
      } catch (err) {
        logger.error(`autofill: persist failed for "${model.id}":`, err)
      }
    }
  }
  logger.debug('autofill: round end')
}
