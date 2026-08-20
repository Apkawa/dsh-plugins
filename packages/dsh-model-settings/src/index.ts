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
import { probeProps, type Fetcher } from './probe.ts'
import { isCandidateRoute, persistModels, type LlmModelEntry, type LlmRouteProfile, type LlmSection, type SettingsStore } from './settings-io.ts'

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

/** The one RPC result shape the client unwraps. */
type RpcResult = { ok: true; value: unknown } | { ok: false; error: { message: string; code?: string } }

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

/** Resolve one route's probe inputs from the section; a missing route or base throws. */
function resolveRoute(store: SettingsStore, routeId: string): LlmRouteProfile {
  const section = store.read().value
  const route = section.providers?.[routeId]
  if (route === undefined) throw new Error(`route "${routeId}" is not in the llm-pi-ai section`)
  return route
}

/** The RPC handler for the `/model-settings` channel; every failure becomes an `ok:false` result. */
function makeRpcHandler(store: SettingsStore): (endpoint: string, payload: unknown) => Promise<RpcResult> {
  return async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'listModels':
          return { ok: true, value: listModelRows(store) }
        case 'fetchProps': {
          const p = payload as { routeId?: string; modelId?: string }
          if (p?.routeId === undefined || p.modelId === undefined) throw new Error('fetchProps requires routeId and modelId')
          const route = resolveRoute(store, p.routeId)
          const baseURL = route.baseURL
          if (typeof baseURL !== 'string' || baseURL.length === 0) throw new Error(`route "${p.routeId}" has no baseURL`)
          const apiKey = apiKeyFor(route)
          const probeOptions = apiKey === undefined ? undefined : { apiKey }
          const result = await probeProps(productionFetcher, baseURL, p.modelId, probeOptions)
          if (result === null) throw new Error('the endpoint did not confirm a llama.cpp context size')
          return { ok: true, value: { nCtx: result.nCtx, rounded: result.rounded } }
        }
        case 'applyContextWindow': {
          const p = payload as { routeId?: string; modelId?: string; rounded?: number }
          if (p?.routeId === undefined || p.modelId === undefined || typeof p.rounded !== 'number') throw new Error('applyContextWindow requires routeId, modelId, and rounded')
          await persistModels(store, p.routeId, p.modelId, p.rounded)
          return { ok: true, value: null }
        }
        default:
          return { ok: false, error: { message: `unknown endpoint "${endpoint}"`, code: 'UNKNOWN_ENDPOINT' } }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: { message, code: 'MODEL_SETTINGS_ERROR' } }
    }
  }
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
      if (ns !== LLM_NS || running) return
      running = true
      void autofill({ store, fetcher: productionFetcher, apiKeyFor })
        .catch(error => {
          ctx.logger.error('model-settings: autofill round failed')
          ctx.logger.error(error)
        })
        .finally(() => {
          running = false
        })
    })

    // RPC channel for the browser card; only when a connection transport is present,
    // so a host without one still mounts the settings and watcher halves. The effect's
    // execute registers the channel and returns its disposer as the fiber cleanup.
    const conn = ctx.get('connection') as ConnectionRpcHandle | undefined
    if (conn !== undefined) {
      ctx.effect(async () => {
        return await conn.rpc.handle(CHANNEL, makeRpcHandler(store), { authority: 'trusted-host' })
      }, 'model-settings: /model-settings channel')
    }
  })
}
