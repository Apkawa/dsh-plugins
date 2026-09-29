import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { DdgsSearchProvider, DEFAULT_BACKEND, DEFAULT_MAX_RESULTS, PROVIDER_ID } from '../../../src/provider.ts'
import type { DdgsItem, DdgsRunner, SearchParams } from '../../../src/runner.ts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Runner double: settles on a timer or on the caller signal, whichever first. */
class FakeRunner implements DdgsRunner {
  calls: SearchParams[] = []
  items: DdgsItem[] = [{ href: 'https://a', title: 'A', body: 'B' }]
  active = 0
  maxActive = 0
  started: number[] = []

  constructor(private readonly delayMs = 30) {}

  search(params: SearchParams): Promise<{ items: DdgsItem[] }> {
    this.calls.push(params)
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    this.started.push(Date.now())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.active -= 1
        cleanup()
        resolve({ items: this.items })
      }, this.delayMs)
      const onAbort = () => {
        clearTimeout(timer)
        this.active -= 1
        cleanup()
        reject(new Error('ddgs search aborted'))
      }
      const cleanup = () => params.signal?.removeEventListener('abort', onAbort)
      params.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

function makeVenv(label: string): string {
  const dir = join(tmpdir(), `web-search-ddgs-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, 'venv')
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'bin', 'python'), '')
  return dir
}

const makeProvider = (runner: DdgsRunner, venvDir = makeVenv('p')) =>
  new DdgsSearchProvider({ runner, venvDir, backend: DEFAULT_BACKEND, maxResults: DEFAULT_MAX_RESULTS })

describe('DdgsSearchProvider', () => {
  it('exposes the ddgs provider id', () => {
    expect(makeProvider(new FakeRunner()).id).toBe(PROVIDER_ID)
  })

  it('is available when the managed venv exists', () => {
    expect(makeProvider(new FakeRunner()).available()).toBe(true)
  })

  it('maps runner items to web sources and reports no truncation', async () => {
    const runner = new FakeRunner()
    runner.items = [{ href: 'https://ya.ru/1', title: 'One', body: 'Snippet' }, { href: 'https://b/2' }]
    const result: WebSearchResult = await makeProvider(runner).search({ query: 'react' })
    expect(result.sources).toEqual([
      { url: 'https://ya.ru/1', title: 'One', snippet: 'Snippet' },
      { url: 'https://b/2' },
    ])
    expect(result.truncated).toBe(false)
    expect(result.content).toBeUndefined()
  })

  it('serializes concurrent searches', async () => {
    const runner = new FakeRunner(40)
    const provider = makeProvider(runner)
    const start = Date.now()
    await Promise.all([
      provider.search({ query: 'one' }),
      provider.search({ query: 'two' }),
      provider.search({ query: 'three' }),
    ])
    expect(runner.maxActive).toBe(1)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40 * 3)
  })

  it('applies the per-request maxResults and falls back to the plugin default', async () => {
    const runner = new FakeRunner()
    await makeProvider(runner).search({ query: 'x', maxResults: 3 })
    await makeProvider(runner).search({ query: 'y' })
    expect(runner.calls[0].maxResults).toBe(3)
    expect(runner.calls[1].maxResults).toBe(DEFAULT_MAX_RESULTS)
  })

  it('forwards the caller signal and rejects on abort', async () => {
    const runner = new FakeRunner(60)
    const provider = makeProvider(runner)
    const controller = new AbortController()
    const pending = provider.search({ query: 'x' }, controller.signal)
    await sleep(20)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
  })

  it('propagates runner failures', async () => {
    const failing: DdgsRunner = {
      search: async (_params: SearchParams) => Promise.reject(new Error('DDGSException: No results found.')),
    }
    await expect(makeProvider(failing).search({ query: 'x' })).rejects.toThrow('DDGSException: No results found.')
  })
})
