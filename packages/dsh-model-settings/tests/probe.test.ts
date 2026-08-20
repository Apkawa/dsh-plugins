import { describe, expect, it } from 'vitest'
import { probeProps, type Fetcher } from '../src/probe.ts'

const PROPS_BODY = JSON.stringify({
  default_generation_settings: { n_ctx: 120064, params: { temperature: 0.7 } },
  modalities: { vision: false },
})

/** A stub Fetcher returning a fixed 200 JSON reply. */
function okFetcher(body: string): Fetcher {
  return {
    fetch: async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
  }
}

describe('probeProps', () => {
  it('returns nCtx + rounded on a successful /props reply', async () => {
    await expect(probeProps(okFetcher(PROPS_BODY), 'http://host:8080', 'model-x')).resolves.toEqual({
      nCtx: 120064,
      rounded: 120000,
      params: { temperature: 0.7 },
      modalities: { vision: false },
    })
  })

  it('builds the /props URL with model and autoload=false', async () => {
    let captured = ''
    const fetcher: Fetcher = {
      fetch: async (url) => {
        captured = url
        return new Response(PROPS_BODY, { status: 200 })
      },
    }
    await probeProps(fetcher, 'http://host:8080/', 'empero-ai_Qwen3.8')
    expect(captured).toBe(
      'http://host:8080/props?model=empero-ai_Qwen3.8&autoload=false',
    )
  })

  it('returns null on a 404 (skip, no exception)', async () => {
    const fetcher: Fetcher = { fetch: async () => new Response('', { status: 404 }) }
    await expect(probeProps(fetcher, 'http://host:8080', 'm')).resolves.toBeNull()
  })

  it('returns null on a non-2xx status (skip)', async () => {
    const fetcher: Fetcher = { fetch: async () => new Response('nope', { status: 500 }) }
    await expect(probeProps(fetcher, 'http://host:8080', 'm')).resolves.toBeNull()
  })

  it('returns null when the reply is not JSON (skip)', async () => {
    const fetcher: Fetcher = { fetch: async () => new Response('<html>', { status: 200 }) }
    await expect(probeProps(fetcher, 'http://host:8080', 'm')).resolves.toBeNull()
  })

  it('returns null when the reply has no usable n_ctx (skip)', async () => {
    const fetcher: Fetcher = {
      fetch: async () => new Response(JSON.stringify({ default_generation_settings: {} }), { status: 200 }),
    }
    await expect(probeProps(fetcher, 'http://host:8080', 'm')).resolves.toBeNull()
  })

  it('returns null on timeout (aborted signal) without leaking an exception', async () => {
    const fetcher: Fetcher = {
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    }
    await expect(probeProps(fetcher, 'http://host:8080', 'm', { timeoutMs: 20 })).resolves.toBeNull()
  })

  it('returns null when the body exceeds the 4MB ceiling (skip)', async () => {
    const oversized = 'a'.repeat(4 * 1024 * 1024 + 1)
    const fetcher: Fetcher = { fetch: async () => new Response(oversized, { status: 200 }) }
    await expect(probeProps(fetcher, 'http://host:8080', 'm')).resolves.toBeNull()
  })

  it('sends a Bearer header when an api key is supplied', async () => {
    let auth: string | undefined
    const fetcher: Fetcher = {
      fetch: async (_url, init) => {
        auth = (init?.headers as Record<string, string> | undefined)?.authorization
        return new Response(PROPS_BODY, { status: 200 })
      },
    }
    await probeProps(fetcher, 'http://host:8080', 'm', { apiKey: 'secret' })
    expect(auth).toBe('Bearer secret')
  })
})
