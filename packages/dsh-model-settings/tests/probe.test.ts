import { describe, expect, it } from 'vitest'
import { fetchModels, type Fetcher } from '../src/probe.ts'

// A slice of the live /v1/models listing (docs/specs/v1): each entry carries an
// INI status.preset; top-level context_window is null and unused.
const LISTING_BODY = JSON.stringify({
  data: [
    { id: 'empero-ai_Qwen3.8-27B-Ridge-3.7bpw', context_window: null, status: { value: 'loaded', preset: 'ctx-size = 120000\njinja = 1' } },
    { id: 'Zed-Qwen3.8-27B', context_window: null, status: { value: 'unloaded', preset: 'ctx-size = 90000\nfit-ctx = 4096' } },
  ],
})

/** A stub Fetcher returning a fixed 200 JSON reply. */
function okFetcher(body: string): Fetcher {
  return {
    fetch: async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
  }
}

describe('fetchModels', () => {
  it('returns the data[] entries on a successful listing reply', async () => {
    await expect(fetchModels(okFetcher(LISTING_BODY), 'http://host:8080')).resolves.toEqual([
      { id: 'empero-ai_Qwen3.8-27B-Ridge-3.7bpw', context_window: null, status: { value: 'loaded', preset: 'ctx-size = 120000\njinja = 1' } },
      { id: 'Zed-Qwen3.8-27B', context_window: null, status: { value: 'unloaded', preset: 'ctx-size = 90000\nfit-ctx = 4096' } },
    ])
  })

  it('builds the /v1/models URL from the base (trailing slash trimmed)', async () => {
    let captured = ''
    const fetcher: Fetcher = {
      fetch: async (url) => {
        captured = url
        return new Response(LISTING_BODY, { status: 200 })
      },
    }
    await fetchModels(fetcher, 'http://host:8080/')
    expect(captured).toBe('http://host:8080/v1/models')
  })

  it('throws on a 404 (visible error, not silent null)', async () => {
    const fetcher: Fetcher = { fetch: async () => new Response('', { status: 404 }) }
    await expect(fetchModels(fetcher, 'http://host:8080')).rejects.toThrow(/HTTP 404/)
  })

  it('throws on a non-2xx status (visible error)', async () => {
    const fetcher: Fetcher = { fetch: async () => new Response('nope', { status: 500 }) }
    await expect(fetchModels(fetcher, 'http://host:8080')).rejects.toThrow(/HTTP 500/)
  })

  it('throws when the reply is not JSON (visible error)', async () => {
    const fetcher: Fetcher = { fetch: async () => new Response('<html>', { status: 200 }) }
    await expect(fetchModels(fetcher, 'http://host:8080')).rejects.toThrow(/malformed JSON/)
  })

  it('throws when the reply has no data array (visible error)', async () => {
    const fetcher: Fetcher = { fetch: async () => new Response(JSON.stringify({ models: [] }), { status: 200 }) }
    await expect(fetchModels(fetcher, 'http://host:8080')).rejects.toThrow(/no data\[\]/)
  })

  it('throws on timeout (aborted signal)', async () => {
    const fetcher: Fetcher = {
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    }
    await expect(fetchModels(fetcher, 'http://host:8080', { timeoutMs: 20 })).rejects.toThrow()
  })

  it('throws when the body exceeds the 4MB ceiling', async () => {
    const oversized = 'a'.repeat(4 * 1024 * 1024 + 1)
    const fetcher: Fetcher = { fetch: async () => new Response(oversized, { status: 200 }) }
    await expect(fetchModels(fetcher, 'http://host:8080')).rejects.toThrow(/exceeds the byte ceiling/)
  })

  it('sends a Bearer header when an api key is supplied', async () => {
    let auth: string | undefined
    const fetcher: Fetcher = {
      fetch: async (_url, init) => {
        auth = (init?.headers as Record<string, string> | undefined)?.authorization
        return new Response(LISTING_BODY, { status: 200 })
      },
    }
    await fetchModels(fetcher, 'http://host:8080', { apiKey: 'secret' })
    expect(auth).toBe('Bearer secret')
  })

  // ─── LIVE test (temporary debugging) ────────────────────────────────────────
  // Hits the real llama.cpp server to verify fetchModels works against reality.
  // Skipped by default; flip `.skip` → `it` to run it manually.
  it.skip('LIVE: fetches models from 192.168.1.69 (debugging)', async () => {
    const entries = await fetchModels(
      { fetch: (input, init) => globalThis.fetch(input, init) },
      'http://192.168.1.69:8080/v1',
    )
    console.debug('LIVE /v1/models →', entries.length, 'models')
    for (const e of entries.slice(0, 5)) {
      console.debug('  ', e.id, '| preset:', e.status?.preset?.slice(0, 80))
    }
    expect(entries.length).toBeGreaterThan(0)
  })
})
