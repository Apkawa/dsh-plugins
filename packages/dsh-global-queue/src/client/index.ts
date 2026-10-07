/**
 * The global-queue plugin, browser half. It binds the shared queue snapshot
 * store to the Host's /global-queue RPC channel and registers the "Show queue"
 * right-sidebar tab: the tab type into `ctx.sidebarRightTabs`, the body under
 * the keyed `sidebar.right.pane.tab` seat, and the page opened for the
 * on-screen session. It also registers the "Add to queue" composer control
 * under the `conversation.input.right` seat (session scope).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { QueueItem } from '../queue/types.ts'
import { AddToQueue } from './AddToQueue.tsx'
import { QueuePane } from './QueuePane.tsx'

/** The logical RPC channel this plugin owns on the connection transport (the Host's /global-queue route). */
const CHANNEL = '/global-queue'

/** One RPC result the client unwraps (the dsh carrier's contract, as the Host's rpc.ts serves it). */
type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** The dsh client's connection handle, as this plugin consumes it (structural mirror: this package does not declare the dsh client packages as dependencies). */
interface ConnectionHandle {
  rpc: {
    call(channel: string, method: string, payload: unknown): Promise<RpcResult>
  }
}

/** One bare observable, as this plugin consumes it. */
interface Snapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One registered slot entry, as this plugin consumes it (structural mirror; only the hero agent-preset seat's inject face is read). */
interface StoredEntry {
  inject(sessionId: string): {
    hooks: {
      agentPresetSeat: {
        getSnapshot(): { current: string }
      }
    }
  }
}

/** The slot registry, as this plugin consumes it (structural mirror). */
interface SlotRegistryFace {
  register(options: unknown, component: unknown): () => void
  inject(key: string, callback: () => unknown): () => void
  entriesOfSlot(key: string): readonly StoredEntry[]
}

/** The right-sidebar navigation face, as this plugin consumes it (structural mirror). */
interface SidebarRightFace {
  readonly mounted: Snapshot<string | undefined>
  openTab(kind: string): void
}

/** One guide entry capsule the type contributes to the Start page (structural mirror of `SidebarRightGuideEntry`). */
interface GuideEntryFace {
  readonly id: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
  /** A product icon component; omitted, the guide draws its cube placeholder. */
  readonly icon?: (props: { readonly size?: number; readonly className?: string }) => unknown
}

/** The right-sidebar tab-type registry, as this plugin consumes it (structural mirror). */
interface SidebarRightTabsFace {
  register(definition: {
    readonly id: string
    readonly kind: string
    readonly title: (address: string) => string
    /** Entry capsules for the Start (guide) page; omission stays off it. */
    readonly guide?: readonly GuideEntryFace[]
  }): () => void
}

/** The dsh client's workspace navigation service (`uiWorkspace`, provided by ui-workspace), as this plugin consumes it (structural mirror: this package does not declare the dsh client packages as dependencies). */
interface UiWorkspaceFace {
  openSession(sessionId: string): void
}

/** The tab type's identity: the key its body registers under, and the kind it opens by. */
const TAB_ID = '@apkawa/dsh-global-queue'
const TAB_KIND = 'global-queue'

let connection: ConnectionHandle | undefined

/** One unary call over the plugin-owned channel, unwrapping the RPC result. */
export async function callRpc<T>(method: string, payload: unknown): Promise<T> {
  if (connection === undefined) throw new Error('global-queue client is not connected')
  const result = await connection.rpc.call(CHANNEL, method, payload)
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}

/** The shared queue snapshot; the tab body reads it through getItems/subscribe. */
const state: { items: QueueItem[] } = { items: [] }
const listeners = new Set<(items: QueueItem[]) => void>()

/** Subscribe to queue updates; returns the unsubscribe. */
export function subscribe(listener: (items: QueueItem[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current queue items. */
export function getItems(): QueueItem[] {
  return state.items
}

/** Re-list the queue from the Host and publish it to the subscribers. */
export async function refresh(): Promise<void> {
  const result = await callRpc<{ items: QueueItem[] }>('list', {})
  state.items = result.items
  listeners.forEach(listener => listener(result.items))
}

/** The cordis services this plugin's apply reads. */
export const inject = ['connection', 'slots', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace']

/**
 * Bind the shared store to the connection and register the "Show queue" tab.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  connection = ctx.get('connection') as ConnectionHandle
  const slots = ctx.get('slots') as SlotRegistryFace
  const sidebarRight = ctx.get('sidebarRight') as SidebarRightFace
  const sidebarRightTabs = ctx.get('sidebarRightTabs') as SidebarRightTabsFace
  const uiWorkspace = ctx.get('uiWorkspace') as UiWorkspaceFace

  // Stage one: the tab type — identity, kind, the chip title, and the
  // Start-page entry capsule (picking it opens the queue page; no icon,
  // the guide draws its cube placeholder in its place).
  ctx.effect(() => sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => 'Show queue',
    guide: [{
      id: 'show-queue',
      order: 40,
      title: () => 'Show queue',
      description: () => 'The prompts queued for this workspace',
    }],
  }), 'global-queue: tab type')

  // Stage two: the body under the definition's id; the open-session link
  // posts through the ui-workspace navigation service.
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    inject: () => ({ openSession: (sessionId: string) => uiWorkspace.openSession(sessionId) }),
  }, QueuePane)), 'global-queue: tab body')

  // Stage three: the "Add to queue" control in the composer's right control
  // area; the session-scope slot dispatcher hands it the session id, the
  // input hook, the input actions, and the workspace list hook.
  ctx.effect(() => slots.inject('conversation.input.right', () => slots.register({
    name: 'conversation.input.right',
    id: 'global-queue-add',
    order: 10,
    inject: () => ({ slots }),
  }, AddToQueue)), 'global-queue: add control')

  // Open the page for the on-screen session. The session's surface is adopted
  // during the render the `mounted` change precedes, so retry until the
  // adoption lands; a session switch or unmount cancels the pending retries.
  ctx.effect(() => {
    let pending: string | undefined
    const open = (sessionId: string): void => {
      if (pending !== sessionId) return
      try {
        sidebarRight.openTab(TAB_KIND)
      } catch {
        setTimeout(() => open(sessionId), 0)
      }
    }
    const sync = (): void => {
      pending = sidebarRight.mounted.getSnapshot()
      if (pending === undefined) return
      open(pending)
    }
    const unsubscribe = sidebarRight.mounted.subscribe(sync)
    sync()
    return unsubscribe
  }, 'global-queue: open the page')

  void refresh()
}
