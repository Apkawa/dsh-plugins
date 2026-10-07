import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { QueueItem } from './types.ts'

const LOCK_WAIT_MS = 2_000
const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4))

/**
 * Synchronous cross-process store over one JSON file: a bare array of
 * {@link QueueItem}. Every mutation is an atomic read-modify-write serialized
 * by a `wx`-created `<filePath>.lock` sibling that records the holder's PID,
 * and the commit writes a random-suffix sibling with exclusive create at mode
 * 0o600, then renames it over the target. Both mirror the mechanism of
 * `withFileLock` and `writeFileAtomic` from `@deepseek-ai/dsh-atomic-write`,
 * whose API is async-only while this store's contract is synchronous.
 * Readers stay lock-free because the rename commit is atomic.
 */
export class QueueStore {
  constructor(private filePath: string) {}

  /** All items in file order; `[]` when the file does not exist yet. */
  list(): readonly QueueItem[] {
    return readItems(this.filePath)
  }

  add(input: { text: string; workspacePath: string; targetSessionId: string | null; agentPreset?: string }): QueueItem {
    if (input.text.trim() === '') throw new Error('global-queue: text must not be empty')
    const now = Date.now()
    const item: QueueItem = {
      id: randomUUID(),
      text: input.text,
      workspacePath: input.workspacePath,
      targetSessionId: input.targetSessionId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    }
    // Optional field: carry it only when present, so items without one stay key-free.
    if (input.agentPreset !== undefined) item.agentPreset = input.agentPreset
    this.mutate(items => [...items, item])
    return item
  }

  /** Move the item to `toIndex` in the post-removal list; returns the new order. */
  reorder(id: string, toIndex: number): readonly QueueItem[] {
    return this.mutate(items => {
      const moved = requireItem(items, id)
      if (toIndex < 0 || toIndex > items.length - 1) throw new Error(`global-queue: index ${toIndex} out of range`)
      const rest = items.filter(candidate => candidate.id !== id)
      return [...rest.slice(0, toIndex), moved, ...rest.slice(toIndex)]
    })
  }

  editText(id: string, text: string): QueueItem {
    const next = this.mutate(items => {
      requireItem(items, id)
      return items.map(item => item.id === id ? { ...item, text, updatedAt: Date.now() } : item)
    })
    return requireItem(next, id)
  }

  remove(id: string): void {
    this.mutate(items => {
      requireItem(items, id)
      return items.filter(item => item.id !== id)
    })
  }

  update(id: string, patch: Partial<Pick<QueueItem, 'status' | 'sessionId' | 'stats' | 'startedAt' | 'endedAt'>>): QueueItem {
    const next = this.mutate(items => {
      const target = requireItem(items, id)
      const updated: QueueItem = { ...target, updatedAt: Date.now() }
      if (patch.status !== undefined) updated.status = patch.status
      if (patch.sessionId !== undefined) updated.sessionId = patch.sessionId
      if (patch.stats !== undefined) updated.stats = patch.stats
      if (patch.startedAt !== undefined) updated.startedAt = patch.startedAt
      if (patch.endedAt !== undefined) updated.endedAt = patch.endedAt
      return items.map(item => item.id === id ? updated : item)
    })
    return requireItem(next, id)
  }

  private mutate(operation: (items: QueueItem[]) => QueueItem[]): QueueItem[] {
    return withLockSync(this.filePath, () => {
      const next = operation(readItems(this.filePath))
      commitItems(this.filePath, next)
      return next
    })
  }
}

/** Read the items; `[]` when the file does not exist, throw on corrupt JSON. */
function readItems(filePath: string): QueueItem[] {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as QueueItem[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
}

/** Run one read-render-commit cycle while holding the cross-process writer lock. */
function withLockSync(filePath: string, operation: () => QueueItem[]): QueueItem[] {
  const lockPath = `${filePath}.lock`
  acquireLock(lockPath)
  try {
    return operation()
  } finally {
    rmSync(lockPath, { force: true })
  }
}

/**
 * Acquire the `wx`-created lock. Contention backs off exponentially until the
 * deadline; a lock whose recorded holder process no longer exists is removed
 * and the acquisition retried at once.
 */
function acquireLock(lockPath: string): void {
  const deadline = Date.now() + LOCK_WAIT_MS
  let delay = LOCK_RETRY_INITIAL_MS
  for (;;) {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (takeOverExitedLock(lockPath)) continue
      if (Date.now() >= deadline) throw new Error(`global-queue: timed out waiting for the writer lock at ${lockPath}`)
      Atomics.wait(SLEEP_BUFFER, 0, 0, delay)
      delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
    }
  }
}

/** Remove the lock when its recorded holder exited; false when it is live or unproven. */
function takeOverExitedLock(lockPath: string): boolean {
  let record: string
  try {
    record = readFileSync(lockPath, 'utf8')
  } catch {
    // A lock that vanished between contention and the read proves nothing about a holder.
    return false
  }
  if (!/^\d+\n$/.test(record)) return false
  const pid = Number(record.trim())
  if (pid === 0 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
    rmSync(lockPath, { force: true })
    return true
  }
}

/** Commit the next array: exclusive-created random-suffix sibling at 0o600, renamed over the target. */
function commitItems(filePath: string, items: QueueItem[]): void {
  const temp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(items, undefined, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temp, filePath)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** The item with this id, throwing when absent. */
function requireItem(items: readonly QueueItem[], id: string): QueueItem {
  const item = items.find(candidate => candidate.id === id)
  if (item === undefined) throw new Error(`global-queue: unknown item id ${id}`)
  return item
}
