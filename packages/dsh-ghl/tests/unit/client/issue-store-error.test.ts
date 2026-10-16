import { describe, expect, it } from 'vitest'
import { getError, getIssueLoading, getIssues, getRepo, getSelected, getListLoading, refresh, select, setRpc, subscribe } from '../../../src/client/index.ts'
import type { RpcError } from '../../../src/client/index.ts'
import type { Issue, RepoRef } from '../../../src/issues.ts'

const repo: RepoRef = { owner: 'apkawa', repo: 'dsh' }
const issue1: Issue = {
  number: 1,
  title: 'first',
  state: 'open',
  body: 'first body',
  htmlUrl: 'https://github.com/apkawa/dsh/issues/1',
  labels: ['bug'],
}

/** One recorded RPC call (the method name and its payload). */
type RecordedCall = { method: string; payload: unknown }

/** The Host's failure envelope, as the carrier serves it. */
function failure(code: string, message: string, details: unknown = {}) {
  return { ok: false, error: { code, message, details } }
}

/** Whether a canned answer is a failure envelope (the fake rejects it). */
function isFailure(answer: unknown): answer is { ok: false; error: { code: string; message: string; details: unknown } } {
  return answer !== null && typeof answer === 'object' && 'ok' in answer && (answer as { ok: unknown }).ok === false
}

/** A promise a test can settle by hand (resolve with a value, reject with an RPC error). */
function deferred() {
  let resolve: (value: unknown) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** One published snapshot, read through the store's getters at publish time. */
type Snapshot = {
  repo: RepoRef | null
  issues: Issue[]
  selected: Issue | null
  error: { code: string; message: string } | null
  listLoading: boolean
  issueLoading: boolean
}

/** A subscriber that records every published snapshot, in order. */
function recordPublishes() {
  const snapshots: Snapshot[] = []
  const unsubscribe = subscribe(() => {
    snapshots.push({
      repo: getRepo(),
      issues: getIssues(),
      selected: getSelected(),
      error: getError(),
      listLoading: getListLoading(),
      issueLoading: getIssueLoading(),
    })
  })
  return { snapshots, unsubscribe }
}

/**
 * A fake RPC call for the store's seam: records every call and answers each
 * method from the canned table; a canned failure envelope rejects with a typed
 * RPC error (an `Error` carrying `code` and `details`), as `callRpc` throws it.
 */
function fakeRpc(canned: Record<string, unknown>) {
  const calls: RecordedCall[] = []
  const call = (method: string, payload: unknown): Promise<unknown> => {
    calls.push({ method, payload })
    const answer = canned[method]
    if (!isFailure(answer)) return Promise.resolve(answer)
    return Promise.reject(Object.assign(new Error(answer.error.message), { code: answer.error.code, details: answer.error.details }) as RpcError)
  }
  return { call, calls }
}

describe('refresh failure handling', () => {
  it('records the detection failure, clears the repo, and resolves', async () => {
    const fake = fakeRpc({ detectRepo: failure('no-remote', 'no git remote configured') })
    setRpc(fake.call)
    await refresh()
    expect(getRepo()).toBeNull()
    expect(getIssues()).toEqual([])
    expect(getError()).toEqual({ code: 'no-remote', message: 'no git remote configured' })
    expect(fake.calls.map(c => c.method)).toEqual(['detectRepo'])
  })

  it('publishes to the subscribers when detection fails', async () => {
    const fake = fakeRpc({ detectRepo: failure('no-workspace', 'no workspace detected') })
    setRpc(fake.call)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    await refresh()
    unsubscribe()
    expect(published).toBe(2)
    expect(getError()).toEqual({ code: 'no-workspace', message: 'no workspace detected' })
  })

  it('records the list failure and clears the issue list', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: failure('rate-limit', 'rate limited') })
    setRpc(fake.call)
    await refresh()
    expect(getRepo()).toEqual(repo)
    expect(getIssues()).toEqual([])
    expect(getError()).toEqual({ code: 'rate-limit', message: 'rate limited' })
    expect(fake.calls.map(c => c.method)).toEqual(['detectRepo', 'listIssues'])
  })

  it('clears listLoading when the RPC fails', async () => {
    const fake = fakeRpc({ detectRepo: failure('no-remote', 'no git remote configured') })
    setRpc(fake.call)
    const done = refresh()
    expect(getListLoading()).toBe(true)
    await done
    expect(getListLoading()).toBe(false)
  })

  it('publishes the in-flight snapshot first and the failure snapshot after', async () => {
    const detect = deferred()
    const fake = fakeRpc({ detectRepo: detect.promise })
    setRpc(fake.call)
    const recorder = recordPublishes()
    const done = refresh()
    expect(recorder.snapshots).toHaveLength(1)
    expect(recorder.snapshots[0].listLoading).toBe(true)
    detect.reject(Object.assign(new Error('no git remote configured'), { code: 'no-remote' }))
    await done
    recorder.unsubscribe()
    expect(recorder.snapshots).toHaveLength(2)
    const settled = recorder.snapshots[1]
    expect(settled.listLoading).toBe(false)
    expect(settled.repo).toBeNull()
    expect(settled.issues).toEqual([])
    expect(settled.error).toEqual({ code: 'no-remote', message: 'no git remote configured' })
  })

  it('publishes to the subscribers when listing fails', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: failure('rate-limit', 'rate limited') })
    setRpc(fake.call)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    await refresh()
    unsubscribe()
    expect(published).toBe(2)
  })

  it('clears the error on a full success', async () => {
    setRpc(fakeRpc({ detectRepo: failure('no-remote', 'no git remote') }).call)
    await refresh()
    expect(getError()).not.toBeNull()
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [issue1] } })
    setRpc(fake.call)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    await refresh()
    unsubscribe()
    expect(getError()).toBeNull()
    expect(getRepo()).toEqual(repo)
    expect(getIssues()).toEqual([issue1])
    expect(published).toBe(2)
  })
})

