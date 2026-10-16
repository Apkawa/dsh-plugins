import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { IssueNotFoundError, RateLimitError, type BaseIssue, type Issue, type IssueListResult, type IssueResult, type ListIssuesParams, type RepoRef } from '../../../src/issues.ts'
import { endpointFromPath, handleRequest, makeRpcHandler, mountChannel, type RpcDeps, type WebRoute, type WebServerRegistry } from '../../../src/rpc.ts'
import type { DetectionResult } from '../../../src/repo.ts'

const REPO: RepoRef = { owner: 'octo', repo: 'ghl' }
const ISSUE: Issue = { number: 1, title: 'a title', state: 'open', body: 'a body', htmlUrl: 'https://github.com/octo/ghl/issues/1', labels: [] }

/** A `BaseIssue` double that records its calls (order in `calls`) and resolves fixed `IssueResult` outcomes (or throws). */
class FakeIssue implements BaseIssue {
  listCalls: Array<{ repo: RepoRef; params?: ListIssuesParams }> = []
  getCalls: Array<{ repo: RepoRef; number: number }> = []
  clearCalls: RepoRef[] = []
  calls: string[] = []
  listResult: IssueResult<IssueListResult> = { value: [ISSUE], status: 200 }
  getResult: IssueResult<Issue> = { value: ISSUE, status: 200 }
  listError: unknown = null
  getError: unknown = null

  async listIssues(repo: RepoRef, params?: ListIssuesParams): Promise<IssueResult<IssueListResult>> {
    this.calls.push('list')
    this.listCalls.push({ repo, params })
    if (this.listError !== null) throw this.listError
    return this.listResult
  }

  async getIssue(repo: RepoRef, number: number): Promise<IssueResult<Issue>> {
    this.calls.push('get')
    this.getCalls.push({ repo, number })
    if (this.getError !== null) throw this.getError
    return this.getResult
  }

  clear(repo: RepoRef): void {
    this.calls.push('clear')
    this.clearCalls.push(repo)
  }
}

/** The channel deps over a fake provider and a fixed detected repo (a null repo is a failed detection). */
function deps(issue: RpcDeps['issue'], repo: RepoRef | null): RpcDeps {
  return {
    issue,
    getRepo: async () => (repo === null ? { ok: false, code: 'no-remote', message: 'no repo' } : { ok: true, repo }),
  }
}

/** The channel deps over a fake provider and a fixed `DetectionResult` (a failure is supplied verbatim). */
function depsFor(issue: RpcDeps['issue'], result: DetectionResult): RpcDeps {
  return { issue, getRepo: async () => result }
}

describe('makeRpcHandler — detectRepo', () => {
  it('returns the detected repo', async () => {
    const handler = makeRpcHandler(deps(new FakeIssue(), REPO))
    expect(await handler('detectRepo', null)).toEqual({ ok: true, value: { repo: REPO } })
  })

  it('passes through a no-workspace detection failure verbatim', async () => {
    const result: DetectionResult = { ok: false, code: 'no-workspace', message: 'no workspace is registered' }
    const handler = makeRpcHandler(depsFor(new FakeIssue(), result))
    expect(await handler('detectRepo', null)).toEqual({ ok: false, error: { code: 'no-workspace', message: 'no workspace is registered', details: {} } })
  })

  it('passes through an ambiguous-workspace detection failure verbatim', async () => {
    const result: DetectionResult = { ok: false, code: 'ambiguous-workspace', message: 'multiple workspaces: /a, /b' }
    const handler = makeRpcHandler(depsFor(new FakeIssue(), result))
    expect(await handler('detectRepo', null)).toEqual({ ok: false, error: { code: 'ambiguous-workspace', message: 'multiple workspaces: /a, /b', details: {} } })
  })

  it('passes through a no-remote detection failure verbatim', async () => {
    const result: DetectionResult = { ok: false, code: 'no-remote', message: 'no git origin remote at /ws' }
    const handler = makeRpcHandler(depsFor(new FakeIssue(), result))
    expect(await handler('detectRepo', null)).toEqual({ ok: false, error: { code: 'no-remote', message: 'no git origin remote at /ws', details: {} } })
  })

  it('passes through a not-github detection failure verbatim', async () => {
    const result: DetectionResult = { ok: false, code: 'not-github', message: 'not a GitHub remote: git@foo.com:x/y' }
    const handler = makeRpcHandler(depsFor(new FakeIssue(), result))
    expect(await handler('detectRepo', null)).toEqual({ ok: false, error: { code: 'not-github', message: 'not a GitHub remote: git@foo.com:x/y', details: {} } })
  })
})

