/**
 * The model-settings plugin, node half. It is the composition root: it wires the
 * tested modules (probe, settings-io, autofill) to the dsh seams — registering the
 * `model-settings` section so the settings card appears, observing the `llm-pi-ai`
 * section to autofill new models' contextWindow, and serving the `/model-settings`
 * RPC channel the browser card calls. It computes nothing itself; every rule lives
 * in a module that is unit-tested on its own.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
import { autofill } from './autofill.ts'
import { dbg } from './log.ts'
import { fetchModels, type Fetcher } from './probe.ts'
import { contextWindowFromEntry } from './props.ts'
import { isCandidateRoute, persistContextWindow, persistModels, type LlmModelEntry, type LlmRouteProfile, type LlmSection, type SettingsStore } from './settings-io.ts'
import { validateEfforts, type ReasoningEfforts } from './efforts.ts'
import { persistModelSave, type ModelSaveParts } from './model-save.ts'
import { roundDown } from './round.ts'

export const name = 'model-settings'

/** The section this plugin owns; v1 carries no user-editable fields. */
const NS = settingsNamespace('model-settings')
/** The llm-pi-ai section we read and patch (owned by the llm adapter). */
const LLM_NS = settingsNamespace('llm-pi-ai')
/** The logical RPC channel the browser card calls. */
const CHANNEL = '/model-settings'

/** v1 has no configuration; the section exists only so the settings page shows a card. */
const ModelSettingsSchema = z.object({}) as z<Record<string, never>>
const EMPTY_CONFIG: Record<string, never> = {}

/**
 * The one RPC result shape the client unwraps. Errors follow the dsh carrier's
 * closed-code contract (code + message + required details): a non-conformant
 * result fails the carrier's validation and reaches the client as raw zod issues.
 */
type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** Build an RPC error in the shape the dsh carrier validates (mirrors its `transportError` catch-all). */
function rpcFailure(code: 'bad-request' | 'internal', message: string, details: Record<string, unknown>): RpcResult {
  return { ok: false, error: { code, message, details } }
}

/** The connection transport's host RPC registry, as this plugin consumes it. */
interface ConnectionRpcHandle {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult>,
      options: { authority: 'trusted-host' },
    ): Promise<() => Promise<void>>
  }
}

/** Production fetch seam: the host process's global fetch. */
const productionFetcher: Fetcher = { fetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init) }

/** Resolve a route's Bearer key from its `apiKeyEnv` reference; absent means unauthenticated. */
function apiKeyFor(route: LlmRouteProfile): string | undefined {
  const name = route.apiKeyEnv
  if (typeof name !== 'string' || name.length === 0) return undefined
  const value = process.env[name]
  return value === undefined ? undefined : value
}

/**
 * Adapt the dsh settings seam to the `SettingsStore` the modules consume. Reads the
 * llm-pi-ai section and its revision from a descriptor; writes one route's models
 * list through a path op so nothing else in the section is restated or clobbered.
 */
function makeLlmStore(settings: SettingsProvider): SettingsStore {
  return {
    read(): Readonly<{ value: LlmSection; revision: number }> {
      const descriptor = settings.describe().find(row => row.ns === LLM_NS)
      if (descriptor === undefined) return { value: {}, revision: 0 }
      return { value: descriptor.value as LlmSection, revision: descriptor.revision }
    },
    async setRouteModels(routeId: string, models: readonly LlmModelEntry[], expectedRevision: number): Promise<void> {
      await settings.mutate(
        LLM_NS,
        [{ op: 'set', path: ['providers', routeId, 'models'], value: [...models] }],
        expectedRevision,
      )
    },
  }
}

/** The rows the card lists: every candidate route's models with their current contextWindow. */
function listModelRows(store: SettingsStore): Array<{ routeId: string; modelId: string; contextWindow?: number }> {
  const section = store.read().value
  const rows: Array<{ routeId: string; modelId: string; contextWindow?: number }> = []
  for (const [routeId, route] of Object.entries(section.providers ?? {})) {
    if (!isCandidateRoute(route)) continue
    for (const model of route.models ?? []) {
      rows.push({ routeId, modelId: model.id, ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}) })
    }
  }
  return rows
}

