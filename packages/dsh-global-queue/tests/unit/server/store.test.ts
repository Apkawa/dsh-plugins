import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QueueStore } from '../../../src/queue/store.ts'
import type { QueueItem } from '../../../src/queue/types.ts'

/** Repo-local .tmp (git-ignored); temp state for the test run lives here. */
const repoTmp = fileURLToPath(new URL('../../../../../.tmp', import.meta.url))

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(repoTmp, 'global-queue-store-'))
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/** A fresh store backed by its own file in the shared temp dir. */
function freshStore(name: string): QueueStore {
  return new QueueStore(join(tmpDir, name))
}

describe('QueueStore', () => {
  it('list() returns [] when the file does not exist (first boot)', () => {
    expect(freshStore('missing.json').list()).toEqual([])
  })

  describe('add', () => {
    it('creates a queued item echoing the input, visible via list()', () => {
      const store = freshStore('add.json')
      const item = store.add({ text: 'hello world', workspacePath: '/ws/a', targetSessionId: null })
      expect(item.id).toBeTypeOf('string')
      expect(item.id.length).toBeGreaterThan(0)
      expect(item.status).toBe('queued')
      expect(typeof item.createdAt).toBe('number')
      expect(typeof item.updatedAt).toBe('number')
      expect(item.text).toBe('hello world')
      expect(item.workspacePath).toBe('/ws/a')
      expect(item.targetSessionId).toBeNull()
      expect(store.list()).toEqual([item])
    })

    it('preserves a non-null targetSessionId', () => {
      const item = freshStore('add-session.json').add({ text: 'hi', workspacePath: '/ws/b', targetSessionId: 'sess-1' })
      expect(item.targetSessionId).toBe('sess-1')
    })

    it('throws on empty or whitespace-only text', () => {
      const store = freshStore('add-empty.json')
      expect(() => store.add({ text: '', workspacePath: '/ws/c', targetSessionId: null })).toThrow()
      expect(() => store.add({ text: '   \n  ', workspacePath: '/ws/c', targetSessionId: null })).toThrow()
    })

    // The rpc `add` endpoint dispatches straight to store.add, so this pins the
    // boundary the channel relies on: add accepts agentPreset and stores it.
    it('stores an agentPreset passed to add and returns it via list()', () => {
      const store = freshStore('add-preset.json')
      const item = store.add({ text: 't', workspacePath: '/ws', targetSessionId: null, agentPreset: 'preset-x' })
      expect(item.agentPreset).toBe('preset-x')
      expect(store.list()[0]?.agentPreset).toBe('preset-x')
    })
  })

  it('keeps agentPreset intact through the list and editText round-trip', () => {
    const store = freshStore('preset-roundtrip.json')
    const item = store.add({ text: 'old', workspacePath: '/ws', targetSessionId: null, agentPreset: 'preset-x' })
    const edited = store.editText(item.id, 'new')
    expect(edited.agentPreset).toBe('preset-x')
    expect(store.list()[0]?.agentPreset).toBe('preset-x')
  })

  describe('reorder', () => {
    it('moves the first item to the last, then an item to index 1', () => {
      const store = freshStore('reorder.json')
      const a = store.add({ text: 'a', workspacePath: '/ws', targetSessionId: null })
      const b = store.add({ text: 'b', workspacePath: '/ws', targetSessionId: null })
      const c = store.add({ text: 'c', workspacePath: '/ws', targetSessionId: null })
      expect(store.reorder(a.id, 2).map((i) => i.id)).toEqual([b.id, c.id, a.id])
      expect(store.reorder(a.id, 1).map((i) => i.id)).toEqual([b.id, a.id, c.id])
      expect(store.list().map((i) => i.id)).toEqual([b.id, a.id, c.id])
    })

    it('throws for an unknown id', () => {
      const store = freshStore('reorder-unknown.json')
      store.add({ text: 'a', workspacePath: '/ws', targetSessionId: null })
      expect(() => store.reorder('nope', 0)).toThrow()
    })

    it('throws for an out-of-range index', () => {
      const store = freshStore('reorder-range.json')
      const a = store.add({ text: 'a', workspacePath: '/ws', targetSessionId: null })
      expect(() => store.reorder(a.id, 1)).toThrow()
      expect(() => store.reorder(a.id, -1)).toThrow()
    })
  })

  describe('editText', () => {
    it('updates the text and does not move updatedAt backwards', () => {
      const store = freshStore('edit.json')
      const item = store.add({ text: 'old', workspacePath: '/ws', targetSessionId: null })
      const edited = store.editText(item.id, 'new')
      expect(edited.text).toBe('new')
      expect(edited.updatedAt).toBeGreaterThanOrEqual(item.updatedAt)
      expect(store.list()[0]?.text).toBe('new')
    })

    it('throws for an unknown id', () => {
      expect(() => freshStore('edit-unknown.json').editText('nope', 'x')).toThrow()
    })
  })

  describe('remove', () => {
    it('removes the item from the list', () => {
      const store = freshStore('remove.json')
      const a = store.add({ text: 'a', workspacePath: '/ws', targetSessionId: null })
      const b = store.add({ text: 'b', workspacePath: '/ws', targetSessionId: null })
      store.remove(a.id)
      expect(store.list().map((i) => i.id)).toEqual([b.id])
    })

    it('throws for an unknown id', () => {
      expect(() => freshStore('remove-unknown.json').remove('nope')).toThrow()
    })
  })

  describe('update', () => {
    it('persists queued→running→done with session and runtime fields', () => {
      const store = freshStore('update.json')
      const item = store.add({ text: 't', workspacePath: '/ws', targetSessionId: null })
      const started = store.update(item.id, { status: 'running', sessionId: 'sess-1', startedAt: 1_700_000_000_000 })
      expect(started.status).toBe('running')
      expect(started.sessionId).toBe('sess-1')
      expect(started.startedAt).toBe(1_700_000_000_000)
      const done = store.update(item.id, { status: 'done', endedAt: 1_700_000_005_000, stats: { tokens: 42 } })
      expect(done.status).toBe('done')
      expect(done.endedAt).toBe(1_700_000_005_000)
      expect(done.stats).toEqual({ tokens: 42 })
      const listed = store.list()[0]
      expect(listed?.status).toBe('done')
      expect(listed?.sessionId).toBe('sess-1')
      expect(listed?.startedAt).toBe(1_700_000_000_000)
      expect(listed?.endedAt).toBe(1_700_000_005_000)
      expect(listed?.stats).toEqual({ tokens: 42 })
    })

    it('throws for an unknown id', () => {
      expect(() => freshStore('update-unknown.json').update('nope', { status: 'done' })).toThrow()
    })
  })

  it('a second store on the same path observes all prior mutations', () => {
    const path = join(tmpDir, 'persist.global-queue.json')
    const first = new QueueStore(path)
    const a = first.add({ text: 'a', workspacePath: '/ws', targetSessionId: 's-1' })
    const b = first.add({ text: 'b', workspacePath: '/ws', targetSessionId: null })
    first.editText(a.id, 'a2')
    first.reorder(b.id, 0)
    first.update(a.id, { status: 'done', endedAt: 9, stats: { tokens: 7 } })
    first.remove(b.id)

    const listed = new QueueStore(path).list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(a.id)
    expect(listed[0]?.text).toBe('a2')
    expect(listed[0]?.targetSessionId).toBe('s-1')
    expect(listed[0]?.status).toBe('done')
    expect(listed[0]?.endedAt).toBe(9)
    expect(listed[0]?.stats).toEqual({ tokens: 7 })
  })

  it('interleaved stores leave a valid file with every add present', () => {
    const path = join(tmpDir, 'concurrent.global-queue.json')
    const one = new QueueStore(path)
    const two = new QueueStore(path)
    const added: QueueItem[] = []
    for (let i = 0; i < 10; i++) {
      added.push(one.add({ text: `one-${i}`, workspacePath: '/ws', targetSessionId: null }))
      added.push(two.add({ text: `two-${i}`, workspacePath: '/ws', targetSessionId: null }))
    }
    for (let i = 0; i < added.length; i++) {
      (i % 2 === 0 ? one : two).editText(added[i].id, added[i].text + '!')
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    expect(parsed).toBeDefined()
    expect(new QueueStore(path).list()).toHaveLength(20)
  })

  it('persists a valid JSON file with mode 0o600', () => {
    const path = join(tmpDir, '.global-queue.json')
    const store = new QueueStore(path)
    const item = store.add({ text: 't', workspacePath: '/ws', targetSessionId: null })
    store.update(item.id, { status: 'done' })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toBeDefined()
  })
})
