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

/**
 * Join the base with the models endpoint, trimming a trailing slash. If the base
 * already ends with `/v1` (an OpenAI-compatible root like `http://host:8080/v1`),
 * append only `/models`; otherwise append `/v1/models`. This handles both spellings
 * of a llama.cpp route's baseURL without double-stamping `/v1`.
 */
function modelsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  if (base.endsWith('/v1')) return `${base}/models`
  return `${base}/v1/models`
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
 * failure — network error, timeout, non-2xx, oversized or malformed reply — throws
 * a descriptive Error so the caller can see exactly what went wrong (the watcher's
 * .catch logs it); no silent nulls.
 * @param fetcher - the injected fetch seam (production: global fetch).
 * @param baseURL - the route's endpoint base.
 * @param options - optional Bearer key and timeout.
 * @returns the listing entries; throws on any failure.
 */
export async function fetchModels(
  fetcher: Fetcher,
  baseURL: string,
  options?: FetchModelsOptions,
): Promise<ModelEntry[]> {
  const url = modelsUrl(baseURL)
  console.debug(`[model-settings] fetchModels GET ${url} auth=${options?.apiKey !== undefined}`)
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options?.apiKey !== undefined) headers.authorization = `Bearer ${options.apiKey}`
    const response = await fetcher.fetch(url, { method: 'GET', headers, signal: controller.signal })
    console.debug(`[model-settings] fetchModels HTTP ${response.status}`)
    if (!response.ok) throw new Error(`fetchModels: HTTP ${response.status} from ${url}`)
    const body = await readBounded(response)
    console.debug(`[model-settings] fetchModels body=${body.length} bytes`)
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      throw new Error(`fetchModels: malformed JSON from ${url}`)
    }
    const root = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null
    if (root === null || !Array.isArray(root.data)) throw new Error(`fetchModels: no data[] in reply from ${url}`)
    console.debug(`[model-settings] fetchModels parsed ${root.data.length} models`)
    return root.data as ModelEntry[]
  } catch (err) {
    // Propagate with context; the caller (autofill → watcher) logs it.
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    clearTimeout(timer)
  }
}
