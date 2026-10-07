/**
 * The /global-queue host RPC channel: one prefix route on the host web server
 * serving the queue's list/add/reorder/editText/remove endpoints over the dsh
 * client-request wire shape. Each request answers one server-response envelope
 * whose `result` is the dsh carrier's `{ ok, value }` / `{ ok, error }` shape;
 * payload-validation failures and the store's throws become `ok: false` results.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { QueueStore } from './queue/store.ts'

/** The logical RPC channel the client calls. */
const CHANNEL = '/global-queue'

/** The one RPC result shape the client unwraps (the dsh carrier's contract). */
type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** Build an RPC error in the shape the dsh carrier validates. */
function rpcFailure(code: string, message: string, details: Record<string, unknown>): RpcResult {
  return { ok: false, error: { code, message, details } }
}

/** One prefix route the host web server dispatches; the handler owns the full response lifecycle. */
export interface WebRoute {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The host web server's route registry, as this plugin consumes it. */
export interface WebServerRegistry {
  register(route: WebRoute): () => void
}

/**
 * Mount the /global-queue prefix route; returns the route's unregister.
 * `onAdd` wakes the watcher after a successful `add` so a freshly queued item
 * starts even when no live agent would fire an `agent/status` event.
 */
export function mountChannel(store: QueueStore, webServer: WebServerRegistry, onAdd: () => void): () => void {
  const route: WebRoute = {
    kind: 'prefix',
    path: CHANNEL,
    handler: (req, res) => handleRequest(store, onAdd, req, res),
  }
  return webServer.register(route)
}

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

/** Dispatch one endpoint to the store; validation failures and store throws become ok:false results. */
function dispatch(store: QueueStore, onAdd: () => void, endpoint: string, payload: unknown): RpcResult {
  try {
    switch (endpoint) {
      case 'list':
        return { ok: true, value: { items: store.list() } }
      case 'add': {
        const p = payload as { text?: unknown; workspacePath?: unknown; targetSessionId?: unknown; agentPreset?: unknown }
        const text = p?.text
        const workspacePath = p?.workspacePath
        const targetSessionId = p?.targetSessionId
        const agentPreset = p?.agentPreset
        if (typeof text !== 'string' || text.trim() === '') return rpcFailure('bad-request', 'add requires a non-empty text string', { issues: [] })
        if (typeof workspacePath !== 'string' || workspacePath === '') return rpcFailure('bad-request', 'add requires a non-empty workspacePath string', { issues: [] })
        if (targetSessionId !== null && typeof targetSessionId !== 'string') return rpcFailure('bad-request', 'add requires targetSessionId to be a string or null', { issues: [] })
        if (agentPreset !== undefined && typeof agentPreset !== 'string') return rpcFailure('bad-request', 'add requires agentPreset to be a string', { issues: [] })
        const item = store.add({ text, workspacePath, targetSessionId, ...(agentPreset === undefined ? {} : { agentPreset }) })
        onAdd()
        return { ok: true, value: { item } }
      }
      case 'reorder': {
        const p = payload as { id?: unknown; toIndex?: unknown }
        const id = p?.id
        const toIndex = p?.toIndex
        if (typeof id !== 'string' || typeof toIndex !== 'number') return rpcFailure('bad-request', 'reorder requires an id string and a toIndex number', { issues: [] })
        return { ok: true, value: { items: store.reorder(id, toIndex) } }
      }
      case 'editText': {
        const p = payload as { id?: unknown; text?: unknown }
        const id = p?.id
        const text = p?.text
        if (typeof id !== 'string' || typeof text !== 'string') return rpcFailure('bad-request', 'editText requires an id string and a text string', { issues: [] })
        return { ok: true, value: { item: store.editText(id, text) } }
      }
      case 'remove': {
        const id = (payload as { id?: unknown })?.id
        if (typeof id !== 'string') return rpcFailure('bad-request', 'remove requires an id string', { issues: [] })
        store.remove(id)
        return { ok: true, value: { ok: true } }
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

/** One request into the channel: validate the envelope, then dispatch to the store. */
async function handleRequest(store: QueueStore, onAdd: () => void, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  const result = dispatch(store, onAdd, endpoint, message.payload)
  sendJson(res, 200, { type: 'server-response', rpcId: message.rpcId, result })
}
