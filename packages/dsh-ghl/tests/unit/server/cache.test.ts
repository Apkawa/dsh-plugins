import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIssueCache } from '../../../src/cache.ts'
import { IssueNotFoundError, RateLimitError } from '../../../src/issues.ts'
import type { BaseIssue, Issue, IssueResult, RepoRef } from '../../../src/issues.ts'

const REPO: RepoRef = { owner: 'octo', repo: 'ghl' }

/** A single canned issue. */
function makeIssue(number: number): Issue {
  return { number, title: `Issue ${number}`, state: 'open', body: 'body', htmlUrl: `https://github.com/octo/ghl/issues/${number}`, labels: [] }
}

interface FakeOptions {
  /** Issue numbers whose get should reject with IssueNotFoundError. */
  notFound?: number[]
  /** Issue numbers whose get should reject with RateLimitError. */
  rateLimited?: number[]
  /** When set, a get answered with a matching stored etag replies 304 (revalidation). */
  revalidate?: boolean
  /** The etag a 200 response carries. */
  etag?: string
}

/** A fake BaseIssue that records every call (including the sent etag) and returns canned results / throws. */
function fakeProvider(options: FakeOptions = {}) {
  const calls: string[] = []
  const sentEtags: Array<string | undefined> = []
  const ok = <T>(value: T): IssueResult<T> => {
    const result: IssueResult<T> = { value, status: 200 }
    if (options.etag !== undefined) result.etag = options.etag
    return result
  }
  const provider: BaseIssue = {
    listIssues(repo, params, opts) {
      calls.push(`list:${repo.owner}/${repo.repo}:${JSON.stringify(params ?? {})}`)
      sentEtags.push(opts?.etag)
      return Promise.resolve(ok([makeIssue(1)]))
    },
    getIssue(repo, number, opts) {
      calls.push(`get:${repo.owner}/${repo.repo}:${number}`)
      sentEtags.push(opts?.etag)
      if (options.notFound?.includes(number)) return Promise.reject(new IssueNotFoundError(repo, number))
      if (options.rateLimited?.includes(number)) return Promise.reject(new RateLimitError(429))
      if (options.revalidate && opts?.etag !== undefined) return Promise.resolve({ value: null, status: 304, etag: opts.etag })
      return Promise.resolve(ok(makeIssue(number)))
    },
  }
  return { calls, sentEtags, provider }
}

/** A mutable clock so every test controls time explicitly (no real time). */
function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createIssueCache', () => {
  it('serves a repeated get from cache without calling the provider again', async () => {
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000 })
    await cache.getIssue(REPO, 42)
    await cache.getIssue(REPO, 42)
    expect(calls).toEqual(['get:octo/ghl:42'])
  })

  it('serves a repeated list from cache without calling the provider again', async () => {
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000 })
    await cache.listIssues(REPO, { state: 'open' })
    await cache.listIssues(REPO, { state: 'open' })
    expect(calls).toEqual(['list:octo/ghl:{"state":"open"}'])
  })

  it('refetches after the TTL expires', async () => {
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 60_000 })
    await cache.getIssue(REPO, 42)
    time.advance(60_001)
    await cache.getIssue(REPO, 42)
    expect(calls).toEqual(['get:octo/ghl:42', 'get:octo/ghl:42'])
  })

  it('does not share entries across distinct keys', async () => {
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000 })
    await cache.getIssue(REPO, 1)
    await cache.getIssue(REPO, 2)
    await cache.listIssues(REPO, { state: 'open' })
    await cache.listIssues(REPO, { state: 'closed' })
    expect(calls).toEqual([
      'get:octo/ghl:1',
      'get:octo/ghl:2',
      'list:octo/ghl:{"state":"open"}',
      'list:octo/ghl:{"state":"closed"}',
    ])
  })

  it('fails fast with RateLimitError once the hourly budget is used, without calling the provider', async () => {
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000, budgetPerHour: 3 })
    await cache.getIssue(REPO, 1)
    await cache.getIssue(REPO, 2)
    await cache.getIssue(REPO, 3)
    expect(calls).toHaveLength(3)
    await expect(cache.getIssue(REPO, 4)).rejects.toBeInstanceOf(RateLimitError)
    expect(calls).toHaveLength(3)
  })

  it('releases budget slots as the sliding window advances', async () => {
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000, budgetPerHour: 2 })
    await cache.getIssue(REPO, 1)
    await cache.getIssue(REPO, 2)
    time.advance(60 * 60 * 1000 + 1)
    await cache.getIssue(REPO, 3)
    expect(calls).toHaveLength(3)
  })

  it('caches a 404 briefly so a repeat get does not hit the provider', async () => {
    const { calls, provider } = fakeProvider({ notFound: [999] })
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000 })
    await expect(cache.getIssue(REPO, 999)).rejects.toBeInstanceOf(IssueNotFoundError)
    await expect(cache.getIssue(REPO, 999)).rejects.toBeInstanceOf(IssueNotFoundError)
    expect(calls).toEqual(['get:octo/ghl:999'])
  })

  it('lets a negative entry expire after the short TTL', async () => {
    const { calls, provider } = fakeProvider({ notFound: [999] })
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000 })
    await expect(cache.getIssue(REPO, 999)).rejects.toBeInstanceOf(IssueNotFoundError)
    time.advance(60_001)
    await expect(cache.getIssue(REPO, 999)).rejects.toBeInstanceOf(IssueNotFoundError)
    expect(calls).toEqual(['get:octo/ghl:999', 'get:octo/ghl:999'])
  })

  it('does not cache a RateLimitError, so the next get hits the provider', async () => {
    const { calls, provider } = fakeProvider({ rateLimited: [5] })
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now, ttlMs: 300_000 })
    await expect(cache.getIssue(REPO, 5)).rejects.toBeInstanceOf(RateLimitError)
    await expect(cache.getIssue(REPO, 5)).rejects.toBeInstanceOf(RateLimitError)
    expect(calls).toEqual(['get:octo/ghl:5', 'get:octo/ghl:5'])
  })

  it('uses a 60-second default TTL (refetch at 60 s, not before)', async () => {
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now })
    await cache.getIssue(REPO, 42)
    time.advance(59_999)
    await cache.getIssue(REPO, 42)
    expect(calls).toHaveLength(1)
    time.advance(1)
    await cache.getIssue(REPO, 42)
    expect(calls).toHaveLength(2)
  })

  it('sends the stored etag as If-None-Match on the next miss', async () => {
    const { sentEtags, provider } = fakeProvider({ etag: '"fresh"' })
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now })
    const first = await cache.getIssue(REPO, 7)
    expect(first.status).toBe(200)
    expect(first.etag).toBe('"fresh"')
    time.advance(60_001)
    await cache.getIssue(REPO, 7)
    expect(sentEtags).toEqual([undefined, '"fresh"'])
  })

  it('keeps the stored value on a 304 revalidation and refreshes the entry', async () => {
    const { calls, sentEtags, provider } = fakeProvider({ revalidate: true, etag: '"abc"' })
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now })
    const first = await cache.getIssue(REPO, 42)
    time.advance(60_001)
    const second = await cache.getIssue(REPO, 42)
    expect(sentEtags).toEqual([undefined, '"abc"'])
    expect(second.value).toEqual(first.value)
    expect(second.status).toBe(304)
    expect(second.etag).toBe('"abc"')
    const third = await cache.getIssue(REPO, 42)
    expect(calls).toHaveLength(2)
    expect(third.value).toEqual(first.value)
  })

  it('clear removes only that repo\'s get: and list: entries', async () => {
    const other: RepoRef = { owner: 'octo', repo: 'other' }
    const { calls, provider } = fakeProvider()
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now })
    await cache.getIssue(REPO, 1)
    await cache.listIssues(REPO, { state: 'open' })
    await cache.getIssue(other, 1)
    await cache.listIssues(other)
    cache.clear(REPO)
    await cache.getIssue(REPO, 1)
    await cache.listIssues(REPO, { state: 'open' })
    await cache.getIssue(other, 1)
    await cache.listIssues(other)
    expect(calls).toEqual([
      'get:octo/ghl:1',
      'list:octo/ghl:{"state":"open"}',
      'get:octo/other:1',
      'list:octo/other:{}',
      'get:octo/ghl:1',
      'list:octo/ghl:{"state":"open"}',
    ])
  })
})

