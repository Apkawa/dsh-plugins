import { describe, expect, it } from 'vitest'
import { back, getError, getIssueLoading, getIssues, getRepo, getSelected, getListLoading, refresh, select, setRpc, subscribe } from '../../../src/client/index.ts'
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
const issue2: Issue = {
  number: 2,
  title: 'second',
  state: 'closed',
  body: 'second body',
  htmlUrl: 'https://github.com/apkawa/dsh/issues/2',
  labels: [],
}

/** One recorded RPC call (the method name and its payload). */
type RecordedCall = { method: string; payload: unknown }

/** A fake RPC call: records every call and answers each method from the canned table. */
function fakeRpc(canned: Record<string, unknown>) {
  const calls: RecordedCall[] = []
  const call = (method: string, payload: unknown): Promise<unknown> => {
    calls.push({ method, payload })
    return Promise.resolve(canned[method])
  }
  return { call, calls }
}

/** A promise a test can settle by hand (holds a fake RPC call in flight). */
function deferred() {
  let settle: (value: unknown) => void = () => undefined
  const promise = new Promise<unknown>(resolve => { settle = resolve })
  return { promise, settle }
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

describe('refresh', () => {
  it('detects the repo and lists its issues', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [issue1, issue2] } })
    setRpc(fake.call)
    await refresh()
    expect(getRepo()).toEqual(repo)
    expect(getIssues()).toEqual([issue1, issue2])
  })

  it('publishes to the subscribers', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [issue1] } })
    setRpc(fake.call)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    await refresh()
    unsubscribe()
    expect(published).toBe(2)
  })

  it('notifies distinct subscribers', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [] } })
    setRpc(fake.call)
    let first = 0
    let second = 0
    const unsubscribeFirst = subscribe(() => { first += 1 })
    const unsubscribeSecond = subscribe(() => { second += 1 })
    await refresh()
    unsubscribeFirst()
    unsubscribeSecond()
    expect(first).toBe(2)
    expect(second).toBe(2)
  })

  it('stops notifying an unsubscribed subscriber', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [] } })
    setRpc(fake.call)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    unsubscribe()
    await refresh()
    expect(published).toBe(0)
  })

  it('skips listIssues and clears the list when no repo is detected', async () => {
    const fake = fakeRpc({ detectRepo: { repo: null } })
    setRpc(fake.call)
    await refresh()
    expect(getRepo()).toBeNull()
    expect(getIssues()).toEqual([])
    expect(fake.calls.map(c => c.method)).toEqual(['detectRepo'])
  })

  it('sends the workspace path in the detectRepo and listIssues payloads when given', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [issue1] } })
    setRpc(fake.call)
    await refresh('/some/ws')
    expect(fake.calls).toEqual([
      { method: 'detectRepo', payload: { workspacePath: '/some/ws' } },
      { method: 'listIssues', payload: { workspacePath: '/some/ws' } },
    ])
  })

  it('sends no workspacePath key when called without a path', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [] } })
    setRpc(fake.call)
    await refresh()
    expect(fake.calls).toEqual([
      { method: 'detectRepo', payload: {} },
      { method: 'listIssues', payload: {} },
    ])
  })

  it('sends force in the listIssues payload when forced', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [issue1] } })
    setRpc(fake.call)
    await refresh('/some/ws', true)
    expect(fake.calls).toEqual([
      { method: 'detectRepo', payload: { workspacePath: '/some/ws' } },
      { method: 'listIssues', payload: { workspacePath: '/some/ws', force: true } },
    ])
  })

  it('sets listLoading while the RPC is in flight and clears it on success', async () => {
    const list = deferred()
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: list.promise })
    setRpc(fake.call)
    const done = refresh()
    expect(getListLoading()).toBe(true)
    list.settle({ issues: [issue1] })
    await done
    expect(getListLoading()).toBe(false)
    expect(getIssues()).toEqual([issue1])
  })

  it('publishes the in-flight snapshot before the RPC settles and the settled snapshot after', async () => {
    const list = deferred()
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: list.promise })
    setRpc(fake.call)
    const recorder = recordPublishes()
    const done = refresh()
    expect(recorder.snapshots).toHaveLength(1)
    expect(recorder.snapshots[0].listLoading).toBe(true)
    list.settle({ issues: [issue1] })
    await done
    recorder.unsubscribe()
    expect(recorder.snapshots).toHaveLength(2)
    const settled = recorder.snapshots[1]
    expect(settled.listLoading).toBe(false)
    expect(settled.repo).toEqual(repo)
    expect(settled.issues).toEqual([issue1])
    expect(settled.error).toBeNull()
  })

  it('sends no force key in the listIssues payload when not forced', async () => {
    const fake = fakeRpc({ detectRepo: { repo }, listIssues: { issues: [] } })
    setRpc(fake.call)
    await refresh('/some/ws')
    const listPayload = fake.calls.find(c => c.method === 'listIssues')?.payload as { force?: unknown }
    expect(listPayload.force).toBeUndefined()
    await refresh('/some/ws', false)
    expect((fake.calls.find(c => c.method === 'listIssues')?.payload as { force?: unknown }).force).toBeUndefined()
  })
})

describe('select', () => {
  it('fetches the issue by number and sets it as the selected one', async () => {
    const fake = fakeRpc({ getIssue: { issue: issue1 } })
    setRpc(fake.call)
    await select(1)
    expect(getSelected()).toEqual(issue1)
    expect(fake.calls).toEqual([{ method: 'getIssue', payload: { number: 1 } }])
  })

  it('sets issueLoading while the RPC is in flight and clears it on success', async () => {
    const fetched = deferred()
    const fake = fakeRpc({ getIssue: fetched.promise })
    setRpc(fake.call)
    const done = select(1)
    expect(getIssueLoading()).toBe(true)
    fetched.settle({ issue: issue1 })
    await done
    expect(getIssueLoading()).toBe(false)
    expect(getSelected()).toEqual(issue1)
  })

  it('publishes the in-flight snapshot before the RPC settles and the settled snapshot after', async () => {
    const fetched = deferred()
    const fake = fakeRpc({ getIssue: fetched.promise })
    setRpc(fake.call)
    const recorder = recordPublishes()
    const done = select(1)
    expect(recorder.snapshots).toHaveLength(1)
    expect(recorder.snapshots[0].issueLoading).toBe(true)
    fetched.settle({ issue: issue1 })
    await done
    recorder.unsubscribe()
    expect(recorder.snapshots).toHaveLength(2)
    const settled = recorder.snapshots[1]
    expect(settled.issueLoading).toBe(false)
    expect(settled.selected).toEqual(issue1)
    expect(settled.error).toBeNull()
  })

  it('sends the workspace path in the getIssue payload when given', async () => {
    const fake = fakeRpc({ getIssue: { issue: issue1 } })
    setRpc(fake.call)
    await select(1, '/some/ws')
    expect(fake.calls).toEqual([{ method: 'getIssue', payload: { number: 1, workspacePath: '/some/ws' } }])
  })

  it('publishes to the subscribers', async () => {
    const fake = fakeRpc({ getIssue: { issue: issue2 } })
    setRpc(fake.call)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    await select(2)
    unsubscribe()
    expect(published).toBe(2)
  })
})

describe('back', () => {
  it('clears the selected issue and publishes', async () => {
    const fake = fakeRpc({ getIssue: { issue: issue1 } })
    setRpc(fake.call)
    await select(1)
    let published = 0
    const unsubscribe = subscribe(() => { published += 1 })
    back()
    unsubscribe()
    expect(getSelected()).toBeNull()
    expect(published).toBe(1)
  })
})