/** The rows the v2 settings section lists: every candidate route's models with their current reasoningEfforts, contextWindow, and input. */
function listReasoningRows(store: SettingsStore): Array<{ routeId: string; modelId: string; contextWindow?: number; efforts?: ReasoningEfforts; input?: string[] }> {
  const section = store.read().value
  const rows: Array<{ routeId: string; modelId: string; contextWindow?: number; efforts?: ReasoningEfforts; input?: string[] }> = []
  for (const [routeId, route] of Object.entries(section.providers ?? {})) {
    if (!isCandidateRoute(route)) continue
    for (const model of route.models ?? []) {
      // `false` is dsh's explicit non-reasoning spelling (our clear); only a mapping object is shown as levels.
      const raw = model.reasoningEfforts
      const efforts = typeof raw === 'object' && raw !== null ? (raw as ReasoningEfforts) : undefined
      // Only an array of strings counts as a stored modality list; anything else is shown as absent.
      const input = Array.isArray(model.input) ? model.input : undefined
      rows.push({ routeId, modelId: model.id, ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}), ...(efforts !== undefined ? { efforts } : {}), ...(input !== undefined ? { input } : {}) })
    }
  }
  return rows
}

/** True for a non-empty list of dsh input modalities restricted to the `text`/`image` set. */
function isInputList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(modality => modality === 'text' || modality === 'image')
}

/** Resolve one route's probe inputs from the section; a missing route or base throws. */
function resolveRoute(store: SettingsStore, routeId: string): LlmRouteProfile {
  const section = store.read().value
  const route = section.providers?.[routeId]
  if (route === undefined) throw new Error(`route "${routeId}" is not in the llm-pi-ai section`)
  return route
}

/** The RPC handler for the `/model-settings` channel; every failure becomes an `ok:false` result. Exported so its endpoints are unit-testable. */
export function makeRpcHandler(store: SettingsStore, fetcher: Fetcher = productionFetcher): (endpoint: string, payload: unknown) => Promise<RpcResult> {
  return async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'listModels':
          return { ok: true, value: listModelRows(store) }
        case 'fetchModels': {
          const p = payload as { routeId?: string }
          if (p?.routeId === undefined) return rpcFailure('bad-request', 'fetchModels requires routeId', { issues: [] })
          const route = resolveRoute(store, p.routeId)
          const baseURL = route.baseURL
          if (typeof baseURL !== 'string' || baseURL.length === 0) throw new Error(`route "${p.routeId}" has no baseURL`)
          const apiKey = apiKeyFor(route)
          const fetchOptions = apiKey === undefined ? undefined : { apiKey }
          const entries = await fetchModels(fetcher, baseURL, fetchOptions)
          if (entries === null) throw new Error('the endpoint did not return a llama.cpp model listing')
          // expose each entry's computed context size so the card can show what would be filled
          const models = entries.map(e => ({ id: e.id ?? null, contextWindow: contextWindowFromEntry(e) }))
          return { ok: true, value: { models } }
        }
        case 'applyContextWindows': {
          const p = payload as { routeId?: string; windows?: Array<{ modelId: string; rounded: number }> }
          if (p?.routeId === undefined || !Array.isArray(p.windows)) return rpcFailure('bad-request', 'applyContextWindows requires routeId and windows', { issues: [] })
          for (const w of p.windows) {
            if (typeof w.modelId !== 'string' || typeof w.rounded !== 'number') return rpcFailure('bad-request', 'each window needs a modelId and rounded size', { issues: [] })
            await persistModels(store, p.routeId, w.modelId, w.rounded)
          }
          return { ok: true, value: null }
        }
        case 'listReasoningRows':
          return { ok: true, value: listReasoningRows(store) }
        case 'saveModel': {
          // `null` is the clear part (drop the stored value); an absent part is untouched.
          const p = payload as { routeId?: string; modelId?: string; efforts?: ReasoningEfforts; contextWindow?: number | null; input?: string[] }
          if (p?.routeId === undefined || p.modelId === undefined) return rpcFailure('bad-request', 'saveModel requires routeId and modelId', { issues: [] })
          if (p.efforts === undefined && p.contextWindow === undefined && p.input === undefined) {
            return rpcFailure('bad-request', 'saveModel requires efforts, contextWindow, or input', { issues: [] })
          }
          if (p.efforts !== undefined) {
            const errors = validateEfforts(p.efforts)
            if (errors.length > 0) return rpcFailure('bad-request', errors.join('; '), { issues: [] })
          }
          if (typeof p.contextWindow === 'number' && (!Number.isInteger(p.contextWindow) || p.contextWindow <= 0)) {
            return rpcFailure('bad-request', 'contextWindow must be a positive integer', { issues: [] })
          }
          if (p.input !== undefined && !isInputList(p.input)) {
            return rpcFailure('bad-request', 'input must be a non-empty list of "text"/"image" modalities', { issues: [] })
          }
          const parts: ModelSaveParts = {}
          if (p.efforts !== undefined) parts.efforts = p.efforts
          if (p.contextWindow !== undefined) parts.contextWindow = p.contextWindow
          if (p.input !== undefined) parts.input = p.input
          await persistModelSave(store, p.routeId, p.modelId, parts)
          return { ok: true, value: null }
        }
        case 'refreshContextWindow': {
          const p = payload as { routeId?: string; modelId?: string }
          if (p?.routeId === undefined || p.modelId === undefined) return rpcFailure('bad-request', 'refreshContextWindow requires routeId and modelId', { issues: [] })
          const contextWindow = await refreshContextWindowValue(store, fetcher, p.routeId, p.modelId)
          return { ok: true, value: { contextWindow } }
        }
        default:
          return rpcFailure('internal', `unknown endpoint "${endpoint}"`, {})
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 'internal' is the dsh carrier's catch-all code; the thrown message stays human-readable.
      return rpcFailure('internal', message, {})
    }
  }
}