describe('select failure handling', () => {
  it('records the failure and keeps the selected issue unchanged', async () => {
    setRpc(fakeRpc({ getIssue: { issue: issue1 } }).call)
    await select(1)
    const fake = fakeRpc({ getIssue: failure('not-found', 'issue 2 not found') })
    setRpc(fake.call)
    await select(2)
    expect(getSelected()).toEqual(issue1)
    expect(getError()).toEqual({ code: 'not-found', message: 'issue 2 not found' })
  })

  it('clears issueLoading when the RPC fails', async () => {
    const fake = fakeRpc({ getIssue: failure('not-found', 'issue 3 not found') })
    setRpc(fake.call)
    const done = select(3)
    expect(getIssueLoading()).toBe(true)
    await done
    expect(getIssueLoading()).toBe(false)
  })

  it('publishes the in-flight snapshot first and the failure snapshot after', async () => {
    const fetched = deferred()
    const fake = fakeRpc({ getIssue: fetched.promise })
    setRpc(fake.call)
    const recorder = recordPublishes()
    const done = select(3)
    expect(recorder.snapshots).toHaveLength(1)
    expect(recorder.snapshots[0].issueLoading).toBe(true)
    fetched.reject(Object.assign(new Error('issue 3 not found'), { code: 'not-found' }))
    await done
    recorder.unsubscribe()
    expect(recorder.snapshots).toHaveLength(2)
    const settled = recorder.snapshots[1]
    expect(settled.issueLoading).toBe(false)
    expect(settled.error).toEqual({ code: 'not-found', message: 'issue 3 not found' })
  })

  it('publishes to the subscribers when selection fails', async () => {
    const fake = fakeRpc({ getIssue: failure('not-found', 'issue 3 not found') })
    setRpc(fake.call)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    await select(3)
    unsubscribe()
    expect(published).toBe(2)
    expect(getError()).toEqual({ code: 'not-found', message: 'issue 3 not found' })
  })
})
