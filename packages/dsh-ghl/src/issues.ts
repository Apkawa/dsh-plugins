/**
 * Issue provider seam (host half). `BaseIssue` is the provider-agnostic
 * contract for read-only issue access; `GitHubIssue` is the GitHub
 * implementation over the public REST API (no token) and an injected
 * `Fetcher` boundary.
 */

import { Log } from '@apkawa/utils'

const logger = new Log('ghl')

/** A repository coordinate. */
export interface RepoRef {
  owner: string
  repo: string
}

/** A single issue as the plugin consumes it. */
export interface Issue {
  number: number
  title: string
  state: 'open' | 'closed'
  /** The issue body; empty when the API returned null. */
  body: string
  htmlUrl: string
  /** Label names; empty when the issue has none. */
  labels: string[]
}

/** Parameters for `BaseIssue.listIssues`. */
export interface ListIssuesParams {
  state?: 'open' | 'closed' | 'all'
  /** Page size (GitHub caps at 100). */
  perPage?: number
  /** 1-based page index. */
  page?: number
}

/**
 * One page of issues. The GitHub list reply is a bare JSON array; pagination
 * rides the `Link` header, which is out of scope for the provider contract.
 */
export type IssueListResult = Issue[]

/** An injected HTTP boundary; production passes the global fetch. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The outcome of one issue read. `value` is null on a 304 (the body is not
 * parsed); `status` is the HTTP status; `etag` is the response's fresh ETag
 * when present (the etag sent on a 304).
 */
export interface IssueResult<T> {
  value: T | null
  status: number
  etag?: string
}

/**
 * The provider-agnostic issue contract. Future providers (Gitea, Gitverse)
 * implement this; no GitHub-specific fields leak into it.
 */
export interface BaseIssue {
  listIssues(repo: RepoRef, params?: ListIssuesParams, opts?: { etag?: string }): Promise<IssueResult<IssueListResult>>
  getIssue(repo: RepoRef, number: number, opts?: { etag?: string }): Promise<IssueResult<Issue>>
}

/** The requested resource does not exist (GitHub 404). */
export class IssueNotFoundError extends Error {
  constructor(repo: RepoRef, number?: number) {
    const target = number === undefined ? `${repo.owner}/${repo.repo}` : `issue ${number} in ${repo.owner}/${repo.repo}`
    super(`not found: ${target}`)
    this.name = 'IssueNotFoundError'
  }
}

/** GitHub's rate limit is exhausted (HTTP 403/429). */
export class RateLimitError extends Error {
  constructor(status: number) {
    super(`GitHub rate limit exceeded (HTTP ${status})`)
    this.name = 'RateLimitError'
  }
}

/** The read-only GitHub issue provider over the public REST API (no token). */
export class GitHubIssue implements BaseIssue {
  constructor(private readonly fetcher: Fetcher) {}

  listIssues(repo: RepoRef, params?: ListIssuesParams, opts?: { etag?: string }): Promise<IssueResult<IssueListResult>> {
    return this.request(repo, issuesUrl(repo, params), undefined, opts, raw => (raw as unknown[]).map(toIssue))
  }

  getIssue(repo: RepoRef, number: number, opts?: { etag?: string }): Promise<IssueResult<Issue>> {
    return this.request(repo, issueUrl(repo, number), number, opts, raw => toIssue(raw))
  }

  /**
   * Perform one GET against the public API, mapping failure statuses to
   * distinct errors. A sent `opts.etag` rides an `If-None-Match` header; a
   * 304 answer (no body) returns a null value with the etag sent.
   */
  private async request<T>(repo: RepoRef, url: string, number: number | undefined, opts: { etag?: string } | undefined, map: (raw: unknown) => T): Promise<IssueResult<T>> {
    logger.debug('request: GET', url)
    const etag = opts?.etag
    const init: RequestInit | undefined = etag === undefined ? undefined : { headers: { 'if-none-match': etag } }
    const response = await this.fetcher(url, init)
    if (response.status === 403 || response.status === 429) { logger.error('rate limit', `GET ${url} → HTTP ${response.status}`); throw new RateLimitError(response.status) }
    if (response.status === 404) { logger.error('not found', `GET ${url} → HTTP 404`); throw new IssueNotFoundError(repo, number) }
    if (response.status === 304) {
      // A 304 is not ok but is a success here: the body is never parsed.
      const notModified: IssueResult<T> = { value: null, status: 304 }
      if (etag !== undefined) notModified.etag = etag
      return notModified
    }
    if (!response.ok) { logger.error('GitHub API failure', `GET ${url} → HTTP ${response.status}`); throw new Error(`GitHub API HTTP ${response.status} for ${url}`) }
    const fresh: IssueResult<T> = { value: map(await response.json()), status: response.status }
    const responseEtag = response.headers.get('etag')
    if (responseEtag !== null) fresh.etag = responseEtag
    return fresh
  }
}

/** The full public-API URL for one page of issues, with the optional query params serialized. */
export function issuesUrl(repo: RepoRef, params?: ListIssuesParams): string {
  const search = new URLSearchParams()
  if (params?.state !== undefined) search.set('state', params.state)
  if (params?.perPage !== undefined) search.set('per_page', String(params.perPage))
  if (params?.page !== undefined) search.set('page', String(params.page))
  const query = search.toString()
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/issues`
  return query === '' ? url : `${url}?${query}`
}

/** The full public-API URL for a single issue. */
export function issueUrl(repo: RepoRef, number: number): string {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${number}`
}

/** Map one GitHub issue object to the provider-agnostic `Issue` shape. */
function toIssue(raw: unknown): Issue {
  const issue = raw as Record<string, unknown>
  const labels = Array.isArray(issue.labels) ? issue.labels : []
  return {
    number: issue.number as number,
    title: issue.title as string,
    state: issue.state as Issue['state'],
    body: typeof issue.body === 'string' ? issue.body : '',
    htmlUrl: issue.html_url as string,
    labels: labels.map(label => (label as { name: string }).name),
  }
}
