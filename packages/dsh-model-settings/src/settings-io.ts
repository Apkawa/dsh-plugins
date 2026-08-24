/**
 * Reading and writing the `llm-pi-ai` settings section. This module is the only
 * place that knows the on-disk shape of a route's models; it depends on the
 * injected {@link SettingsStore} (SOLID) so orchestration never touches the dsh
 * settings seam directly. The store is constructed in the composition root.
 */

/** One entry of a route's `models` list. `id`, `contextWindow`, and `input` are ours; the rest are preserved opaquely. */
export interface LlmModelEntry {
  id: string
  /** Context capacity; a positive integer once set by the user or by us. */
  contextWindow?: number
  /** Input modalities (`text`, `image`); set by the UI checkbox or autofill. An empty list means absent. */
  input?: string[]
  /** Fields we do not model (name, maxTokens, …) are carried through unchanged. */
  [key: string]: unknown
}

/** A route profile under `providers`; we only read `api`/`baseURL` and write `models`. */
export interface LlmRouteProfile {
  /** Wire protocol; a candidate is one of the openai-compatible or llama.cpp spellings. */
  api?: string
  /** Endpoint base; required for a route to be probed at all. */
  baseURL?: string
  /** Credential reference (env var name); never written back, so it is not modeled here. */
  apiKeyEnv?: string
  models?: LlmModelEntry[]
  [key: string]: unknown
}

/** The `llm-pi-ai` settings section we read and patch. */
export interface LlmSection {
  providers?: Record<string, LlmRouteProfile>
}

/**
 * The settings seam this module writes through. The composition root adapts the
 * dsh `ctx.settings` service to it; tests supply an in-memory double.
 */
export interface SettingsStore {
  /** Read the current section and its monotonic revision. */
  read(): Readonly<{ value: LlmSection; revision: number }>
  /**
   * Replace one route's models list, refusing a stale revision. A concurrent
   * write rejects with an error whose `code` is `SETTINGS_CONFLICT`.
   */
  setRouteModels(routeId: string, models: readonly LlmModelEntry[], expectedRevision: number): Promise<void>
}

/** Wire protocols that can serve llama.cpp `/props`; a route naming one is a candidate. */
const CANDIDATE_APIS: ReadonlySet<string> = new Set(['openai-completions', 'llama.cpp'])

/**
 * Structural candidate rule (§3.1): the route names an openai-compatible or
 * llama.cpp protocol and has a non-empty baseURL. Confirmation (that the endpoint
 * really serves `/props`) is decided later by the probe, not here.
 * @param route - the profile to judge; absent means it is not a candidate.
 */
export function isCandidateRoute(route: LlmRouteProfile | undefined): boolean {
  if (route === undefined) return false
  const api = route.api
  const baseURL = route.baseURL
  return typeof api === 'string' && CANDIDATE_APIS.has(api) && typeof baseURL === 'string' && baseURL.length > 0
}

/** The outcome of planning one model's contextWindow write. */
export interface PlanResult {
  /** The next models list (a copy; input is never mutated). */
  models: LlmModelEntry[]
  /** Whether a write is needed at all; false means a user override stands or the value is already correct. */
  changed: boolean
}

/**
 * Plan how one model's `contextWindow` changes, without touching the store. A
 * model absent from the list is created as `{ id, contextWindow }`; an existing
 * entry with no usable (nonzero) contextWindow is filled; an entry that already
 * carries a positive contextWindow is left untouched — that is the user's override.
 * @param models - the route's current models list.
 * @param modelId - the model to size.
 * @param rounded - the floored n_ctx to write.
 */
export function planContextWindowWrite(models: readonly LlmModelEntry[], modelId: string, rounded: number): PlanResult {
  const index = models.findIndex(m => m.id === modelId)
  if (index === -1) return { models: [...models, { id: modelId, contextWindow: rounded }], changed: true }
  const existing = models[index]
  if (existing !== undefined && typeof existing.contextWindow === 'number' && existing.contextWindow > 0) {
    return { models: [...models], changed: false }
  }
  const next = models.map((m, i) => (i === index ? { ...m, contextWindow: rounded } : m))
  return { models: next, changed: true }
}

/**
 * Plan how one model's `contextWindow` changes when the caller explicitly asks
 * to replace the stored value (the settings UI's refresh/save path). Unlike
 * {@link planContextWindowWrite}, an existing positive contextWindow is NOT a
 * user override here — it is overwritten. A missing entry is created; a value
 * that already matches needs no write.
 * @param models - the route's current models list.
 * @param modelId - the model to replace the value for.
 * @param value - the contextWindow to store.
 */
