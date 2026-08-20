import { probeProps, type Fetcher } from './probe.ts'
import { isCandidateRoute, persistModels, type LlmModelEntry, type LlmRouteProfile, type SettingsStore } from './settings-io.ts'

/** Options for one autofill round. */
export interface AutofillOptions {
  /** The settings seam to read candidates from and write contextWindow to. */
  store: SettingsStore
  /** The fetch seam used to probe `/props` (production: global fetch). */
  fetcher: Fetcher
  /** Resolve a route's Bearer key (from its `apiKeyEnv`); absent means unauthenticated. */
  apiKeyFor?: (route: LlmRouteProfile) => string | undefined
}

/** Maximum concurrent `/props` probes in one round. */
const CONCURRENCY_LIMIT = 3

/** One model to probe and size: a candidate route's model with no nonzero contextWindow yet. */
interface Job {
  routeId: string
  baseURL: string
  modelId: string
  apiKey?: string
}

/** True when the model already carries a usable (positive) contextWindow. */
function hasNonzeroContextWindow(model: LlmModelEntry): boolean {
  return typeof model.contextWindow === 'number' && model.contextWindow > 0
}

/**
 * Collect the models that need sizing this round: candidate routes only, and only
 * models without a nonzero contextWindow. That last rule is the self-cycle guard —
 * a model we already sized (or one the user overrode) is neither re-probed nor
 * rewritten, so our own write never schedules another round of work.
 */
function collectJobs(section: { providers?: Record<string, LlmRouteProfile> }, apiKeyFor?: AutofillOptions['apiKeyFor']): Job[] {
  const jobs: Job[] = []
  for (const [routeId, route] of Object.entries(section.providers ?? {})) {
    if (!isCandidateRoute(route)) continue
    const baseURL = route.baseURL
    if (typeof baseURL !== 'string' || baseURL.length === 0) continue // isCandidateRoute already checked; belt and braces
    const apiKey = apiKeyFor?.(route)
    for (const model of route.models ?? []) {
      if (hasNonzeroContextWindow(model)) continue
      jobs.push({ routeId, baseURL, modelId: model.id, ...(apiKey !== undefined ? { apiKey } : {}) })
    }
  }
  return jobs
}

/** Run `worker` over `items` with at most `limit` in flight; every item is processed exactly once. */
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const n = Math.min(limit, queue.length)
  if (n === 0) return
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const item = queue.shift()
        if (item === undefined) return
        await worker(item)
      }
    }),
  )
}

/**
 * Run one autofill round. Reads the section, probes every candidate route's unsized
 * model with at most {@link CONCURRENCY_LIMIT} in flight, and writes a contextWindow
 * for each confirmed one (a probe that returned n_ctx > 0). Probes are read-only and
 * run concurrently; writes are serialized so our own writes never conflict. Every
 * failure — a failed or timed-out probe, or a refused write — skips that model quietly;
 * nothing leaks to the caller, and the next round retries what was skipped.
 */
export async function autofill(options: AutofillOptions): Promise<void> {
  const section = options.store.read().value
  const jobs = collectJobs(section, options.apiKeyFor)
  if (jobs.length === 0) return

  // Probe phase: concurrent and read-only; a null result means "not confirmed".
  const confirmed: Array<{ routeId: string; modelId: string; rounded: number }> = []
  await runPool(jobs, CONCURRENCY_LIMIT, async job => {
    const probeOpts = job.apiKey === undefined ? undefined : { apiKey: job.apiKey }
    const result = await probeProps(options.fetcher, job.baseURL, job.modelId, probeOpts)
    if (result !== null) confirmed.push({ routeId: job.routeId, modelId: job.modelId, rounded: result.rounded })
  })

  // Write phase: serialized; each persistModels reads a fresh revision, so our own
  // writes never conflict. A skipped model (a second conflict or schema rejection) is
  // left for the next round rather than leaking an exception here.
  for (const c of confirmed) {
    try {
      await persistModels(options.store, c.routeId, c.modelId, c.rounded)
    } catch {
      // skip this model; the next round retries it
    }
  }
}
