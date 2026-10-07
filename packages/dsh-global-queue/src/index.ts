/**
 * The global-queue plugin, host face. The queue store, the watcher, and the
 * /global-queue RPC route are composed in `apply`.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { QueueStore } from './queue/store.ts'
import { createWatcher, type TokenTotals, type WatcherAgent, type WatcherDeps } from './queue/watcher.ts'
import { mountChannel, type WebServerRegistry } from './rpc.ts'

export const name = 'global-queue'

/** The host services the watcher reads; declared so `ctx.<name>` resolves in `apply`. */
export const inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'workspaceRegistry', 'agentDefaultModel', 'agentPresets']

export interface Config {
  path: string
}

export const Config: z<Config> = z.object({
  /** Queue file (default: $DSH_HOME/.global-queue.json). */
  path: z.string().default(join(resolveDshHome(), '.global-queue.json')),
})

/** The user message the host agent's followup accepts (id and role added over the watcher's message). */
type LiveUserMessage = {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
}

/** A live agent, as this plugin consumes it. */
interface LiveAgent {
  id: string
  status: 'idle' | 'running'
  followup(message: LiveUserMessage): void
}

/** Per-agent model options (`ctx.agents.create`'s `agentOptions`), as this plugin consumes them. */
interface AgentOptionsMirror {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
}

/** The agent registry seam (`ctx.agents`), as this plugin consumes it. */
interface AgentsSeam {
  list(): LiveAgent[]
  get(id: string): LiveAgent | undefined
  create(options: {
    sessionId: string
    agentOptions?: AgentOptionsMirror
    meta: { cwd: string; agentPreset?: string }
    setup?: (agentCtx: Context) => Promise<void>
  }): Promise<{ agent: LiveAgent }>
  resume(options: { resumeSessionId: string; setup?: (agentCtx: Context) => Promise<void> }): Promise<{ agent: LiveAgent }>
}

/** The agent-preset registry seam (`ctx.agentPresets`), as this plugin consumes it. */
interface AgentPresetsSeam {
  resolve(id?: string): Promise<{ id: string }>
  mount(agentCtx: Context, id: string): Promise<{ id: string }>
}

/** The default-model selection service (`ctx.agentDefaultModel`), as this plugin consumes it. */
interface AgentDefaultModelSeam {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

/** A live session, as this plugin consumes it. */
interface LiveSession {
  id: string
}

/** The session store seam (`ctx.sessions`), as this plugin consumes it. */
interface SessionsSeam {
  get(id: string): LiveSession | undefined
}

/** The session-persistence seam (`ctx.sessionPersistence`), as this plugin consumes it. */
interface PersistenceSeam {
  stat(id: string): Promise<{ header: { cwd?: string; agentPreset?: string } } | undefined>
}

/** The session-projections seam (`ctx.sessionProjections`), as this plugin consumes it. */
interface ProjectionsSeam {
  stateOf(session: LiveSession, key: 'tokenUsage'): { totals: TokenTotals } | undefined
}

/** A workspace record, as this plugin consumes it: only attaching a session matters. */
interface WorkspaceSeam {
  attachSession(sessionId: string): Promise<void>
}

/**
 * The workspace registry seam (`ctx.workspaceRegistry`), as this plugin consumes
 * it. `create` resolves (creating if needed) the workspace for an existing
 * directory, so a freshly created session can be attached to it.
 */
interface WorkspaceRegistrySeam {
  create(path: string, title?: string): Promise<WorkspaceSeam>
}

/** A session event, as this plugin consumes it (only the `turn/end` reason matters). */
interface SessionEventMirror {
  type: string
  data?: { reason?: { kind: string } }
}

// The dsh 0.2.0 host provides these seams on plugin contexts, but this plugin does
// not depend on the dsh packages that type them, so these structural mirrors carry
// the reads. The matching service names are declared in the `inject` export above.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The live agent registry. */
    agents: AgentsSeam
    /** The live session store. */
    sessions: SessionsSeam
    /** Durable session persistence (headers). */
    sessionPersistence: PersistenceSeam
    /** Live session-projection state. */
    sessionProjections: ProjectionsSeam
    /** Durable workspace records (session-to-workspace attachment). */
    workspaceRegistry: WorkspaceRegistrySeam
    /** The default-model selection (bound to freshly created sessions). */
    agentDefaultModel: AgentDefaultModelSeam
    /** The agent-preset registry (resolved and mounted onto created agents). */
    agentPresets: AgentPresetsSeam
    /** The host web server's route registry. */
    webServer: WebServerRegistry
  }

  interface Events {
    /** An agent's status flipped (`idle` ⇄ `running`). */
    'agent/status'(payload: { agent: LiveAgent; status: 'idle' | 'running' }): void
    /** A session event was recorded. */
    'session/event'(session: LiveSession, event: SessionEventMirror): void
  }
}

/** Adapt a live host agent to the watcher's pinned agent interface. */
const toWatcherAgent = (agent: LiveAgent): WatcherAgent => ({
  id: agent.id,
  status: agent.status,
  followup: (message) => agent.followup({ id: randomUUID(), role: 'user', content: message.content, source: message.source }),
})

