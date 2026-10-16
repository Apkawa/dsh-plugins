/**
 * Issue cache (host half). A transparent `BaseIssue` wrapper in front of a
 * provider that adds TTL caching with ETag revalidation and a sliding-window
 * call budget, so the unauthenticated GitHub rate limit (60 req/h) is not
 * exceeded and repeated lookups are not re-requested. Time and budgets are
 * injected for testability.
 */

import type { BaseIssue, Issue, IssueListResult, IssueResult, ListIssuesParams, RepoRef } from './issues.ts'
import { IssueNotFoundError, RateLimitError, issueUrl, issuesUrl } from './issues.ts'
import { Log } from '@apkawa/utils'

const logger = new Log('ghl')

interface CacheOptions {
  now?: () => number
  ttlMs?: number
  budgetPerHour?: number
}

interface Entry {
  expires: number
  status: number
  etag?: string
  notFound: IssueNotFoundError | null
  value: Issue | IssueListResult | null
}

const DEFAULT_TTL_MS = 60_000
const NEGATIVE_TTL_MS = 60_000
const WINDOW_MS = 60 * 60 * 1000
const DEFAULT_BUDGET = 60

/** A TTL + ETag + budget-aware cache in front of a `BaseIssue` provider. */
export function createIssueCache(provider: BaseIssue, options: CacheOptions = {}): BaseIssue & { clear(repo: RepoRef): void } {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const budgetPerHour = options.budgetPerHour ?? DEFAULT_BUDGET
  const cache = new Map<string, Entry>()
  const calls: number[] = []

  return {
    async listIssues(repo, params) {
      const url = issuesUrl(repo, params)
      const key = listKey(repo, params)
      const state = lookup(key)
      if (state.entry !== null) { logger.debug(`GET ${state.entry.status} ${url} [cached]`); return settle(state.entry) as Promise<IssueResult<IssueListResult>> }
      return miss<IssueListResult>(key, url, state.stale, () => provider.listIssues(repo, params, etagOpts(state.stale)))
    },
    async getIssue(repo, number) {
      const url = issueUrl(repo, number)
      const key = getKey(repo, number)
      const state = lookup(key)
      if (state.entry !== null) { logger.debug(`GET ${state.entry.status} ${url} [cached]`); return settle(state.entry) as Promise<IssueResult<Issue>> }
      return miss<Issue>(key, url, state.stale, () => provider.getIssue(repo, number, etagOpts(state.stale)))
    },
    clear(repo) {
      const prefix = `${repo.owner}/${repo.repo}`
      const keys = [...cache.keys()]
      keys
        .filter(key => {
          const body = key.slice(key.indexOf(':') + 1)
          return body === prefix || body.startsWith(`${prefix}:`)
        })
        .forEach(key => cache.delete(key))
    },
  }

  /** The key's fresh entry (hit) and stale entry (expired, dropped from the map). */
  function lookup(key: string): { entry: Entry | null; stale: Entry | null } {
    const found = cache.get(key)
    if (found === undefined) return { entry: null, stale: null }
    if (now() < found.expires) return { entry: found, stale: null }
    cache.delete(key)
    return { entry: null, stale: found }
  }

  /** Resolve (or reject) a cached entry as an `IssueResult`. */
  function settle(entry: Entry): Promise<IssueResult<Issue | IssueListResult>> {
    if (entry.notFound) return Promise.reject(entry.notFound)
    const result: IssueResult<Issue | IssueListResult> = { value: entry.value, status: entry.status }
    if (entry.etag !== undefined) result.etag = entry.etag
    return Promise.resolve(result)
  }

  /** The revalidation opts for a stale entry; undefined carries no etag. */
  function etagOpts(stale: Entry | null): { etag?: string } | undefined {
    return stale?.etag === undefined ? undefined : { etag: stale.etag }
  }

  /**
   * A cache miss: charge the budget (failing fast when exhausted), call the
   * provider, and store the outcome. A 304 revalidation keeps the stale
   * value and refreshes its expiry; `IssueNotFoundError` is cached (briefly);
   * `RateLimitError` and other errors are never cached.
   */
  function miss<T extends Issue | IssueListResult>(key: string, url: string, stale: Entry | null, fetch: () => Promise<IssueResult<T>>): Promise<IssueResult<T>> {
    const t = now()
    guard(t)
    return fetch().then(
      outcome => {
        if (outcome.status === 304) {
          const etag = outcome.etag ?? stale?.etag
          const value = (stale?.value ?? null) as T | null
          store(key, t + ttlMs, outcome.status, etag, null, value)
          const result: IssueResult<T> = { value, status: outcome.status }
          if (etag !== undefined) result.etag = etag
          logger.debug(`GET ${outcome.status} ${url} [cache-miss]`)
          return result
        }
        store(key, t + ttlMs, outcome.status, outcome.etag, null, outcome.value)
        logger.debug(`GET ${outcome.status} ${url} [cache-miss]`)
        return outcome
      },
      (error: unknown) => {
        if (error instanceof IssueNotFoundError) store(key, t + NEGATIVE_TTL_MS, 404, undefined, error, null)
        throw error
      },
    )
  }

  /** Record one upstream call, throwing when the sliding-hour window is full. */
  function guard(t: number) {
    const cutoff = t - WINDOW_MS
    while (calls.length > 0 && (calls[0] ?? Infinity) < cutoff) calls.shift()
    if (calls.length >= budgetPerHour) { logger.warn('rate budget exhausted', `${calls.length}/${budgetPerHour} calls in the sliding hour`); throw new RateLimitError(429) }
    calls.push(t)
  }

  /** Store one entry. */
  function store(key: string, expires: number, status: number, etag: string | undefined, notFound: IssueNotFoundError | null, value: Issue | IssueListResult | null) {
    const entry: Entry = { expires, status, notFound, value }
    if (etag !== undefined) entry.etag = etag
    cache.set(key, entry)
  }

  /** Cache key for a single issue: repo + number. */
  function getKey(repo: RepoRef, number: number): string {
    return `get:${repo.owner}/${repo.repo}:${number}`
  }

  /** Cache key for a listing: repo + serialized query params. */
  function listKey(repo: RepoRef, params?: ListIssuesParams): string {
    const query = new URLSearchParams()
    if (params?.state !== undefined) query.set('state', params.state)
    if (params?.perPage !== undefined) query.set('per_page', String(params.perPage))
    if (params?.page !== undefined) query.set('page', String(params.page))
    const suffix = query.toString()
    return `list:${repo.owner}/${repo.repo}${suffix === '' ? '' : `:${suffix}`}`
  }
}
