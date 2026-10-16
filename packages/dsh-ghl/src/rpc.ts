/**
 * The /ghl host RPC channel: one prefix route on the host web server serving
 * the issue integration's detectRepo/listIssues/getIssue endpoints over the
 * dsh client-request wire shape. Each request answers one server-response
 * envelope whose `result` is the dsh carrier's `{ ok, value }` /
 * `{ ok, error }` shape; payload-validation failures and the provider's
 * throws become `ok: false` results.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { IssueNotFoundError, RateLimitError, type BaseIssue, type ListIssuesParams, type RepoRef } from './issues.ts'
import { dbg } from './log.ts'
import type { DetectionResult } from './repo.ts'

/** The logical RPC channel the client calls. */
const CHANNEL = '/ghl'

/** The one RPC result shape the client unwraps (the dsh carrier's contract). */
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** Build an RPC error in the shape the dsh carrier validates. */
function rpcFailure(code: string, message: string, details: Record<string, unknown>): RpcResult {
  dbg.error(`rpc failure ${code}: ${message}`)
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

/** The channel's dependencies: the issue provider (with its cache's `clear`) and the repo detector. */
export interface RpcDeps {
  issue: BaseIssue & { clear(repo: RepoRef): void }
  getRepo: (payload: unknown) => Promise<DetectionResult>
}

/** A detection failure as an RPC result, passed through verbatim. */
function detectionFailure(result: Extract<DetectionResult, { ok: false }>): RpcResult {
  return rpcFailure(result.code, result.message, {})
}

/**
 * Mount the /ghl prefix route; returns the route's unregister.
 */
export function mountChannel(deps: RpcDeps, webServer: WebServerRegistry): () => void {
  const route: WebRoute = {
    kind: 'prefix',
    path: CHANNEL,
    handler: (req, res) => handleRequest(deps, req, res),
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
export function endpointFromPath(pathname: string): string | undefined {
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

/** The `listIssues` payload validated into params; null when a field is mis-typed. A null payload carries no params. */
function listParams(payload: unknown): ListIssuesParams | null {
  if (payload === null) return {}
  if (typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload as { state?: unknown; perPage?: unknown; page?: unknown }
  if (p.state !== undefined && p.state !== 'open' && p.state !== 'closed' && p.state !== 'all') return null
  if (p.perPage !== undefined && typeof p.perPage !== 'number') return null
  if (p.page !== undefined && typeof p.page !== 'number') return null
  const params: ListIssuesParams = {}
  if (p.state !== undefined) params.state = p.state
  if (p.perPage !== undefined) params.perPage = p.perPage
  if (p.page !== undefined) params.page = p.page
  return params
}

/** One request into the channel: validate the envelope, then dispatch to the deps. */
export async function handleRequest(deps: RpcDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  const result = await dispatch(deps, endpoint, message.payload)
  sendJson(res, 200, { type: 'server-response', rpcId: message.rpcId, result })
}

/** Dispatch one endpoint to the deps; validation failures and provider throws become ok:false results. */
async function dispatch(deps: RpcDeps, endpoint: string, payload: unknown): Promise<RpcResult> {
  try {
    switch (endpoint) {
      case 'detectRepo': {
        const result = await deps.getRepo(payload)
        if (!result.ok) return detectionFailure(result)
        return { ok: true, value: { repo: result.repo } }
      }
      case 'listIssues': {
        const result = await deps.getRepo(payload)
        if (!result.ok) return detectionFailure(result)
        const params = listParams(payload)
        if (params === null) return rpcFailure('bad-request', 'listIssues accepts only state ("open"|"closed"|"all"), perPage, and page numbers', { issues: [] })
        // A strictly-true `force` bypasses the cache for this list read.
        if ((payload as { force?: unknown } | null)?.force === true) deps.issue.clear(result.repo)
        const issues = await deps.issue.listIssues(result.repo, params)
        return { ok: true, value: { issues: issues.value } }
      }
      case 'getIssue': {
        const result = await deps.getRepo(payload)
        if (!result.ok) return detectionFailure(result)
        const number = (payload as { number?: unknown } | null)?.number
        if (typeof number !== 'number') return rpcFailure('bad-request', 'getIssue requires a number', { issues: [] })
        const issue = await deps.issue.getIssue(result.repo, number)
        return { ok: true, value: { issue: issue.value } }
      }
      default:
        return rpcFailure('internal', `unknown endpoint "${endpoint}"`, {})
    }
  } catch (error) {
    if (error instanceof IssueNotFoundError) return rpcFailure('not-found', error.message, {})
    if (error instanceof RateLimitError) return rpcFailure('rate-limit', error.message, {})
    const message = error instanceof Error ? error.message : String(error)
    // 'internal' is the dsh carrier's catch-all code; the thrown message stays human-readable.
    return rpcFailure('internal', message, {})
  }
}

/** The pure, unit-testable endpoint dispatch. */
export function makeRpcHandler(deps: RpcDeps): (endpoint: string, payload: unknown) => Promise<RpcResult> {
  return (endpoint, payload) => dispatch(deps, endpoint, payload)
}
