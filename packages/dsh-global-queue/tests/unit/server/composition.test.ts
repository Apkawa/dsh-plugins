/**
 * The composition root applied to a real Cordis context with injected seam
 * doubles (no globalThis mocks): a watcher-created session must bind the
 * default-model selection as the agent's `agentOptions` — without the binding
 * the deployment's `{{model}}` prompt variable resolves empty and the
 * assembly throws — and mount the item's agent preset via the create call's
 * `setup` callback.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'
import { Config, apply, inject, name } from '../../../src/index.ts'
import { QueueStore } from '../../../src/queue/store.ts'

/** Repo-local .tmp (git-ignored); per-scenario temp dirs for the test run live here. */
const repoTmp = fileURLToPath(new URL('../../../../../.tmp', import.meta.url))
const createdDirs: string[] = []

afterAll(async () => {
  await Promise.all(createdDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

/** A fixed default-model selection, as the host service reports it. */
const SELECTION = { provider: 'deepseek', model: 'test-model' }

/** The agent preset id the test's queue item carries. */
const PRESET_ID = 'preset-alpaca'

/** The session id the resume-targeted queue items point at. */
const RESUME_TARGET_ID = 'session-resume'
/** The agent preset id stored on that session's header. */
const RESUME_PRESET_ID = 'preset-resume'
/** A second resume target whose header carries no agent preset. */
const RESUME_PLAIN_TARGET_ID = 'session-resume-plain'

/** Agents double: a mutable registry of live agents that records create calls. */
function makeAgents() {
  type Entry = { id: string; status: 'idle' | 'running'; followup(): void }
  type CreateCall = {
    sessionId: string
    agentOptions?: { provider?: string; model?: string }
    meta: { cwd: string; agentPreset?: string }
    setup?: (agentContext: unknown) => void
  }
  type ResumeCall = {
    resumeSessionId: string
    setup?: (agentContext: unknown) => void
  }
  const entries = new Map<string, Entry>()
  const createCalls: CreateCall[] = []
  const resumeCalls: ResumeCall[] = []
  const agent = (id: string): Entry => ({ id, status: 'running', followup: () => {} })
  return {
    createCalls,
    resumeCalls,
    list: () => [...entries.values()],
    get: (id: string) => entries.get(id),
    create: (options: CreateCall) => {
      createCalls.push(options)
      const entry = agent(options.sessionId)
      entries.set(options.sessionId, entry)
      return Promise.resolve({ agent: entry })
    },
    resume: (options: ResumeCall) => {
      resumeCalls.push(options)
      const entry = agent(options.resumeSessionId)
      entries.set(options.resumeSessionId, entry)
      return Promise.resolve({ agent: entry })
    },
  }
}

/** Agent presets double: resolves the fixed preset and records mount calls. */
function makeAgentPresets() {
  const mountCalls: Array<{ agentContext: unknown; presetId: string }> = []
  return {
    mountCalls,
    resolve: () => ({ id: PRESET_ID }),
    mount: (agentContext: unknown, presetId: string) => {
      mountCalls.push({ agentContext, presetId })
    },
  }
}

/** The durable session headers the `sessionPersistence` double reports per session id. */
type StatHeaders = Record<string, { header: { cwd: string; agentPreset?: string } }>

/** Provide the host seam doubles the plugin's `inject` list resolves against. */
function provideSeams(ctx: Context, agents: ReturnType<typeof makeAgents>, presets: ReturnType<typeof makeAgentPresets>, stats?: StatHeaders) {
  ctx.provide('agents', agents as never)
  ctx.provide('agentPresets', presets as never)
  ctx.provide('sessions', { get: () => undefined } as never)
  ctx.provide('sessionPersistence', { stat: (id: string) => Promise.resolve(stats?.[id]) } as never)
  ctx.provide('sessionProjections', { stateOf: () => undefined } as never)
  ctx.provide('workspaceRegistry', { create: () => Promise.resolve({ attachSession: () => Promise.resolve() }) } as never)
  ctx.provide('agentDefaultModel', { currentSelection: () => SELECTION } as never)
  ctx.provide('webServer', { register: () => () => {} } as never)
}

describe('global-queue composition root', () => {
  it('binds the default-model selection to a watcher-created session', async () => {
    const dir = await mkdtemp(join(repoTmp, 'global-queue-composition-bind-'))
    createdDirs.push(dir)
    const path = join(dir, 'queue.json')
    const store = new QueueStore(path)
    const item = store.add({ text: 'bind the model', workspacePath: '/ws/bind', targetSessionId: null, agentPreset: PRESET_ID })
    const agents = makeAgents()
    const presets = makeAgentPresets()

    const ctx = new Context()
    provideSeams(ctx, agents, presets)
    const fiber = ctx.plugin({ name, inject, Config, apply }, { path })
    try {
      await fiber.await()
      // The watcher picks up the queued new-session item at boot and records
      // the created session id on it; the create call must carry the
      // default-model selection.
      const deadline = Date.now() + 10_000
      const settle = async () => {
        for (;;) {
          const entry = new QueueStore(path).list().find(candidate => candidate.id === item.id)
          if (entry?.status === 'interrupted') throw new Error(`the item was interrupted: ${JSON.stringify(entry)}`)
          if (entry?.sessionId !== undefined) return entry.sessionId
          if (Date.now() > deadline) throw new Error('the watcher never created an agent')
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
      const sessionId = await settle()
      expect(agents.createCalls[0]).toEqual({
        sessionId,
        agentOptions: { provider: SELECTION.provider, model: SELECTION.model },
        meta: { cwd: '/ws/bind', agentPreset: PRESET_ID },
        setup: expect.any(Function),
      })
      // The setup callback mounts the item's agent preset on the created agent.
      const fakeAgentContext = { id: sessionId }
      agents.createCalls[0]?.setup?.(fakeAgentContext)
      expect(presets.mountCalls).toEqual([{ agentContext: fakeAgentContext, presetId: PRESET_ID }])
    } finally {
      await fiber.dispose()
    }
  })

  it('mounts the resumed session\'s stored agent preset via the resume call\'s setup', async () => {
    const dir = await mkdtemp(join(repoTmp, 'global-queue-composition-resume-preset-'))
    createdDirs.push(dir)
    const path = join(dir, 'queue.json')
    const store = new QueueStore(path)
    const item = store.add({ text: 'resume with the stored preset', workspacePath: '/ws/resume', targetSessionId: RESUME_TARGET_ID })
    const agents = makeAgents()
    const presets = makeAgentPresets()

    const ctx = new Context()
    provideSeams(ctx, agents, presets, {
      [RESUME_TARGET_ID]: { header: { cwd: '/ws/resume', agentPreset: RESUME_PRESET_ID } },
    })
    const fiber = ctx.plugin({ name, inject, Config, apply }, { path })
    try {
      await fiber.await()
      // The watcher picks up the queued existing-session item at boot and
      // resumes it; the resume call must carry a setup callback that mounts
      // the session's stored agent preset.
      const deadline = Date.now() + 10_000
      const settle = async () => {
        for (;;) {
          const entry = new QueueStore(path).list().find(candidate => candidate.id === item.id)
          if (entry?.status === 'interrupted') throw new Error(`the item was interrupted: ${JSON.stringify(entry)}`)
          if (agents.resumeCalls.length > 0) return agents.resumeCalls[0]
          if (Date.now() > deadline) throw new Error('the watcher never resumed the session')
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
      const call = await settle()
      expect(call.setup).toBeTypeOf('function')
      const fakeAgentContext = { id: RESUME_TARGET_ID }
      call.setup?.(fakeAgentContext)
      expect(presets.mountCalls).toEqual([{ agentContext: fakeAgentContext, presetId: RESUME_PRESET_ID }])
    } finally {
      await fiber.dispose()
    }
  })

  it('resumes a session without a stored agent preset without a setup', async () => {
    const dir = await mkdtemp(join(repoTmp, 'global-queue-composition-resume-plain-'))
    createdDirs.push(dir)
    const path = join(dir, 'queue.json')
    const store = new QueueStore(path)
    const item = store.add({ text: 'resume without a preset', workspacePath: '/ws/resume-plain', targetSessionId: RESUME_PLAIN_TARGET_ID })
    const agents = makeAgents()
    const presets = makeAgentPresets()

    const ctx = new Context()
    provideSeams(ctx, agents, presets, {
      [RESUME_PLAIN_TARGET_ID]: { header: { cwd: '/ws/resume-plain' } },
    })
    const fiber = ctx.plugin({ name, inject, Config, apply }, { path })
    try {
      await fiber.await()
      const deadline = Date.now() + 10_000
      const settle = async () => {
        for (;;) {
          const entry = new QueueStore(path).list().find(candidate => candidate.id === item.id)
          if (entry?.status === 'interrupted') throw new Error(`the item was interrupted: ${JSON.stringify(entry)}`)
          if (agents.resumeCalls.length > 0) return agents.resumeCalls[0]
          if (Date.now() > deadline) throw new Error('the watcher never resumed the session')
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      }
      const call = await settle()
      // No stored preset: the resume call must not carry a setup callback.
      expect(call.setup).toBeUndefined()
      expect(presets.mountCalls).toEqual([])
    } finally {
      await fiber.dispose()
    }
  })
})