describe('createIssueCache — debug log lines', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.DEBUG
    process.env.DEBUG = '1'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DEBUG
    else process.env.DEBUG = original
  })

  it('logs GET <status> <url> [cache-miss] then [cached] for a get', async () => {
    const debug = vi.spyOn(console, 'debug')
    const { provider } = fakeProvider()
    const cache = createIssueCache(provider, { now: clock().now })
    await cache.getIssue(REPO, 42)
    await cache.getIssue(REPO, 42)
    expect(debug).toHaveBeenCalledWith('DEBUG [ghl] GET 200 https://api.github.com/repos/octo/ghl/issues/42 [cache-miss]')
    expect(debug).toHaveBeenLastCalledWith('DEBUG [ghl] GET 200 https://api.github.com/repos/octo/ghl/issues/42 [cached]')
    debug.mockRestore()
  })

  it('logs the list URL with the serialized query params', async () => {
    const debug = vi.spyOn(console, 'debug')
    const { provider } = fakeProvider()
    const cache = createIssueCache(provider, { now: clock().now })
    await cache.listIssues(REPO, { state: 'open', perPage: 30 })
    expect(debug).toHaveBeenLastCalledWith('DEBUG [ghl] GET 200 https://api.github.com/repos/octo/ghl/issues?state=open&per_page=30 [cache-miss]')
    debug.mockRestore()
  })

  it('logs the 304 status on a revalidation miss', async () => {
    const debug = vi.spyOn(console, 'debug')
    const { provider } = fakeProvider({ revalidate: true, etag: '"abc"' })
    const time = clock()
    const cache = createIssueCache(provider, { now: time.now })
    await cache.getIssue(REPO, 42)
    time.advance(60_001)
    await cache.getIssue(REPO, 42)
    expect(debug).toHaveBeenLastCalledWith('DEBUG [ghl] GET 304 https://api.github.com/repos/octo/ghl/issues/42 [cache-miss]')
    debug.mockRestore()
  })

  it('logs GET 404 <url> [cached] on a negative hit', async () => {
    const debug = vi.spyOn(console, 'debug')
    const { provider } = fakeProvider({ notFound: [999] })
    const cache = createIssueCache(provider, { now: clock().now })
    await expect(cache.getIssue(REPO, 999)).rejects.toBeInstanceOf(IssueNotFoundError)
    await expect(cache.getIssue(REPO, 999)).rejects.toBeInstanceOf(IssueNotFoundError)
    expect(debug).toHaveBeenLastCalledWith('DEBUG [ghl] GET 404 https://api.github.com/repos/octo/ghl/issues/999 [cached]')
    debug.mockRestore()
  })
})
