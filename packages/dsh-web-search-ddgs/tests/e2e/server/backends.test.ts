import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createRunner, DEFAULT_SCRIPT_PATH, type DdgsRunner, type RunnerResult } from '../../../src/runner.ts'

/**
 * Live e2e, one real search per backend: a single shared runner (real `uv`,
 * real network) provisions one venv for the whole suite and searches through
 * duckduckgo, bing, and yandex in turn — the yandex case covers
 * `ddgs-search.py` re-registering the upstream-disabled yandex engine.
 * Self-skips when `uv` is not on PATH — the managed venv cannot be
 * provisioned without it.
 */
const uvAvailable = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0

// The uv global cache is not writable in the sandbox: point uv at a
// repo-local cache (two levels up from this package dir) before the runner
// provisions the venv.
const uvCacheDir = fileURLToPath(new URL('../../../../.cache/uv', import.meta.url))

let venvDir: string
let runner: DdgsRunner

describe.skipIf(!uvAvailable)('ddgs backends (real uv + network)', () => {
  beforeAll(async () => {
    process.env.UV_CACHE_DIR = uvCacheDir
    venvDir = mkdtempSync(join(tmpdir(), 'web-search-ddgs-backends-'))
    runner = createRunner({ venvDir, ddgsVersion: 'ddgs', scriptPath: DEFAULT_SCRIPT_PATH, timeoutMs: 60_000 })
  }, 30_000)

  afterAll(async () => {
    rmSync(venvDir, { recursive: true, force: true })
  }, 30_000)

  describe.each(['duckduckgo', 'bing', 'yandex'])('backend %s', backend => {
    // Engines intermittently return zero results: `ddgs-search.py` turns
    // `DDGSException: No results found.` into exit 1, so one attempt on a valid
    // query can fail. Probes showed duckduckgo throttling in runs of 5-12
    // consecutive failures that lift only after tens of seconds (so it retries
    // with a long backoff), bing failing as isolated attempts (a few retries
    // suffice), yandex clean. Retry the same search and assert on whichever
    // attempt yields real results; once the attempts run out, the last error is
    // what the test surfaces.
    const duckduckgo = backend === 'duckduckgo'
    const attempts = duckduckgo ? 12 : 4
    const backoffMs = duckduckgo ? 5_000 : 2_000

    it('returns real search results with URLs', async () => {
      const result = await searchWithRetry(1)
      expect(result.items.length).toBeGreaterThanOrEqual(1)
      for (const item of result.items) {
        expect(item.href).toMatch(/^https?:\/\//)
      }
    })

    function searchWithRetry(attempt: number): Promise<RunnerResult> {
      return runner.search({ query: 'react version', backend, maxResults: 3 }).then(result => {
        if (result.items.length === 0 && attempt < attempts) return backoffThenRetry(attempt)
        return result
      }, error => {
        // Only the empty-results failure is a transient engine hiccup; a
        // timeout or malformed output is a real failure and must surface.
        if (attempt >= attempts || !(error instanceof Error) || !error.message.includes('No results found')) throw error
        return backoffThenRetry(attempt)
      })
    }

    function backoffThenRetry(attempt: number): Promise<RunnerResult> {
      return new Promise<void>(resolve => setTimeout(resolve, backoffMs)).then(() => searchWithRetry(attempt + 1))
    }
  })
}, 180_000)