export async function apply(ctx: Context, config: Config): Promise<() => void> {
  const store = new QueueStore(config.path)

  // The watcher reads persistence.stat synchronously, but the host seam is async:
  // pre-load the stat of every queued target session so the synchronous read is
  // always a hit for the items present at boot.
  const statCache = new Map<string, { header: { cwd: string } } | undefined>()
  const loadStat = (id: string): Promise<void> => {
    if (statCache.has(id)) return Promise.resolve()
    return ctx.sessionPersistence.stat(id).then(
      snapshot => {
        statCache.set(id, snapshot === undefined ? undefined : { header: { cwd: snapshot.header.cwd ?? '' } })
      },
      () => {
        statCache.set(id, undefined)
      },
    )
  }
  await Promise.all(store.list().map(item => item.targetSessionId).filter((id): id is string => id !== null).map(loadStat))

  const deps: WatcherDeps = {
    store,
    agents: {
      list: () => ctx.agents.list().map(toWatcherAgent),
      get: (id) => {
        const agent = ctx.agents.get(id)
        if (agent === undefined) return undefined
        return toWatcherAgent(agent)
      },
      // Create (or resume) the session, then fetch its live handle so the
      // watcher can deliver the item's text as the turn's prompt. A failure
      // rejects, which the watcher turns into an `interrupted` item. The
      // session's model is bound like the normal session path: without it the
      // deployment's `{{model}}` prompt variable resolves empty and the
      // assembly throws.
      create: async ({ sessionId, meta, agentPreset }) => {
        const selection = ctx.agentDefaultModel.currentSelection()
        const options: { sessionId: string; agentOptions: AgentOptionsMirror; meta: { cwd: string; agentPreset?: string }; setup?: (agentCtx: Context) => Promise<void> } = {
          sessionId,
          agentOptions: { provider: selection.provider, model: selection.model },
          meta: { cwd: meta.cwd },
        }
        // The item carries a preset id: resolve it before create (a failure
        // rejects cleanly, which the watcher turns into an `interrupted`
        // item) and mount it on the created agent via setup.
        if (agentPreset !== undefined) {
          const preset = await ctx.agentPresets.resolve(agentPreset)
          options.meta.agentPreset = preset.id
          options.setup = async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset.id) }
        }
        await ctx.agents.create(options)
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) throw new Error(`global-queue: agent not found after create: ${sessionId}`)
        return toWatcherAgent(agent)
      },
      resume: async ({ resumeSessionId }) => {
        const stat = await ctx.sessionPersistence.stat(resumeSessionId)
        const options: { resumeSessionId: string; setup?: (agentCtx: Context) => Promise<void> } = { resumeSessionId }
        // The session's header may carry a stored agent preset: re-mount it on
        // the resumed agent via setup (the preset is locked to the session, so
        // it is only re-mounted, never changed).
        const agentPreset = stat?.header.agentPreset
        if (agentPreset !== undefined) {
          options.setup = async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, agentPreset) }
        }
        await ctx.agents.resume(options)
        const agent = ctx.agents.get(resumeSessionId)
        if (agent === undefined) throw new Error(`global-queue: agent not found after resume: ${resumeSessionId}`)
        return toWatcherAgent(agent)
      },
    },
    workspaces: {
      // Resolve (creating if needed) the workspace for the item's directory,
      // then attach the freshly created session to it.
      attach: (sessionId, workspacePath) => ctx.workspaceRegistry.create(workspacePath).then(workspace => workspace.attachSession(sessionId)),
    },
    persistence: {
      stat: (id) => statCache.get(id),
    },
    projections: {
      tokenUsage: (id) => {
        const session = ctx.sessions.get(id)
        if (session === undefined) return undefined
        return ctx.sessionProjections.stateOf(session, 'tokenUsage')?.totals
      },
    },
    events: {
      onAgentStatus: (handler) => {
        ctx.on('agent/status', ({ agent, status }) => handler(agent.id, status))
      },
      onSessionEvent: (handler) => {
        ctx.on('session/event', (session, event) => {
          const reason = event.type === 'turn/end' ? event.data?.reason?.kind : undefined
          if (reason === undefined) {
            handler(session, { type: event.type })
            return
          }
          handler(session, { type: event.type, data: { reason } })
        })
      },
    },
  }

  const watcher = createWatcher(deps)

  // Mount the /global-queue RPC channel on the host web server. On dsh
  // 0.2.0-rc.2 the host's rpc-host effect registers in a context without
  // webServer, so the channel's route is mounted here: inject webServer,
  // then register the prefix route from the context the injection returns.
  // The channel's `add` wakes the watcher so a freshly queued item starts even
  // with no live agent to fire an `agent/status` event.
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => mountChannel(store, webCtx.webServer, watcher.nudge), 'global-queue: /global-queue channel')
  })

  watcher.start()
  return () => watcher.stop()
}
