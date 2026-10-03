/**
 * The model-settings plugin, node half. It is the composition root: it wires the
 * tested modules (probe, settings-io, autofill) to the dsh seams — observing the
 * `llm-pi-ai` section to autofill new models' contextWindow and serving the
 * `/model-settings` RPC channel the browser card calls (the settings card itself is
 * registered client-side). It computes nothing itself; every rule lives in a
 * module that is unit-tested on its own.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { autofill } from './autofill.ts'
import { dbg } from './log.ts'
import { fetchModels, type Fetcher } from './probe.ts'
import { contextWindowFromEntry } from './props.ts'
import { isCandidateRoute, persistContextWindow, persistModels, type LlmModelEntry, type LlmRouteProfile, type LlmSection, type SettingsStore } from './settings-io.ts'
import { validateEfforts, type ReasoningEfforts } from './efforts.ts'
import { persistModelSave, type ModelSaveParts } from './model-save.ts'
import { roundDown } from './round.ts'

export const name = 'model-settings'

/** The llm-pi-ai section we read and patch (owned by the llm adapter). At runtime
 * the namespace is the plain profile entry id; the branded cast types it against
 * the `dsh-settings` `SettingsNamespace` Branded type. */
const LLM_NS = 'llm-pi-ai' as SettingsNamespace
/** The logical RPC channel the browser card calls. */
const CHANNEL = '/model-settings'

/**
 * The one RPC result shape the client unwraps. Errors follow the dsh carrier's
 * closed-code contract (code + message + required details): a non-conformant
 * result fails the carrier's validation and reaches the client as raw zod issues.
 */
type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** Build an RPC error in the shape the dsh carrier validates (mirrors its `transportError` catch-all). */
function rpcFailure(code: string, message: string, details: Record<string, unknown>): RpcResult {
  return { ok: false, error: { code, message, details } }
}

/** One prefix route the host web server dispatches; the handler owns the full response lifecycle. */
interface WebRoute {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The host web server's route registry, as this plugin consumes it. */
interface WebServerRegistry {
  register(route: WebRoute): () => void
}

// The dsh 0.2.0 web apps provide a `webServer` service on plugin contexts; the
// installed 0.1.x types predate it, so this structural mirror carries the read.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host web server's route registry. */
    webServer: WebServerRegistry
  }
}

/** The hmr service's transaction handle, as this plugin consumes it. */
type HmrFacade = { executing?: { exit(fn: () => void): void } }

// The hmr service is a base-bundle root service on dsh 0.2.0; the installed 0.1.x
// types predate it, so this structural mirror carries the read. Optional, because
// other host versions may not provide the service.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host hmr service's transaction handle. */
    hmr?: HmrFacade
  }
}

/** The dsh settings service, as this plugin consumes it: one descriptor read, one path-op write. */
type SettingsSeam = {
  describe(): ReadonlyArray<{ ns: SettingsNamespace; value: unknown; revision: number }>
  mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/** The host hmr's executing handle, or undefined when the host provides no such service.
 * The root-level hmr service is only reachable from a plugin context through `inject`
 * (a direct `ctx.hmr` read throws on Cordis contexts); the injected callback runs on
 * the next tick once the service is available, so this is awaited. The host's `emit`
 * does not await listeners, so the await never blocks the host's in-flight write, and
 * a host without the service simply never settles this round. */
async function hmrExecuting(ctx: Context) {
  let executing: { exit(fn: () => void): void } | undefined
  await ctx.inject(['hmr'], hctx => {
    executing = hctx.hmr?.executing
  })
  return executing
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
function makeLlmStore(settings: SettingsSeam): SettingsStore {
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
      // Only a non-empty array of strings counts as a stored modality list: `[]` is
      // schemastery's materialized spelling of an absent array, so it is shown as absent.
      const input = Array.isArray(model.input) && model.input.length > 0 ? model.input : undefined
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

    // Watcher: on an llm-pi-ai commit, run one autofill round. The self-cycle guard
    // lives in autofill (a sized model is not re-probed), so a write we made never
    // schedules another round; the flag only dedupes concurrent commits. The host
    // emits this event from inside its HMR transaction, and the round's
    // `settings.mutate` would open a nested transaction — and that nesting is
    // AsyncLocalStorage-bound, so no timer or microtask deferral escapes it. The
    // round therefore runs under the host's own `executing.exit` idiom, which clears
    // the transaction store for the round's continuations so the persist opens its
    // own top-level transaction, serialized behind the host's in-flight one.
    let running = false
    ctx.on('settings/document-updated', (ns, revision) => {
      dbg.debug(`settings/document-updated fired: ns=${ns} revision=${revision} isLlmNs=${ns === LLM_NS} running=${running}`)
      if (ns !== LLM_NS || running) return
      running = true
      void hmrExecuting(ctx)
        .then(executing => {
          if (executing === undefined) return undefined
          return executing.exit(() => autofill({ store, fetcher: productionFetcher, apiKeyFor }))
        })
        .catch(error => {
          dbg.error('autofill round FAILED:', error)
          ctx.logger.error('model-settings: autofill round failed')
          ctx.logger.error(error)
        })
        .finally(() => {
          running = false
        })
    })

    // On dsh 0.2.0-rc.2 the host's `rpc.handle` path never mounts its route: its
    // register effect reads `webServer` off the connection entry's own context,
    // whose fiber chain lacks the service, so the effect fails and every
    // /model-settings request falls through as 404. Mount the channel's prefix
    // route ourselves, through the host's own proven pattern: inject `webServer`,
    // then register from the context the injection returns.
    sctx.inject(['webServer'], webCtx => {
      const route: WebRoute = {
        kind: 'prefix',
        path: CHANNEL,
        handler: (req, res) => handleChannelRequest(store, req, res),
      }
      webCtx.effect(() => webCtx.webServer.register(route), 'model-settings: /model-settings channel')
    })
  })
}

