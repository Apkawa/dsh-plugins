import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import { DdgsSearchProvider, DEFAULT_BACKEND } from '../../../src/provider.ts'
import { createRunner, DEFAULT_SCRIPT_PATH } from '../../../src/runner.ts'

/**
 * Live search e2e: the real runner (real `uv`, real network) end-to-end through
 * the provider. Self-skips when `uv` is not on PATH — the managed venv cannot
 * be provisioned without it.
 */
const uvAvailable = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0

// The uv global cache is not writable in the sandbox: point uv at a
// repo-local cache (two levels up from this package dir) before the runner
// provisions the venv.
const uvCacheDir = fileURLToPath(new URL('../../../../.cache/uv', import.meta.url))

let venvDir: string
let provider: DdgsSearchProvider

describe.skipIf(!uvAvailable)('live ddgs search (real uv + network)', () => {
  beforeAll(async () => {
    process.env.UV_CACHE_DIR = uvCacheDir
    venvDir = mkdtempSync(join(tmpdir(), 'web-search-ddgs-live-'))
    provider = new DdgsSearchProvider({
      runner: createRunner({ venvDir, ddgsVersion: 'ddgs', scriptPath: DEFAULT_SCRIPT_PATH, timeoutMs: 60_000 }),
      venvDir,
      backend: DEFAULT_BACKEND,
      maxResults: 5,
    })
  }, 30_000)

  afterAll(async () => {
    rmSync(venvDir, { recursive: true, force: true })
  }, 30_000)

  it('is available and reports its id', async () => {
    expect(provider.available()).toBe(true)
    expect(provider.id).toBe('ddgs')
  })

  // DDG — the provider's default backend — intermittently returns zero
  // results: `ddgs-search.py` turns `DDGSException: No results found.` into
  // exit 1, so a single attempt on a valid query can fail. The failures come in
  // runs of 5-12 failed attempts and the throttle lifts only after tens of
  // seconds, so retry the same search with a long backoff and assert on
  // whichever attempt yields real results; if every attempt fails, the last
  // error is what the test surfaces.
  const attempts = 12

  it('returns real search results with URLs', async () => {
    const result = await searchWithRetry(1)
    expect(result.truncated).toBe(false)
    expect(result.sources.length).toBeGreaterThanOrEqual(1)
    for (const source of result.sources) {
      expect(source.url).toMatch(/^https?:\/\//)
    }
  })

  function searchWithRetry(attempt: number): Promise<WebSearchResult> {
    return provider.search({ query: 'react version', maxResults: 5 }).then(result => {
      if (result.sources.length === 0 && attempt < attempts) return backoffThenRetry(attempt)
      return result
    }, error => {
      // Only the empty-results failure is a transient engine hiccup; a
      // timeout or malformed output is a real failure and must surface.
      if (attempt >= attempts || !(error instanceof Error) || !error.message.includes('No results found')) throw error
      return backoffThenRetry(attempt)
    })
  }

  function backoffThenRetry(attempt: number): Promise<WebSearchResult> {
    return new Promise<void>(resolve => setTimeout(resolve, 5_000)).then(() => searchWithRetry(attempt + 1))
  }
}, 180_000)
