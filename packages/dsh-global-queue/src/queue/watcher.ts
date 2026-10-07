import { randomUUID } from 'node:crypto'
import type { QueueStore } from './store.ts'
import type { QueueItem } from './types.ts'

export type TokenTotals = {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type FollowupMessage = {
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
}

export type WatcherAgent = {
  id: string
  status: 'idle' | 'running'
  followup(message: FollowupMessage): void
}

export type WatcherAgents = {
  list(): readonly WatcherAgent[]
  get(id: string): WatcherAgent | undefined
  create(options: { sessionId: string; meta: { cwd: string }; agentPreset?: string }): Promise<WatcherAgent>
  resume(options: { resumeSessionId: string }): Promise<WatcherAgent>
}

export type WatcherDeps = {
  store: QueueStore
  agents: WatcherAgents
  workspaces: {
    /** Attach a session to the workspace at `workspacePath` (the session's cwd must resolve to it). */
    attach(sessionId: string, workspacePath: string): Promise<void>
  }
  persistence: {
    stat(id: string): { header: { cwd: string } } | undefined
  }
  projections: {
    tokenUsage(id: string): TokenTotals | undefined
  }
  events: {
    onAgentStatus(handler: (agentId: string, status: 'idle' | 'running') => void): void
    onSessionEvent(handler: (session: { id: string }, event: { type: string; data?: { reason?: string } }) => void): void
  }
}

export function createWatcher(deps: WatcherDeps): { start(): void; stop(): void; nudge(): void } {
  let stopped = false
  /** Pre-run token totals per item id, consumed by the completion stage. */
  const preSnapshots = new Map<string, number>()

  /** Globally free = every live agent is idle; zero agents counts as free. */
  const isGloballyFree = () => deps.agents.list().every(agent => agent.status === 'idle')

  const interrupt = (item: QueueItem) => deps.store.update(item.id, { status: 'interrupted' })

  /**
   * Start the first queued item (file order) in its session: a fresh session
   * is created, a persisted one resumed, a live one continued. Every branch
   * delivers the item's text as the turn's prompt, and a freshly created
   * session is attached to the item's workspace. The pre-run token total is
   * recorded for the completion stage. A failure starting the session
   * interrupts the item rather than leaving it `running` blank.
   */
  const executeNext = async () => {
    const item = deps.store.list().find(candidate => candidate.status === 'queued')
    if (item === undefined) return

    const target = item.targetSessionId
    const live = target === null ? undefined : deps.agents.get(target)
    if (target !== null && live === undefined && deps.persistence.stat(target) === undefined) {
      interrupt(item)
      return
    }

    const sessionId = target === null ? randomUUID() : target
    const totals = target === null ? undefined : deps.projections.tokenUsage(target)
    const preSnapshot = (totals?.uncachedInputTokens ?? 0) + (totals?.outputTokens ?? 0) + (totals?.cacheReadTokens ?? 0) + (totals?.cacheWriteTokens ?? 0)

    try {
      const options: { sessionId: string; meta: { cwd: string }; agentPreset?: string } = { sessionId, meta: { cwd: item.workspacePath } }
      // Carry the preset only when present: a preset-less create stays key-free.
      if (item.agentPreset !== undefined) options.agentPreset = item.agentPreset
      const agent = live ?? (target === null
        ? await deps.agents.create(options)
        : await deps.agents.resume({ resumeSessionId: target }))
      agent.followup({ content: [{ type: 'text', text: item.text }], source: { kind: 'user' } })
      if (target === null) await deps.workspaces.attach(sessionId, item.workspacePath)
    } catch {
      interrupt(item)
      return
    }

    preSnapshots.set(item.id, preSnapshot)
    deps.store.update(item.id, { status: 'running', sessionId, startedAt: Date.now() })
  }

  // Dispatches are serialized: a queued item is created (or resumed) before the
  // next is picked, so concurrent wakes never start two items at once.
  let execution: Promise<void> = Promise.resolve()
  const checkForNext = () => {
    if (stopped) return
    if (!isGloballyFree()) return
    execution = execution.then(() => executeNext())
  }

  /**
   * Finish the running item of a session on turn/end: `done` on a completed
   * end, `interrupted` for any other reason, with the token delta against the
   * pre-run snapshot when post totals exist; then the normal next-check.
   */
  const completeSession = (session: { id: string }, event: { type: string; data?: { reason?: string } }) => {
    const item = event.type === 'turn/end'
      ? deps.store.list().find(candidate => candidate.status === 'running' && candidate.sessionId === session.id)
      : undefined
    if (item === undefined) {
      checkForNext()
      return
    }

    const totals = deps.projections.tokenUsage(session.id)
    const post = totals === undefined
      ? undefined
      : totals.uncachedInputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
    const pre = preSnapshots.get(item.id) ?? 0
    const status = event.data?.reason === 'completed' ? 'done' : 'interrupted'
    deps.store.update(item.id, post === undefined
      ? { status, endedAt: Date.now() }
      : { status, endedAt: Date.now(), stats: { tokens: post - pre } }
    )
    preSnapshots.delete(item.id)
    checkForNext()
  }

  const start = () => {
    /** Restart recovery: running items whose session has no live agent are interrupted; live ones finish via turn/end. */
    deps.store.list()
      .filter(item => item.status === 'running' && item.sessionId !== undefined && deps.agents.get(item.sessionId) === undefined)
      .forEach(interrupt)
    deps.events.onAgentStatus(checkForNext)
    deps.events.onSessionEvent(completeSession)
    checkForNext()
  }

  const stop = () => {
    stopped = true
  }

  return { start, stop, nudge: checkForNext }
}

