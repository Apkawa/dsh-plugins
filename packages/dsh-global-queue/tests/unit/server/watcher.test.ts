import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { QueueStore } from '../../../src/queue/store.ts'
import { createWatcher } from '../../../src/queue/watcher.ts'
import type { TokenTotals } from '../../../src/queue/watcher.ts'

/** Repo-local .tmp (git-ignored); per-scenario temp dirs for the test run live here. */
const repoTmp = fileURLToPath(new URL('../../../../../.tmp', import.meta.url))
const createdDirs: string[] = []

afterAll(async () => {
  await Promise.all(createdDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

/** A fresh real store in its own temp dir under the repo .tmp. */
async function freshStore(label: string): Promise<QueueStore> {
  const dir = await mkdtemp(join(repoTmp, `global-queue-watcher-${label}-`))
  createdDirs.push(dir)
  return new QueueStore(join(dir, 'queue.json'))
}

/** Let the watcher's serialized async dispatch settle. */
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

type AgentStatus = 'idle' | 'running'
type FollowupMessage = { content: Array<{ type: 'text'; text: string }>; source: { kind: 'user' } }
type SessionEvent = { type: string; data?: { reason?: string } }

/** Agents double: a mutable registry of live agents that records create/resume/followup calls. */
function makeAgents() {
  const entries = new Map<string, ReturnType<typeof agentEntry>>()
  const createCalls: Array<{ sessionId: string; meta: { cwd: string }; agentPreset?: string }> = []
  const resumeCalls: Array<{ resumeSessionId: string }> = []
  const agents = {
    list: () => [...entries.values()],
    get: (id: string) => entries.get(id),
    create: (options: { sessionId: string; meta: { cwd: string }; agentPreset?: string }) => {
      createCalls.push(options)
      const entry = agentEntry(options.sessionId, 'running')
      entries.set(options.sessionId, entry)
      return Promise.resolve(entry)
    },
    resume: (options: { resumeSessionId: string }) => {
      resumeCalls.push(options)
      const entry = agentEntry(options.resumeSessionId, 'running')
      entries.set(options.resumeSessionId, entry)
      return Promise.resolve(entry)
    },
    /** Register (or re-register) an agent entry and set its status. */
    set: (id: string, status: AgentStatus) => {
      const entry = entries.get(id) ?? agentEntry(id, status)
      entry.status = status
      entries.set(id, entry)
    },
  }
  return { ...agents, createCalls, resumeCalls, entries }
}

function agentEntry(id: string, status: AgentStatus) {
  const followupCalls: FollowupMessage[] = []
  return {
    id,
    status,
    followupCalls,
    followup: (message: FollowupMessage) => { followupCalls.push(message) },
  }
}

/** Persistence double: which session ids have a persisted session on disk. */
function makePersistence() {
  const sessions = new Map<string, string>()
  return {
    stat: (id: string) => {
      const cwd = sessions.get(id)
      return cwd === undefined ? undefined : { header: { cwd } }
    },
    set: (id: string, cwd: string) => { sessions.set(id, cwd) },
  }
}

/** Projections double: token totals per session. */
function makeProjections() {
  const usage = new Map<string, TokenTotals>()
  return {
    tokenUsage: (id: string) => usage.get(id),
    set: (id: string, totals: TokenTotals) => { usage.set(id, totals) },
  }
}

/** Events double: records the subscribed handlers and lets the test fire them. */
function makeEvents() {
  const statusHandlers: Array<(agentId: string, status: AgentStatus) => void> = []
  const sessionHandlers: Array<(session: { id: string }, event: SessionEvent) => void> = []
  return {
    onAgentStatus: (handler: (agentId: string, status: AgentStatus) => void) => { statusHandlers.push(handler) },
    onSessionEvent: (handler: (session: { id: string }, event: SessionEvent) => void) => { sessionHandlers.push(handler) },
    emitAgentStatus: (agentId: string, status: AgentStatus) => { statusHandlers.forEach(handler => handler(agentId, status)) },
    emitSessionEvent: (sessionId: string, event: SessionEvent) => { sessionHandlers.forEach(handler => handler({ id: sessionId }, event)) },
  }
}

/** Workspaces double: records attach calls. */
function makeWorkspaces() {
  const attachCalls: Array<{ sessionId: string; workspacePath: string }> = []
  return {
    attach: (sessionId: string, workspacePath: string) => {
      attachCalls.push({ sessionId, workspacePath })
      return Promise.resolve()
    },
    attachCalls,
  }
}

function makeDeps(store: QueueStore) {
  const agents = makeAgents()
  const persistence = makePersistence()
  const projections = makeProjections()
  const events = makeEvents()
  const workspaces = makeWorkspaces()
  return { store, agents, persistence, projections, events, workspaces }
}

describe('queue watcher', () => {
  it('runs a queued new-session item on the idle agent and completes it on turn/end', async () => {
    const store = await freshStore('run-done')
    const item = store.add({ text: 'hello', workspacePath: '/ws/a', targetSessionId: null })
    const deps = makeDeps(store)
    deps.agents.set('a1', 'idle')
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(deps.agents.createCalls).toHaveLength(1)
    const created = deps.agents.createCalls[0]
    expect(created?.sessionId).toBeTypeOf('string')
    expect(created?.sessionId).not.toBe('')
    expect(created?.meta.cwd).toBe('/ws/a')
    const running = store.list().find(candidate => candidate.id === item.id)
    expect(running?.status).toBe('running')
    expect(running?.sessionId).toBe(created?.sessionId)
    expect(typeof running?.startedAt).toBe('number')

    const sessionId = created?.sessionId ?? ''
    deps.projections.set(sessionId, { uncachedInputTokens: 200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 })
    deps.agents.set(sessionId, 'idle')
    deps.events.emitAgentStatus(sessionId, 'idle')
    deps.events.emitSessionEvent(sessionId, { type: 'turn/end', data: { reason: 'completed' } })

    const done = store.list().find(candidate => candidate.id === item.id)
    expect(done?.status).toBe('done')
    expect(typeof done?.endedAt).toBe('number')
    expect(done?.stats).toEqual({ tokens: 500 })
  })

  it('keeps the item queued while any agent is busy, then starts it once all are idle', async () => {
    const store = await freshStore('busy-wait')
    const item = store.add({ text: 't', workspacePath: '/ws/b', targetSessionId: null })
    const deps = makeDeps(store)
    deps.agents.set('a1', 'idle')
    deps.agents.set('a2', 'running')
    const watcher = createWatcher(deps)
    watcher.start()

    expect(deps.agents.createCalls).toHaveLength(0)
    expect(store.list().find(candidate => candidate.id === item.id)?.status).toBe('queued')

    deps.agents.set('a2', 'idle')
    deps.events.emitAgentStatus('a2', 'idle')
    await flush()

    expect(deps.agents.createCalls).toHaveLength(1)
  })

  it('continues a queued item on its live idle agent via followup', async () => {
    const store = await freshStore('followup')
    const item = store.add({ text: 'continue me', workspacePath: '/ws/c', targetSessionId: 's1' })
    const deps = makeDeps(store)
    deps.agents.set('s1', 'idle')
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(deps.agents.createCalls).toHaveLength(0)
    expect(deps.agents.resumeCalls).toHaveLength(0)
    const followups = deps.agents.entries.get('s1')?.followupCalls
    expect(followups).toHaveLength(1)
    expect(followups?.[0]?.content[0]?.text).toBe('continue me')
    expect(followups?.[0]?.source).toEqual({ kind: 'user' })
    const running = store.list().find(candidate => candidate.id === item.id)
    expect(running?.status).toBe('running')
    expect(running?.sessionId).toBe('s1')

    deps.projections.set('s1', { uncachedInputTokens: 200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 })
    deps.agents.set('s1', 'idle')
    deps.events.emitAgentStatus('s1', 'idle')
    deps.events.emitSessionEvent('s1', { type: 'turn/end', data: { reason: 'completed' } })

    const done = store.list().find(candidate => candidate.id === item.id)
    expect(done?.status).toBe('done')
    expect(typeof done?.endedAt).toBe('number')
    expect(done?.stats).toEqual({ tokens: 500 })
  })

  it('resumes a persisted target session when no live agent exists', async () => {
    const store = await freshStore('resume')
    const item = store.add({ text: 't', workspacePath: '/ws/d', targetSessionId: 's2' })
    const deps = makeDeps(store)
    deps.persistence.set('s2', '/ws/d')
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(deps.agents.resumeCalls).toEqual([{ resumeSessionId: 's2' }])
    expect(deps.agents.createCalls).toHaveLength(0)
    const running = store.list().find(candidate => candidate.id === item.id)
    expect(running?.status).toBe('running')
    expect(running?.sessionId).toBe('s2')
  })

  it('interrupts an item whose target session is neither live nor persisted', async () => {
    const store = await freshStore('missing-session')
    const item = store.add({ text: 't', workspacePath: '/ws/e', targetSessionId: 's3' })
    const deps = makeDeps(store)
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(deps.agents.createCalls).toHaveLength(0)
    expect(deps.agents.resumeCalls).toHaveLength(0)
    expect(store.list().find(candidate => candidate.id === item.id)?.status).toBe('interrupted')
  })

  it('interrupts the running item when turn/end carries a non-completed reason', async () => {
    const store = await freshStore('aborted')
    const item = store.add({ text: 't', workspacePath: '/ws/f', targetSessionId: null })
    const deps = makeDeps(store)
    deps.agents.set('a1', 'idle')
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    const sessionId = deps.agents.createCalls[0]?.sessionId ?? ''
    deps.agents.set(sessionId, 'idle')
    deps.events.emitAgentStatus(sessionId, 'idle')
    deps.events.emitSessionEvent(sessionId, { type: 'turn/end', data: { reason: 'aborted' } })

    const interrupted = store.list().find(candidate => candidate.id === item.id)
    expect(interrupted?.status).toBe('interrupted')
    expect(typeof interrupted?.endedAt).toBe('number')
  })

  it('on start, interrupts a running item with a dead session and keeps a live one running', async () => {
    const store = await freshStore('recovery')
    const gone = store.add({ text: 'a', workspacePath: '/ws/g', targetSessionId: null })
    const live = store.add({ text: 'b', workspacePath: '/ws/g', targetSessionId: null })
    store.update(gone.id, { status: 'running', sessionId: 'gone', startedAt: 1000 })
    store.update(live.id, { status: 'running', sessionId: 'live', startedAt: 2000 })
    const deps = makeDeps(store)
    deps.agents.set('live', 'running')
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(store.list().find(candidate => candidate.id === gone.id)?.status).toBe('interrupted')
    const liveItem = store.list().find(candidate => candidate.id === live.id)
    expect(liveItem?.status).toBe('running')
    expect(liveItem?.sessionId).toBe('live')
  })

  it('records the token delta of a continued session', async () => {
    const store = await freshStore('delta')
    const item = store.add({ text: 't', workspacePath: '/ws/h', targetSessionId: 's1' })
    const deps = makeDeps(store)
    deps.agents.set('s1', 'idle')
    deps.projections.set('s1', { uncachedInputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()
    deps.projections.set('s1', { uncachedInputTokens: 1500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

    deps.agents.set('s1', 'idle')
    deps.events.emitAgentStatus('s1', 'idle')
    deps.events.emitSessionEvent('s1', { type: 'turn/end', data: { reason: 'completed' } })

    const done = store.list().find(candidate => candidate.id === item.id)
    expect(done?.status).toBe('done')
    expect(done?.stats).toEqual({ tokens: 500 })
  })

  it('starts the next queued item after the first completes', async () => {
    const store = await freshStore('chained')
    const first = store.add({ text: 'a', workspacePath: '/ws/i', targetSessionId: null })
    const second = store.add({ text: 'b', workspacePath: '/ws/i', targetSessionId: null })
    const deps = makeDeps(store)
    deps.agents.set('a1', 'idle')
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(deps.agents.createCalls).toHaveLength(1)
    const firstSession = deps.agents.createCalls[0]?.sessionId ?? ''
    expect(store.list().find(candidate => candidate.id === first.id)?.status).toBe('running')

    deps.agents.set(firstSession, 'idle')
    deps.events.emitAgentStatus(firstSession, 'idle')
    deps.events.emitSessionEvent(firstSession, { type: 'turn/end', data: { reason: 'completed' } })
    await flush()

    expect(store.list().find(candidate => candidate.id === first.id)?.status).toBe('done')
    expect(deps.agents.createCalls).toHaveLength(2)
    const secondRunning = store.list().find(candidate => candidate.id === second.id)
    expect(secondRunning?.status).toBe('running')
    expect(secondRunning?.sessionId).toBe(deps.agents.createCalls[1]?.sessionId)
  })

  it('stop() leaves queued items queued and ignores further events', async () => {
    const store = await freshStore('stop')
    const item = store.add({ text: 't', workspacePath: '/ws/j', targetSessionId: null })
    const deps = makeDeps(store)
    deps.agents.set('a1', 'running')
    const watcher = createWatcher(deps)
    watcher.start()
    watcher.stop()

    expect(deps.agents.createCalls).toHaveLength(0)
    deps.agents.set('a1', 'idle')
    deps.events.emitAgentStatus('a1', 'idle')
    deps.events.emitSessionEvent('a1', { type: 'turn/end', data: { reason: 'completed' } })
    await flush()

    expect(deps.agents.createCalls).toHaveLength(0)
    expect(store.list().find(candidate => candidate.id === item.id)?.status).toBe('queued')
  })

  it('wakes on add: a queued item starts with zero live agents', async () => {
    const store = await freshStore('add-wake')
    const deps = makeDeps(store)
    const watcher = createWatcher(deps)
    watcher.start()
    const item = store.add({ text: 't', workspacePath: '/ws/k', targetSessionId: null })
    expect(store.list().find(candidate => candidate.id === item.id)?.status).toBe('queued')
    watcher.nudge()
    await flush()
    expect(store.list().find(candidate => candidate.id === item.id)?.status).toBe('running')
  })

  it('delivers the item text on the created session', async () => {
    const store = await freshStore('create-deliver')
    const item = store.add({ text: 'hello created', workspacePath: '/ws/l', targetSessionId: null })
    const deps = makeDeps(store)
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()
    const sessionId = deps.agents.createCalls[0]?.sessionId
    const entry = sessionId === undefined ? undefined : deps.agents.entries.get(sessionId)
    expect(entry?.followupCalls).toHaveLength(1)
    expect(entry?.followupCalls[0]?.content[0]?.text).toBe('hello created')
  })

  it('delivers the item text on the resumed session', async () => {
    const store = await freshStore('resume-deliver')
    const item = store.add({ text: 'hello resumed', workspacePath: '/ws/m', targetSessionId: 's9' })
    const deps = makeDeps(store)
    deps.persistence.set('s9', '/ws/m')
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()
    expect(deps.agents.resumeCalls).toEqual([{ resumeSessionId: 's9' }])
    const entry = deps.agents.entries.get('s9')
    expect(entry?.followupCalls).toHaveLength(1)
    expect(entry?.followupCalls[0]?.content[0]?.text).toBe('hello resumed')
  })

  it('attaches the created session to the item workspace', async () => {
    const store = await freshStore('attach')
    const item = store.add({ text: 't', workspacePath: '/ws/n', targetSessionId: null })
    const deps = makeDeps(store)
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()
    const sessionId = deps.agents.createCalls[0]?.sessionId
    expect(deps.workspaces.attachCalls).toEqual([{ sessionId, workspacePath: '/ws/n' }])
  })

  it('passes a new-session item agentPreset through to agents.create', async () => {
    const store = await freshStore('preset')
    const item = store.add({ text: 't', workspacePath: '/ws/p', targetSessionId: null, agentPreset: 'preset-x' })
    const deps = makeDeps(store)
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(store.list().find(candidate => candidate.id === item.id)?.status).toBe('running')
    expect(deps.agents.createCalls).toHaveLength(1)
    expect(deps.agents.createCalls[0]?.agentPreset).toBe('preset-x')
  })

  it('creates without a preset when the item has no agentPreset', async () => {
    const store = await freshStore('no-preset')
    const item = store.add({ text: 't', workspacePath: '/ws/q', targetSessionId: null })
    const deps = makeDeps(store)
    const watcher = createWatcher(deps)
    watcher.start()
    await flush()

    expect(store.list().find(candidate => candidate.id === item.id)?.status).toBe('running')
    expect(deps.agents.createCalls).toHaveLength(1)
    const call = deps.agents.createCalls[0]
    expect('agentPreset' in (call ?? {})).toBe(false)
    expect('agentPreset' in (call?.meta ?? {})).toBe(false)
  })
})
