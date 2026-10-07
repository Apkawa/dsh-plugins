import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startDsh, stopDsh, rpc, writeSettings, sleep, ROUTE_ID, MODEL_ID, type DshHandle } from '@root/tests-helpers/e2e/dsh-fixture.ts'
import { E2E_DSH_VERSIONS } from '@root/tests-helpers/e2e/dsh.ts'

/** A queue row as returned by the /global-queue endpoints (mirrors src/queue/types.ts). */
interface QueueItem {
  id: string
  text: string
  workspacePath: string
  targetSessionId: string | null
  status: 'queued' | 'running' | 'done' | 'interrupted'
  sessionId?: string
  agentPreset?: string
  stats?: { tokens: number }
  startedAt?: number
  endedAt?: number
  createdAt: number
  updatedAt: number
}

type ListResult = { items: QueueItem[] }
type ItemResult = { item: QueueItem }

const CHANNEL = 'global-queue'
const WORKSPACE = process.cwd()
// A preset the web-app bundle ships in every fresh home (`standard` is the
// default, `ptc` and `minimal` are the companions) — no provisioning needed.
const PRESET_ID = 'ptc'
const STATUS_POLL_MS = 500
const STATUS_DEADLINE_MS = 90_000

const findItem = (items: QueueItem[], id: string) => items.find(candidate => candidate.id === id)

const listItems = async (handle: DshHandle): Promise<QueueItem[]> => {
  const res = await rpc<ListResult>(handle, CHANNEL, 'list', {})
  expect(res.ok).toBe(true)
  return res.value!.items
}

/** One `add` round-trip; fails the test on a non-ok result. */
const addItem = async (handle: DshHandle, text: string, options: { targetSessionId?: string | null; agentPreset?: string } = {}): Promise<QueueItem> => {
  const payload: Record<string, unknown> = { text, workspacePath: WORKSPACE, targetSessionId: options.targetSessionId ?? null }
  if (options.agentPreset !== undefined) payload.agentPreset = options.agentPreset
  const res = await rpc<ItemResult>(handle, CHANNEL, 'add', payload)
  expect(res.ok).toBe(true)
  return res.value!.item
}

/** Poll the queue until the item leaves `queued`; fails the test on deadline. */
const waitForStatus = async (handle: DshHandle, id: string, predicate: (item: QueueItem) => boolean): Promise<QueueItem> => {
  const deadline = Date.now() + STATUS_DEADLINE_MS
  for (;;) {
    const item = findItem(await listItems(handle), id)
    if (item !== undefined && predicate(item)) return item
    if (Date.now() > deadline) throw new Error(`item ${id} never left the "queued" state: ${JSON.stringify(item)}`)
    await sleep(STATUS_POLL_MS)
  }
}

// The session-projection-cache artifact of a session under the isolated home:
// one JSON record per session whose `rows.agentPreset.val` is the live
// `agentPreset` projection (initialized from the session header's stored
// preset, `header.agentPreset ?? null`). The 0.2.0-rc.2 host RPC channel is
// broken host-side, so this file is the lane's session-inspection surface.
const projectionPreset = (handle: DshHandle, sessionId: string): string | null | undefined => {
  const path = join(handle.root, '.dsh', 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  if (!existsSync(path)) return undefined
  const record = JSON.parse(readFileSync(path, 'utf8')) as { record?: { rows?: Record<string, { val?: string | null }> } }
  return record.record?.rows?.agentPreset?.val
}

/** Poll until the session's `agentPreset` projection equals `expected`. */
const waitForPreset = async (handle: DshHandle, sessionId: string, expected: string): Promise<string> => {
  const deadline = Date.now() + STATUS_DEADLINE_MS
  for (;;) {
    const val = projectionPreset(handle, sessionId)
    if (val === expected) return val
    if (Date.now() > deadline) throw new Error(`session ${sessionId} agentPreset projection never became "${expected}" (last: ${JSON.stringify(val)})`)
    await sleep(STATUS_POLL_MS)
  }
}

/**
 * Live e2e for the queued session's agent preset, one `dsh web` per version:
 * a queued item's `agentPreset` lands in the created session's header (and
 * its live projection), and a session that already carries a header preset
 * comes back from a watcher resume with the preset mounted.
 */
describe.each(E2E_DSH_VERSIONS)('global-queue e2e preset (live dsh web, %s)', (version) => {
  let handle: DshHandle | undefined
  let createdSessionId: string | undefined

  beforeAll(async () => {
    handle = await startDsh({ packageName: 'dsh-global-queue', version })
    // Seed one model into the web profile patch so `agentDefaultModel.currentSelection`
    // answers; the dead baseURL keeps the turn from touching the network (the turn
    // may fail — the assertions target session creation and resume, not the turn).
    writeSettings(handle!, [
      `llm-pi-ai:`,
      '  providers:',
      `    ${ROUTE_ID}:`,
      '      api: openai-completions',
      '      baseURL: http://127.0.0.1:9/v1',
      '      models:',
      `        - id: ${MODEL_ID}`,
    ].join('\n'))
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    const result = await stopDsh(handle)
    expect(result.code).toBe(0)
    expect(result.rootRemoved).toBe(true)
  }, 60_000)

  it('create: a queued item with agentPreset creates a session carrying the preset', async () => {
    // The profile patch is reconciled live, so the first create can race the
    // model commit: an interrupted item without a sessionId means the create
    // failed — drop it and retry until the model is in.
    let item: QueueItem | undefined
    const deadline = Date.now() + STATUS_DEADLINE_MS
    for (;;) {
      const added = await addItem(handle!, 'write the preset tests', { agentPreset: PRESET_ID })
      item = await waitForStatus(handle!, added.id, candidate => candidate.status !== 'queued')
      if (item.sessionId !== undefined) break
      const removed = await rpc<{ ok: boolean }>(handle!, CHANNEL, 'remove', { id: item.id })
      expect(removed.ok).toBe(true)
      if (Date.now() > deadline) throw new Error('no session was ever created: the default model was not committed')
      await sleep(2_000)
    }
    expect(item!.status).not.toBe('queued')
    expect(item!.sessionId).toBeTypeOf('string')
    createdSessionId = item!.sessionId!
    // The session's live agentPreset projection equals the item's preset —
    // the projection initializes from the header, so a non-null value proves
    // the header carries it.
    expect(await waitForPreset(handle!, createdSessionId, PRESET_ID)).toBe(PRESET_ID)
  })

  it('resume: an item targeting a preset session resumes it with the preset mounted', async () => {
    expect(createdSessionId).toBeTypeOf('string')
    const item = await addItem(handle!, 'continue the preset session', { targetSessionId: createdSessionId! })
    const done = await waitForStatus(handle!, item.id, candidate => candidate.status !== 'queued')
    expect(done.status).not.toBe('queued')
    expect(done.sessionId).toBe(createdSessionId)
    // The resumed session's preset projection is intact: the stored header
    // preset was re-mounted, not dropped.
    expect(await waitForPreset(handle!, createdSessionId!, PRESET_ID)).toBe(PRESET_ID)
  })
})