// The channel's wire contract, mirrored from the dsh 0.2.0-rc.2 host's
// rpcFetchHandler: POST /model-settings/<endpoint> with a JSON client-request
// envelope answers one server-response envelope.
/** The client-request envelope this channel accepts (the dsh carrier's wire shape). */
type ClientRequest = { type: 'client-request'; rpcId: string; method: string; payload: unknown }

const clientRequestSchema = z.object({
  type: z.const('client-request'),
  rpcId: z.string(),
  method: z.string(),
  payload: z.any(),
})

const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** The endpoint after the channel prefix; undefined for non-endpoint pathnames. */
function endpointFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith(`${CHANNEL}/`)) return undefined
  const endpoint = pathname.slice(CHANNEL.length + 1)
  if (endpoint === '') return undefined
  const segments = endpoint.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) return undefined
  return endpoint
}

/** The request content-type's media type: first `;`-delimited part, trimmed, lowercased. */
function mediaType(contentType: string | string[] | undefined): string | undefined {
  const value = Array.isArray(contentType) ? contentType[0] : contentType
  return value?.split(';')[0]?.trim().toLowerCase()
}

/** Collect the request body stream into a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** A plain-text response. */
function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain' })
  res.end(body)
}

/** A JSON response. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

/** The parsed body's rpcId when the body is an object carrying a string one. */
function rpcIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const id = (body as { rpcId?: unknown }).rpcId
  return typeof id === 'string' ? id : undefined
}

/** One request into the channel: validate the envelope, then dispatch to the RPC handler. */
async function handleChannelRequest(store: SettingsStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // The dsh host derives the endpoint from the URL pathname, so parse it the same way.
  const endpoint = endpointFromPath(new URL(req.url ?? '/', 'http://localhost').pathname)
  if (req.method !== 'POST' || endpoint === undefined) { sendText(res, 404, 'not found'); return }
  if (mediaType(req.headers['content-type']) !== 'application/json') { sendText(res, 415, 'content type must be application/json'); return }
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    sendText(res, 400, 'body is not JSON'); return
  }
  const parsed = await clientRequestSchema['~standard'].validate(body)
  if ('issues' in parsed) {
    sendJson(res, 200, { type: 'server-response', rpcId: rpcIdOf(body) ?? 'invalid-request', result: rpcFailure('gateway/bad-request', 'invalid client-request message', { issues: parsed.issues }) })
    return
  }
  // The standard schema result is untyped (`value: unknown`), so the wire shape
  // has to be re-asserted against the local ClientRequest.
  const message = parsed.value as ClientRequest
  if (message.method !== endpoint) {
    sendJson(res, 200, { type: 'server-response', rpcId: message.rpcId, result: rpcFailure('gateway/bad-request', `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, { issues: [] }) })
    return
  }
  try {
    const result = await makeRpcHandler(store)(endpoint, message.payload)
    sendJson(res, 200, { type: 'server-response', rpcId: message.rpcId, result })
  } catch (error) {
    sendText(res, 500, `handler failure: ${String(error)}`)
  }
}
