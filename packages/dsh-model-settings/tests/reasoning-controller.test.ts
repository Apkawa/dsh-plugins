import { describe, it, expect } from 'vitest'
import { ReasoningSectionController, type ReasoningRow, type ReasoningSectionState } from '../src/client/reasoning-controller.ts'

/** A level → wire-value mapping as the section edits it. */
type Efforts = { [level: string]: string | null }

/** One scripted RPC envelope. */
type Envelope = { ok: true; value: unknown } | { ok: false; error: { message: string } }

/** A delayed envelope, so tests can script out-of-order responses. */
function later(ms: number, envelope: Envelope): Promise<Envelope> {
  return new Promise(resolve => setTimeout(() => resolve(envelope), ms))
}

/** Minimal ConnectionHandle double: records calls and returns scripted envelopes. */
class FakeConnection {
  calls: Array<{ endpoint: string; payload: unknown }> = []
  constructor(private readonly next: (endpoint: string, payload: unknown) => Envelope | Promise<Envelope>) {}

  rpc = {
    call: async (_channel: string, endpoint: string, payload: unknown): Promise<Envelope> => {
      this.calls.push({ endpoint, payload })
      return this.next(endpoint, payload) as never
    },
  }
}

/** Minimal SnapshotStore double: applies the mutator to a plain state object. */
class FakeStore<T> {
  private state: T
  constructor(initial: T) {
    this.state = structuredClone(initial)
  }
  getSnapshot(): T {
    return this.state
  }
  update(mutator: (draft: T) => void): void {
    const draft = structuredClone(this.state)
    mutator(draft)
    this.state = draft
  }
}

const ROWS: ReasoningRow[] = [
  { routeId: 'urabe', modelId: 'Zed-Qwen3.8-27B', contextWindow: 80000, efforts: { low: 'low', high: 'high' } },
  { routeId: 'urabe', modelId: 'Other-Model' },
]

function makeController(next: FakeConnection['next']) {
  const conn = new FakeConnection(next)
  const store = new FakeStore<ReasoningSectionState>({ phase: 'loading', rows: [] })
  return { controller: new ReasoningSectionController(conn as never, store), conn, store }
}