export function planContextWindowOverwrite(models: readonly LlmModelEntry[], modelId: string, value: number): PlanResult {
  const index = models.findIndex(m => m.id === modelId)
  if (index === -1) return { models: [...models, { id: modelId, contextWindow: value }], changed: true }
  const existing = models[index]
  if (existing !== undefined && existing.contextWindow === value) return { models: [...models], changed: false }
  const next = models.map((m, i) => (i === index ? { ...m, contextWindow: value } : m))
  return { models: next, changed: true }
}

/** True for two modality lists that hold the same entries, order-insensitive. */
function sameModalitySet(a: readonly string[], b: readonly string[]): boolean {
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.length === sortedB.length && sortedA.every((m, i) => m === sortedB[i])
}

/**
 * Plan how one model's `input` list changes when the caller explicitly asks to
 * replace it (the vision checkbox's save path). Unlike {@link planContextWindowWrite},
 * a stored list is NOT a user override here — it is overwritten; a stored list
 * that already holds the same set needs no write. An absent entry is created as
 * `{ id, input }`. @param models - the route's current models list.
 * @param modelId - the model to replace the list for.
 * @param input - the modality list to store.
 */
export function planInputOverwrite(models: readonly LlmModelEntry[], modelId: string, input: readonly string[]): PlanResult {
  const index = models.findIndex(m => m.id === modelId)
  if (index === -1) return { models: [...models, { id: modelId, input: [...input] }], changed: true }
  const existing = models[index]
  if (existing !== undefined && Array.isArray(existing.input) && sameModalitySet(existing.input, input)) {
    return { models: [...models], changed: false }
  }
  const next = models.map((m, i) => (i === index ? { ...m, input: [...input] } : m))
  return { models: next, changed: true }
}

/** True when a thrown error is a settings revision conflict. */
function isConflict(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === 'SETTINGS_CONFLICT'
}

/**
 * Write one model's contextWindow through the store with revision fencing. Reads
 * the section, plans the write, and persists it; on a single `SettingsConflictError`
 * it re-reads and retries once, then gives up. A route that is absent from the
 * section, or a value already held as a user override, is skipped quietly. Any
 * other error — including a second conflict or a schema rejection — propagates.
 * @param store - the injected settings seam.
 * @param routeId - the provider route key to write under.
 * @param modelId - the model to size.
 * @param rounded - the floored n_ctx to write.
 */
export async function persistModels(
  store: SettingsStore,
  routeId: string,
  modelId: string,
  rounded: number,
): Promise<void> {
  let retried = false
  for (;;) {
    const { value, revision } = store.read()
    const route = value.providers?.[routeId]
    if (route === undefined) return // the route is not in the section; skip quietly
    const models = Array.isArray(route.models) ? [...route.models] : []
    const plan = planContextWindowWrite(models, modelId, rounded)
    if (!plan.changed) return // a user override stands, or the value is already correct
    try {
      await store.setRouteModels(routeId, plan.models, revision)
      return
    } catch (err) {
      if (isConflict(err) && !retried) {
        retried = true
        continue // re-read and retry once
      }
      throw err
    }
  }
}

/**
 * Explicitly replace one model's `contextWindow` through the store with
 * revision fencing. Unlike {@link persistModels}, an existing positive value is
 * overwritten — this is a deliberate user act (the settings UI's refresh/save),
 * not the autofill path. On a single `SettingsConflictError` it re-reads and
 * retries once, then gives up. A route that is absent from the section, or a
 * value already stored, is skipped quietly; any other error propagates.
 * @param store - the injected settings seam.
 * @param routeId - the provider route key to write under.
 * @param modelId - the model to replace the value for.
 * @param value - the contextWindow to store.
 */
export async function persistContextWindow(
  store: SettingsStore,
  routeId: string,
  modelId: string,
  value: number,
): Promise<void> {
  let retried = false
  for (;;) {
    const { value: section, revision } = store.read()
    const route = section.providers?.[routeId]
    if (route === undefined) return // the route is not in the section; skip quietly
    const models = Array.isArray(route.models) ? [...route.models] : []
    const plan = planContextWindowOverwrite(models, modelId, value)
    if (!plan.changed) return // the value is already stored
    try {
      await store.setRouteModels(routeId, plan.models, revision)
      return
    } catch (err) {
      if (isConflict(err) && !retried) {
        retried = true
        continue // re-read and retry once
      }
      throw err
    }
  }
}
