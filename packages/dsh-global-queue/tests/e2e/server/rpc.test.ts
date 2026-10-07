import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startDsh, stopDsh, rpc, type DshHandle } from '@root/tests-helpers/e2e/dsh-fixture.ts'
import { E2E_DSH_VERSIONS } from '@root/tests-helpers/e2e/dsh.ts'

/** A queue row as returned by the /global-queue endpoints (mirrors src/queue/types.ts). */
interface QueueItem {
  id: string
  text: string
  workspacePath: string
  targetSessionId: string | null
  status: 'queued' | 'running' | 'done' | 'interrupted'
  sessionId?: string
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

const findItem = (items: QueueItem[], id: string) => items.find(candidate => candidate.id === id)

/** One `add` round-trip; fails the test on a non-ok result. */
async function addItem(handle: DshHandle, text: string): Promise<QueueItem> {
  const res = await rpc<ItemResult>(handle, CHANNEL, 'add', { text, workspacePath: WORKSPACE, targetSessionId: null })
  expect(res.ok).toBe(true)
  return res.value!.item
}

const listItems = async (handle: DshHandle): Promise<QueueItem[]> => {
  const res = await rpc<ListResult>(handle, CHANNEL, 'list', {})
  expect(res.ok).toBe(true)
  return res.value!.items
}

/**
 * Live e2e for the /global-queue RPC channel: one `dsh web` per version,
 * pinning the channel's request/response contract endpoint by endpoint.
 */
describe.each(E2E_DSH_VERSIONS)('global-queue e2e RPC (live dsh web, %s)', (version) => {
  let handle: DshHandle | undefined

  beforeAll(async () => {
    handle = await startDsh({ packageName: 'dsh-global-queue', version })
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    const result = await stopDsh(handle)
    expect(result.code).toBe(0)
    expect(result.rootRemoved).toBe(true)
  }, 60_000)

  it('list: a fresh instance returns an empty queue', async () => {
    const res = await rpc<ListResult>(handle!, CHANNEL, 'list', {})
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ items: [] })
  })

  it('add: returns the queued item and list contains exactly it', async () => {
    const res = await rpc<ItemResult>(handle!, CHANNEL, 'add', { text: 'write the tests', workspacePath: WORKSPACE, targetSessionId: null })
    expect(res.ok).toBe(true)
    const item = res.value!.item
    expect(item.status).toBe('queued')
    expect(item.text).toBe('write the tests')
    expect(item.workspacePath).toBe(WORKSPACE)
    expect(item.targetSessionId).toBeNull()
    expect(typeof item.id).toBe('string')
    expect(typeof item.createdAt).toBe('number')
    expect(typeof item.updatedAt).toBe('number')
    const items = await listItems(handle!)
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(item)
  })

  it('reorder: moves the second item to the front of the file order', async () => {
    const first = await addItem(handle!, 'first prompt')
    const second = await addItem(handle!, 'second prompt')
    const moved = await rpc<ListResult>(handle!, CHANNEL, 'reorder', { id: second.id, toIndex: 0 })
    expect(moved.ok).toBe(true)
    const items = moved.value!.items
    expect(items[0]?.id).toBe(second.id)
    expect(items.findIndex(candidate => candidate.id === second.id)).toBeLessThan(items.findIndex(candidate => candidate.id === first.id))
  })

  it('editText: updates the item text and list reflects it', async () => {
    const item = await addItem(handle!, 'draft prompt')
    const edited = await rpc<ItemResult>(handle!, CHANNEL, 'editText', { id: item.id, text: 'edited text' })
    expect(edited.ok).toBe(true)
    expect(edited.value!.item.id).toBe(item.id)
    expect(edited.value!.item.text).toBe('edited text')
    const items = await listItems(handle!)
    expect(findItem(items, item.id)?.text).toBe('edited text')
  })

  it('remove: drops the item and list no longer contains it', async () => {
    const item = await addItem(handle!, 'to remove')
    const removed = await rpc<{ ok: boolean }>(handle!, CHANNEL, 'remove', { id: item.id })
    expect(removed.ok).toBe(true)
    expect(removed.value).toEqual({ ok: true })
    const items = await listItems(handle!)
    expect(items.every(candidate => candidate.id !== item.id)).toBe(true)
  })

  it('editText: an unknown id yields an error result', async () => {
    // The fixture's rpc() never rejects: non-2xx / unparseable responses come
    // back as { ok: false, error } — so the contract pin is the error flag.
    const res = await rpc<ItemResult>(handle!, CHANNEL, 'editText', { id: 'no-such-id', text: 'boom' })
    expect(res.ok).toBe(false)
  })
})