describe('makeRpcHandler — listIssues', () => {
  it('forwards the repo and well-typed params to the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect(await handler('listIssues', { state: 'open', perPage: 5, page: 2 })).toEqual({ ok: true, value: { issues: [ISSUE] } })
    expect(issue.listCalls).toEqual([{ repo: REPO, params: { state: 'open', perPage: 5, page: 2 } }])
  })

  it('accepts an empty payload (all params optional)', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect(await handler('listIssues', null)).toEqual({ ok: true, value: { issues: [ISSUE] } })
    expect(issue.listCalls).toEqual([{ repo: REPO, params: {} }])
  })

  it('unwraps the provider IssueResult to the domain value', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect(await handler('listIssues', { state: 'open' })).toEqual({ ok: true, value: { issues: [ISSUE] } })
  })

  it('clears the repo cache once, before listing, when force is true', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect(await handler('listIssues', { force: true })).toEqual({ ok: true, value: { issues: [ISSUE] } })
    expect(issue.clearCalls).toEqual([REPO])
    expect(issue.calls).toEqual(['clear', 'list'])
  })

  it('does not clear when force is absent, false, or mis-typed', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    for (const payload of [null, {}, { force: false }, { force: 'yes' }, { force: 1 }]) expect((await handler('listIssues', payload)).ok).toBe(true)
    expect(issue.clearCalls).toEqual([])
    expect(issue.listCalls).toHaveLength(5)
  })

  it('rejects a state outside the open/closed/all set without calling the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect(await handler('listIssues', { state: 'bogus' })).toEqual({ ok: false, error: { code: 'bad-request', message: expect.any(String), details: { issues: [] } } })
    expect(issue.listCalls).toEqual([])
  })

  it('rejects a non-number perPage without calling the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect((await handler('listIssues', { perPage: '10' })).ok).toBe(false)
    expect(issue.listCalls).toEqual([])
  })

  it('rejects a non-number page without calling the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect((await handler('listIssues', { page: '1' })).ok).toBe(false)
    expect(issue.listCalls).toEqual([])
  })

  it('rejects a non-object payload without calling the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect((await handler('listIssues', 'open')).ok).toBe(false)
    expect((await handler('listIssues', [])).ok).toBe(false)
    expect(issue.listCalls).toEqual([])
  })

  it('returns the detection failure verbatim when no repo is detected', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, null))
    const res = await handler('listIssues', { state: 'open' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('no-remote')
    expect(res.error.message).toBe('no repo')
    expect(issue.listCalls).toEqual([])
  })
})

describe('makeRpcHandler — getIssue', () => {
  it('forwards the repo and number to the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect(await handler('getIssue', { number: 1 })).toEqual({ ok: true, value: { issue: ISSUE } })
    expect(issue.getCalls).toEqual([{ repo: REPO, number: 1 }])
  })

  it('unwraps the provider IssueResult to the domain value', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect(await handler('getIssue', { number: 1 })).toEqual({ ok: true, value: { issue: ISSUE } })
  })

  it('rejects a missing number without calling the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    expect((await handler('getIssue', {})).ok).toBe(false)
    expect((await handler('getIssue', null)).ok).toBe(false)
    expect(issue.getCalls).toEqual([])
  })

  it('rejects a non-number number without calling the provider', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, REPO))
    const res = await handler('getIssue', { number: '1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('bad-request')
    expect(res.error.details).toEqual({ issues: [] })
    expect(issue.getCalls).toEqual([])
  })

  it('returns the detection failure verbatim when no repo is detected', async () => {
    const issue = new FakeIssue()
    const handler = makeRpcHandler(deps(issue, null))
    const res = await handler('getIssue', { number: 1 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('no-remote')
    expect(res.error.message).toBe('no repo')
    expect(issue.getCalls).toEqual([])
  })
})

