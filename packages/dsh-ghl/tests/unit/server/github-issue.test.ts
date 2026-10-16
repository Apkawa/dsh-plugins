import { describe, expect, it } from 'vitest'
import { GitHubIssue, IssueNotFoundError, RateLimitError } from '../../../src/issues.ts'
import type { Fetcher, RepoRef } from '../../../src/issues.ts'

const REPO: RepoRef = { owner: 'octo', repo: 'ghl' }

// Recorded slices of the public GitHub API (docs/ghl/api-github.md).

/** GET /repos/{owner}/{repo}/issues — mixed open/closed, one null body, labels. */
const LIST_BODY = [
  {
    id: 101,
    number: 1,
    title: 'Add feature',
    state: 'open',
    body: 'Please add the feature.',
    html_url: 'https://github.com/octo/ghl/issues/1',
    labels: [{ id: 1, name: 'enhancement' }],
  },
  {
    id: 102,
    number: 2,
    title: 'Fix crash',
    state: 'closed',
    body: null,
    html_url: 'https://github.com/octo/ghl/issues/2',
    labels: [],
  },
]

/** GET /repos/{owner}/{repo}/issues/{number} — a single issue. */
const GET_BODY = {
  id: 142,
  number: 42,
  title: 'Crash on start',
  state: 'open',
  body: 'Steps to reproduce: launch, click Save, crash.',
  html_url: 'https://github.com/octo/ghl/issues/42',
  labels: [
    { id: 2, name: 'bug' },
    { id: 3, name: 'P0' },
  ],
}

/** A fake Fetcher returning one recorded reply, capturing every requested URL and init. A 304 reply carries no body. */
function recorded(body: unknown, status = 200, etag?: string) {
  const urls: string[] = []
  const inits: Array<RequestInit | undefined> = []
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (etag !== undefined) headers['etag'] = etag
  const fetcher: Fetcher = (url, init) => {
    urls.push(url)
    inits.push(init)
    return Promise.resolve(new Response(status === 304 ? null : JSON.stringify(body), { status, headers }))
  }
  return { urls, inits, fetcher }
}

describe('GitHubIssue', () => {
  it('maps a mixed open/closed list to Issue records and requests the list endpoint', async () => {
    const fake = recorded(LIST_BODY)
    const result = await new GitHubIssue(fake.fetcher).listIssues(REPO)
    expect(result.value).toEqual([
      { number: 1, title: 'Add feature', state: 'open', body: 'Please add the feature.', htmlUrl: 'https://github.com/octo/ghl/issues/1', labels: ['enhancement'] },
      { number: 2, title: 'Fix crash', state: 'closed', body: '', htmlUrl: 'https://github.com/octo/ghl/issues/2', labels: [] },
    ])
    expect(result.status).toBe(200)
    expect(fake.urls[0]).toBe('https://api.github.com/repos/octo/ghl/issues')
  })

  it('serializes list params into the query string', async () => {
    const fake = recorded(LIST_BODY)
    await new GitHubIssue(fake.fetcher).listIssues(REPO, { state: 'all', perPage: 5, page: 2 })
    expect(fake.urls[0]).toBe('https://api.github.com/repos/octo/ghl/issues?state=all&per_page=5&page=2')
  })

  it('rejects a rate-limited listing (403) with RateLimitError', async () => {
    const fake = recorded('Rate limit exceeded', 403)
    await expect(new GitHubIssue(fake.fetcher).listIssues(REPO)).rejects.toBeInstanceOf(RateLimitError)
  })

  it('maps a single issue reply and requests the numbered endpoint', async () => {
    const fake = recorded(GET_BODY)
    const result = await new GitHubIssue(fake.fetcher).getIssue(REPO, 42)
    expect(result.value).toEqual({
      number: 42,
      title: 'Crash on start',
      state: 'open',
      body: 'Steps to reproduce: launch, click Save, crash.',
      htmlUrl: 'https://github.com/octo/ghl/issues/42',
      labels: ['bug', 'P0'],
    })
    expect(result.status).toBe(200)
    expect(fake.urls[0]).toBe('https://api.github.com/repos/octo/ghl/issues/42')
  })

  it('rejects a missing issue (404) with IssueNotFoundError', async () => {
    const fake = recorded({ message: 'Not Found' }, 404)
    await expect(new GitHubIssue(fake.fetcher).getIssue(REPO, 999)).rejects.toBeInstanceOf(IssueNotFoundError)
  })

  it('rejects a rate-limited fetch (429) with RateLimitError', async () => {
    const fake = recorded({ message: 'Abuse detected' }, 429)
    await expect(new GitHubIssue(fake.fetcher).getIssue(REPO, 42)).rejects.toBeInstanceOf(RateLimitError)
  })

  it('sends the given etag as an If-None-Match header', async () => {
    const fake = recorded(GET_BODY)
    const result = await new GitHubIssue(fake.fetcher).getIssue(REPO, 42, { etag: 'w/"abc"' })
    expect(result.status).toBe(200)
    const headers = (fake.inits[0]?.headers ?? {}) as Record<string, string>
    expect(headers['if-none-match']).toBe('w/"abc"')
  })

  it('sends no If-None-Match header when no etag is given', async () => {
    const fake = recorded(GET_BODY)
    await new GitHubIssue(fake.fetcher).getIssue(REPO, 42)
    const headers = (fake.inits[0]?.headers ?? {}) as Record<string, string>
    expect(headers['if-none-match']).toBeUndefined()
  })

  it('returns the mapped value, status, and response etag on 200', async () => {
    const fake = recorded(GET_BODY, 200, 'w/"def"')
    const result = await new GitHubIssue(fake.fetcher).getIssue(REPO, 42)
    expect(result).toEqual({
      value: {
        number: 42,
        title: 'Crash on start',
        state: 'open',
        body: 'Steps to reproduce: launch, click Save, crash.',
        htmlUrl: 'https://github.com/octo/ghl/issues/42',
        labels: ['bug', 'P0'],
      },
      status: 200,
      etag: 'w/"def"',
    })
  })

  it('omits the etag field when the response has no ETag header', async () => {
    const fake = recorded(GET_BODY)
    const result = await new GitHubIssue(fake.fetcher).getIssue(REPO, 42)
    expect(result.status).toBe(200)
    expect(result.etag).toBeUndefined()
  })

  it('returns a null value and the sent etag on 304 without parsing the body', async () => {
    const fake = recorded('not json', 304, 'w/"abc"')
    const result = await new GitHubIssue(fake.fetcher).getIssue(REPO, 42, { etag: 'w/"abc"' })
    expect(result).toEqual({ value: null, status: 304, etag: 'w/"abc"' })
  })

  it('carries the list result object with status and etag', async () => {
    const fake = recorded(LIST_BODY, 200, 'w/"list"')
    const result = await new GitHubIssue(fake.fetcher).listIssues(REPO)
    expect(result.value).toEqual([
      { number: 1, title: 'Add feature', state: 'open', body: 'Please add the feature.', htmlUrl: 'https://github.com/octo/ghl/issues/1', labels: ['enhancement'] },
      { number: 2, title: 'Fix crash', state: 'closed', body: '', htmlUrl: 'https://github.com/octo/ghl/issues/2', labels: [] },
    ])
    expect(result.status).toBe(200)
    expect(result.etag).toBe('w/"list"')
  })
})