describe('ReasoningSectionController', () => {
  it('loadRows pulls the listing and marks the section ready', async () => {
    const { controller } = makeController(() => ({ ok: true, value: ROWS }))
    await controller.loadRows()
    const snap = controller.store.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.rows).toEqual(ROWS)
  })

  it('loadRows surfaces an RPC failure as an error phase', async () => {
    const { controller } = makeController(() => ({ ok: false, error: { message: 'host said no' } }))
    await controller.loadRows()
    const snap = controller.store.getSnapshot()
    expect(snap.phase).toBe('error')
    expect(snap.error).toBe('host said no')
  })

  it('save posts saveModel with both parts and refreshes the listing', async () => {
    let saves = 0
    const { controller, conn } = makeController((endpoint) => {
      if (endpoint === 'saveModel') {
        saves++
        return { ok: true, value: null }
      }
      return { ok: true, value: ROWS } // the refresh listing
    })
    await controller.save('urabe', 'Other-Model', { medium: 'medium' }, 120000)
    expect(conn.calls.map(c => c.endpoint)).toEqual(['saveModel', 'listReasoningRows'])
    expect(saves).toBe(1)
    // the save payload carries routeId, modelId, efforts and the ctx part
    expect(conn.calls[0].payload).toEqual({ routeId: 'urabe', modelId: 'Other-Model', efforts: { medium: 'medium' }, contextWindow: 120000 })
  })

  it('save omits the ctx part when contextWindow is undefined', async () => {
    const { controller, conn } = makeController((endpoint) => (endpoint === 'saveModel' ? { ok: true, value: null } : { ok: true, value: ROWS }))
    await controller.save('urabe', 'Other-Model', { medium: 'medium' })
    expect(conn.calls.map(c => c.endpoint)).toEqual(['saveModel', 'listReasoningRows'])
    // no contextWindow key in the payload (an empty input means "unchanged")
    expect(conn.calls[0].payload).toEqual({ routeId: 'urabe', modelId: 'Other-Model', efforts: { medium: 'medium' } })
  })

  it('save omits the efforts part when efforts is undefined', async () => {
    const { controller, conn } = makeController((endpoint) => (endpoint === 'saveModel' ? { ok: true, value: null } : { ok: true, value: ROWS }))
    await controller.save('urabe', 'Other-Model', undefined, 120_000)
    expect(conn.calls.map(c => c.endpoint)).toEqual(['saveModel', 'listReasoningRows'])
    // no efforts key in the payload (no level selected means "unchanged", mirroring ctx)
    expect(conn.calls[0].payload).toStrictEqual({ routeId: 'urabe', modelId: 'Other-Model', contextWindow: 120_000 })
  })

  it('save posts an empty efforts mapping (the clear) without omitting it', async () => {
    const { controller, conn } = makeController((endpoint) => (endpoint === 'saveModel' ? { ok: true, value: null } : { ok: true, value: ROWS }))
    await controller.save('urabe', 'Other-Model', {})
    expect(conn.calls.map(c => c.endpoint)).toEqual(['saveModel', 'listReasoningRows'])
    // unlike undefined (untouched), the empty mapping is a deliberate clear and must reach the host
    expect(conn.calls[0].payload).toStrictEqual({ routeId: 'urabe', modelId: 'Other-Model', efforts: {} })
  })

  it('save posts a null contextWindow (the clear) without omitting it', async () => {
    const { controller, conn } = makeController((endpoint) => (endpoint === 'saveModel' ? { ok: true, value: null } : { ok: true, value: ROWS }))
    await controller.save('urabe', 'Other-Model', undefined, null)
    expect(conn.calls.map(c => c.endpoint)).toEqual(['saveModel', 'listReasoningRows'])
    // unlike undefined (untouched), null is a deliberate clear and must reach the host
    expect(conn.calls[0].payload).toStrictEqual({ routeId: 'urabe', modelId: 'Other-Model', contextWindow: null })
  })

  it('save throws on an RPC failure and preserves the listing', async () => {
    const { controller, store } = makeController((endpoint) => {
      if (endpoint === 'saveModel') return { ok: false, error: { message: 'conflict' } }
      return { ok: true, value: ROWS }
    })
    // seed the listing first so a failed save can preserve it
    await controller.loadRows()
    let threw = false
    try {
      await controller.save('urabe', 'Other-Model', { low: null })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    // rows are preserved (not cleared) after a failed save
    expect(store.getSnapshot().rows).toEqual(ROWS)
  })

  it('refreshContextWindow posts the endpoint and refreshes the listing', async () => {
    const { controller, conn } = makeController((endpoint) => {
      if (endpoint === 'refreshContextWindow') return { ok: true, value: { contextWindow: 123000 } }
      return { ok: true, value: ROWS }
    })
    await controller.refreshContextWindow('urabe', 'Other-Model')
    expect(conn.calls.map(c => c.endpoint)).toEqual(['refreshContextWindow', 'listReasoningRows'])
    expect(conn.calls[0].payload).toEqual({ routeId: 'urabe', modelId: 'Other-Model' })
  })

  it('refreshContextWindow throws on an RPC failure and preserves the listing', async () => {
    const { controller, store } = makeController((endpoint) => {
      if (endpoint === 'refreshContextWindow') return { ok: false, error: { message: 'model "Ghost" is not in the urabe listing' } }
      return { ok: true, value: ROWS }
    })
    await controller.loadRows()
    let threw = false
    try {
      await controller.refreshContextWindow('urabe', 'Ghost-Model')
    } catch (error) {
      threw = true
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Ghost')
    }
    expect(threw).toBe(true)
    expect(store.getSnapshot().rows).toEqual(ROWS)
  })

  it('refreshRows replaces the listing without a loading phase', async () => {
    let listing = ROWS
    const { controller, store } = makeController(() => ({ ok: true, value: listing }))
    await controller.loadRows()
    listing = [ROWS[1]] // an external model change landed in the section
    await controller.refreshRows()
    const snap = store.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.rows).toEqual([ROWS[1]])
  })

  it('refreshRows keeps the last listing and stays ready on an RPC failure', async () => {
    let down = false
    const { controller, store } = makeController(() => (down ? { ok: false, error: { message: 'host unreachable' } } : { ok: true, value: ROWS }))
    await controller.loadRows()
    down = true
    await controller.refreshRows()
    const snap = store.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.rows).toEqual(ROWS)
    expect(snap.error).toBeUndefined()
  })

  it('refreshRows settles a stuck loading phase when its RPC fails', async () => {
    // The section is still in its initial loading phase (the first list never settled);
    // a failed invalidation must not leave the UI on "Loading models…" forever.
    const { controller, store } = makeController(() => ({ ok: false, error: { message: 'host unreachable' } }))
    await controller.refreshRows()
    const snap = store.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.rows).toEqual([])
  })

  it('refreshRows ignores a stale response that lands after a newer list', async () => {
    const STALE: ReasoningRow[] = [{ routeId: 'urabe', modelId: 'Stale' }]
    const FRESH: ReasoningRow[] = [{ routeId: 'urabe', modelId: 'Fresh' }]
    let listing = 0
    const { controller, store } = makeController(() => {
      listing++
      if (listing === 1) return later(1, { ok: true, value: ROWS }) // the seed list
      if (listing === 2) return later(30, { ok: true, value: STALE }) // slow stale list
      return later(5, { ok: true, value: FRESH }) // fast newer list
    })
    await controller.loadRows()
    await Promise.all([controller.refreshRows(), controller.refreshRows()])
    expect(store.getSnapshot().rows).toEqual(FRESH)
  })
})