/**
 * Read one model's context window straight from its llama.cpp listing and force-write it:
 * resolve the route (a baseURL is required), fetch `/v1/models`, find the entry by id, read
 * ctx-size/fit-ctx, floor to the thousand. Every failure throws a descriptive error — refresh
 * is an explicit user act and must never skip quietly.
 */
async function refreshContextWindowValue(store: SettingsStore, fetcher: Fetcher, routeId: string, modelId: string): Promise<number> {
  const route = resolveRoute(store, routeId)
  const baseURL = route.baseURL
  if (typeof baseURL !== 'string' || baseURL.length === 0) throw new Error(`route "${routeId}" has no baseURL`)
  const apiKey = apiKeyFor(route)
  const fetchOptions = apiKey === undefined ? undefined : { apiKey }
  const entries = await fetchModels(fetcher, baseURL, fetchOptions)
  const entry = entries.find(e => e.id === modelId)
  if (entry === undefined) throw new Error(`model "${modelId}" is not in the ${routeId} listing`)
  const raw = contextWindowFromEntry(entry)
  if (raw === null) throw new Error(`model "${modelId}" has no ctx-size or fit-ctx in its preset`)
  const rounded = roundDown(raw)
  if (rounded === null) throw new Error(`model "${modelId}" has an unusable context size (${raw})`)
  await persistContextWindow(store, routeId, modelId, rounded)
  return rounded
}

export function apply(ctx: Context): void {
  ctx.inject(['settings'], sctx => {
    const store = makeLlmStore(sctx.settings)

    // Register our namespace so the settings page shows a card for it. The card's
    // data comes from the RPC channel, not this section, so it stays empty in v1.
    sctx.settings.register(NS, ModelSettingsSchema, { base: EMPTY_CONFIG })

    // Watcher: on an llm-pi-ai commit, run one autofill round. The self-cycle guard
    // lives in autofill (a sized model is not re-probed), so a write we made never
    // schedules another round; the flag only dedupes concurrent commits.
    let running = false
    ctx.on('settings/updated', (ns) => {
      dbg.debug(`settings/updated fired: ns=${ns} isLlmNs=${ns === LLM_NS} running=${running}`)
      if (ns !== LLM_NS || running) return
      running = true
      void autofill({ store, fetcher: productionFetcher, apiKeyFor })
        .catch(error => {
          dbg.error('autofill round FAILED:', error)
          ctx.logger.error('model-settings: autofill round failed')
          ctx.logger.error(error)
        })
        .finally(() => {
          running = false
        })
    })

    // RPC channel for the browser card; only when a connection transport is present,
    // so a host without one still mounts the settings and watcher halves. The inject
    // defers this row until the connection service exists — on 0.1.2-rc.1 the profile
    // plugins apply before the web client-connection row activates, so a plain
    // ctx.get('connection') at apply time sees nothing and the channel never registers.
    // The effect's execute registers the channel and returns its disposer as the
    // fiber cleanup (re-run if the connection service is ever re-provided).
    sctx.inject(['connection'], connCtx => {
      connCtx.effect(async () => {
        const conn = connCtx.get('connection') as ConnectionRpcHandle
        return conn.rpc.handle(CHANNEL, makeRpcHandler(store), { authority: 'trusted-host' })
      }, 'model-settings: /model-settings channel')
    })
  })
}