describe('makeRpcHandler — provider error mapping', () => {
  it('maps IssueNotFoundError to not-found', async () => {
    const issue = new FakeIssue()
    issue.listError = new IssueNotFoundError(REPO)
    const handler = makeRpcHandler(deps(issue, REPO))
    const res = await handler('listIssues', null)
    expect(res).toEqual({ ok: false, error: { code: 'not-found', message: 'not found: octo/ghl', details: {} } })
  })

  it('maps RateLimitError to rate-limit', async () => {
    const issue = new FakeIssue()
    issue.getError = new RateLimitError(403)
    const handler = makeRpcHandler(deps(issue, REPO))
    const res = await handler('getIssue', { number: 1 })
    expect(res).toEqual({ ok: false, error: { code: 'rate-limit', message: 'GitHub rate limit exceeded (HTTP 403)', details: {} } })
  })

  it('maps any other throw to internal', async () => {
    const issue = new FakeIssue()
    issue.listError = new Error('boom')
    const handler = makeRpcHandler(deps(issue, REPO))
    const res = await handler('listIssues', null)
    expect(res).toEqual({ ok: false, error: { code: 'internal', message: 'boom', details: {} } })
  })
})

describe('makeRpcHandler — unknown endpoint', () => {
  it('fails with an internal unknown-endpoint result', async () => {
    const handler = makeRpcHandler(deps(new FakeIssue(), REPO))
    expect(await handler('nope', null)).toEqual({ ok: false, error: { code: 'internal', message: 'unknown endpoint "nope"', details: {} } })
  })
})

describe('endpointFromPath', () => {
  it('returns the endpoint after the /ghl prefix', () => {
    expect(endpointFromPath('/ghl/detectRepo')).toBe('detectRepo')
  })

  it('allows multi-segment endpoints', () => {
    expect(endpointFromPath('/ghl/a/b')).toBe('a/b')
  })

  it('returns undefined for the bare channel path', () => {
    expect(endpointFromPath('/ghl')).toBeUndefined()
    expect(endpointFromPath('/ghl/')).toBeUndefined()
  })

  it('returns undefined for a different prefix', () => {
    expect(endpointFromPath('/other/detectRepo')).toBeUndefined()
  })

  it('returns undefined for traversal segments', () => {
    expect(endpointFromPath('/ghl/./a')).toBeUndefined()
    expect(endpointFromPath('/ghl/../a')).toBeUndefined()
  })
})

/** A minimal `IncomingMessage` double: fixed url/method/headers and a one-shot body. */
class FakeReq {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  private readonly body: Buffer

  constructor(url: string, body: string, method: string = 'POST', headers: Record<string, string> = { 'content-type': 'application/json' }) {
    this.url = url
    this.method = method
    this.headers = headers
    this.body = Buffer.from(body)
  }

  on(event: 'data' | 'end' | 'error', listener: (chunk?: Buffer) => void): this {
    if (event === 'data') listener(this.body)
    if (event === 'end') listener()
    return this
  }
}

/** A minimal `ServerResponse` double: records the status, headers, and body. */
class FakeRes {
  status: number | undefined
  responseHeaders: Record<string, string> | undefined
  body = ''

  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status
    this.responseHeaders = headers
    return this
  }

  end(body: string): this {
    this.body += body
    return this
  }
}

/** One client-request envelope body for a method/payload pair. */
function envelope(method: string, payload: unknown): string {
  return JSON.stringify({ type: 'client-request', rpcId: 'r1', method, payload })
}

async function wire(url: string, body: string, issue: RpcDeps['issue'], repo: RepoRef | null, method: string = 'POST', contentType: string = 'application/json'): Promise<FakeRes> {
  const res = new FakeRes()
  const req = new FakeReq(url, body, method, { 'content-type': contentType })
  await handleRequest(deps(issue, repo), req as unknown as IncomingMessage, res as unknown as ServerResponse)
  return res
}

