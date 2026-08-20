import type { ModelEntry } from './props.ts'

/** A minimal fetch seam so the listing fetch is testable without touching the network. */
export interface Fetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

/** Options for a single listing fetch. */
export interface FetchModelsOptions {
  /** Bearer key from the route's `apiKeyEnv`; absent means unauthenticated. */
  apiKey?: string
  /** Abort after this many milliseconds; defaults to the module timeout. */
  timeoutMs?: number
}

/** Replies larger than this are refused (mirrors dsh discovery). */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
/** Default listing-fetch timeout. */
const FETCH_TIMEOUT_MS = 15_000

/** Join the base with `/v1/models`, trimming a trailing slash. */
function modelsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/v1/models`
}

/**
 * Read a reply body up to `MAX_RESPONSE_BYTES`, refusing one that outgrows the
 * ceiling. A declared length is checked first so an honest server is turned away
 * without transferring anything; the accumulated total is what actually enforces
 * the bound, because a streaming or under-declaring server says little up front.
 */
async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('response exceeds the byte ceiling')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error('response exceeds the byte ceiling')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {
      // Cancel after a drained or abandoned read is cleanup; the reply is already decided.
    })
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Fetch the `/v1/models` listing for one route. A single GET returns every model
 * with its `status.preset`; v1 parses those presets for context sizes. Every
 * failure — network error, timeout, non-2xx, oversized or malformed reply —
 * resolves to `null` so a caller can skip quietly; no exception escapes.
 * @param fetcher - the injected fetch seam (production: global fetch).
 * @param baseURL - the route's endpoint base.
 * @param options - optional Bearer key and timeout.
 * @returns the listing entries, or `null` when the route is not a llama.cpp server.
 */
export async function fetchModels(
  fetcher: Fetcher,
  baseURL: string,
  options?: FetchModelsOptions,
): Promise<ModelEntry[] | null> {
  const url = modelsUrl(baseURL)
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options?.apiKey !== undefined) headers.authorization = `Bearer ${options.apiKey}`
    const response = await fetcher.fetch(url, { method: 'GET', headers, signal: controller.signal })
    if (!response.ok) return null
    const body = await readBounded(response)
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      return null
    }
    const root = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null
    if (root === null || !Array.isArray(root.data)) return null
    return root.data as ModelEntry[]
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