describe('handleRequest — the wire lifecycle', () => {
  it('answers a valid request with a server-response envelope carrying the ok result', async () => {
    const res = await wire('/ghl/detectRepo', envelope('detectRepo', null), new FakeIssue(), REPO)
    expect(res.status).toBe(200)
    expect(res.responseHeaders).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(res.body)).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { repo: REPO } } })
  })

  it('dispatches listIssues through the channel', async () => {
    const res = await wire('/ghl/listIssues', envelope('listIssues', { state: 'open' }), new FakeIssue(), REPO)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { issues: [ISSUE] } } })
  })

  it('fails with a detection-failure result when no repo is detected', async () => {
    const res = await wire('/ghl/getIssue', envelope('getIssue', { number: 1 }), new FakeIssue(), null)
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body) as { result: { ok: boolean; error?: { code: string; message: string } } }
    expect(parsed.result.ok).toBe(false)
    expect(parsed.result.error?.code).toBe('no-remote')
    expect(parsed.result.error?.message).toBe('no repo')
  })

  it('answers 404 for a non-POST request', async () => {
    const res = await wire('/ghl/detectRepo', envelope('detectRepo', null), new FakeIssue(), REPO, 'GET')
    expect(res.status).toBe(404)
  })

  it('answers 404 for a pathname outside the channel', async () => {
    const res = await wire('/other/detectRepo', envelope('detectRepo', null), new FakeIssue(), REPO)
    expect(res.status).toBe(404)
  })

  it('answers 415 for a non-JSON content type', async () => {
    const res = await wire('/ghl/detectRepo', envelope('detectRepo', null), new FakeIssue(), REPO, 'POST', 'text/plain')
    expect(res.status).toBe(415)
  })

  it('answers 400 for a non-JSON body', async () => {
    const res = await wire('/ghl/detectRepo', 'not json', new FakeIssue(), REPO)
    expect(res.status).toBe(400)
  })

  // A mis-typed rpcId is what the carrier schema flags (a *missing* rpcId
  // validates as undefined under schemastery, mirroring global-queue).
  it('answers an invalid-envelope result when the rpcId is mis-typed', async () => {
    const res = await wire('/ghl/detectRepo', JSON.stringify({ type: 'client-request', rpcId: 123, method: 'detectRepo', payload: null }), new FakeIssue(), REPO)
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body) as { type: string; rpcId: string; result: { ok: boolean; error?: { code: string } } }
    expect(parsed.type).toBe('server-response')
    expect(parsed.rpcId).toBe('invalid-request')
    expect(parsed.result.ok).toBe(false)
    expect(parsed.result.error?.code).toBe('gateway/bad-request')
  })

  it('answers a method-mismatch result when the method does not match the endpoint', async () => {
    const res = await wire('/ghl/detectRepo', envelope('getIssue', null), new FakeIssue(), REPO)
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body) as { rpcId: string; result: { ok: boolean; error?: { code: string } } }
    expect(parsed.rpcId).toBe('r1')
    expect(parsed.result.ok).toBe(false)
    expect(parsed.result.error?.code).toBe('gateway/bad-request')
  })
})

describe('mountChannel', () => {
  it('registers the /ghl prefix route and returns its unregister', () => {
    const registered: WebRoute[] = []
    let unregistered = false
    const webServer: WebServerRegistry = {
      register: route => {
        registered.push(route)
        return () => {
          unregistered = true
        }
      },
    }
    const unregister = mountChannel(deps(new FakeIssue(), REPO), webServer)
    expect(registered).toHaveLength(1)
    expect(registered[0]?.kind).toBe('prefix')
    expect(registered[0]?.path).toBe('/ghl')
    unregister()
    expect(unregistered).toBe(true)
  })

  it('serves a full wire round trip through the registered handler', async () => {
    const registered: WebRoute[] = []
    const webServer: WebServerRegistry = { register: route => { registered.push(route); return () => {} } }
    mountChannel(deps(new FakeIssue(), REPO), webServer)
    const res = new FakeRes()
    await registered[0]?.handler(new FakeReq('/ghl/listIssues', envelope('listIssues', null)) as unknown as IncomingMessage, res as unknown as ServerResponse)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { issues: [ISSUE] } } })
  })
})
