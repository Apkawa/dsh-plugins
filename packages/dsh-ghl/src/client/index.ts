/**
 * The ghl plugin, browser half. It binds the shared issue snapshot store to
 * the Host's /ghl RPC channel and registers the "Issues" right-sidebar tab:
 * the tab type into `ctx.sidebarRightTabs` and the body under the keyed
 * `sidebar.right.pane.tab` seat.
 */

import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Issue, RepoRef } from '../issues.ts'
import { IssuePane } from './IssuePane.tsx'

/** The logical RPC channel this plugin owns on the connection transport (the Host's /ghl route). */
const CHANNEL = '/ghl'

/** One RPC result the client unwraps (the dsh carrier's contract, as the Host's rpc.ts serves it). */
type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** A typed RPC failure: the carrier's code, message, and details. */
export class RpcError extends Error {
  readonly code: string
  readonly details: unknown

  constructor(message: string, code: string, details: unknown) {
    super(message)
    this.code = code
    this.details = details
  }
}

/** The dsh client's connection handle, as this plugin consumes it (structural mirror: this package does not declare the dsh client packages as dependencies). */
interface ConnectionHandle {
  rpc: {
    call(channel: string, method: string, payload: unknown): Promise<RpcResult>
  }
}

/** The slot registry, as this plugin consumes it (structural mirror). */
interface SlotRegistryFace {
  register(options: unknown, component: unknown): () => void
  inject(key: string, callback: () => unknown): () => void
}

/** The right-sidebar navigation face, as this plugin consumes it (structural mirror; read in the later workspace-view stage). */
interface SidebarRightFace {
  readonly mounted: {
    getSnapshot(): string | undefined
    subscribe(listener: () => void): () => void
  }
  openTab(kind: string): void
}

/** One guide-page entry capsule, as this plugin consumes it (structural mirror). */
interface GuideEntryFace {
  readonly id: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
}

/** The right-sidebar tab-type registry, as this plugin consumes it (structural mirror). */
interface SidebarRightTabsFace {
  register(definition: {
    readonly id: string
    readonly kind: string
    readonly title: (address: string) => string
    readonly guide?: readonly GuideEntryFace[]
  }): () => void
}

/** The workspace rows the pane's selector reads (structural mirror of the Host's `WorkspaceView` list). */
type WorkspaceListState = { items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[] }

/** The dsh client's workspace list service (`workspaces`, provided by ui-workspace), as this plugin consumes it (structural mirror: this package does not declare the dsh client packages as dependencies). */
interface WorkspacesFace {
  list: {
    getSnapshot(): WorkspaceListState
    subscribe(listener: () => void): () => void
  }
}

/** The tab type's identity: the key its body registers under, and the kind it opens by. */
const TAB_ID = '@apkawa/dsh-ghl'
const TAB_KIND = 'ghl'

let connection: ConnectionHandle | undefined

/** One unary call over the plugin-owned channel, unwrapping the RPC result. */
export async function callRpc<T>(method: string, payload: unknown): Promise<T> {
  if (connection === undefined) throw new Error('ghl client is not connected')
  const result = await connection.rpc.call(CHANNEL, method, payload)
  if (!result.ok) throw new RpcError(result.error.message, result.error.code, result.error.details)
  return result.value as T
}

/** One RPC call the store issues: the method name and payload, the unwrapped value back. */
type RpcCall = (method: string, payload: unknown) => Promise<unknown>

/** The store's RPC seam; the default rides the live channel, the unit tests point it at a fake. */
let rpc: RpcCall = (method, payload) => callRpc(method, payload)

/** Point the store's RPC seam at a call (the unit tests' fake). */
export function setRpc(call: RpcCall): void {
  rpc = call
}

/** The shared issue snapshot: the detected repo, its issues, the selected one, the last RPC failure, and the in-flight flags. */
const state: { repo: RepoRef | null; issues: Issue[]; selected: Issue | null; error: { code: string; message: string } | null; listLoading: boolean; issueLoading: boolean } = { repo: null, issues: [], selected: null, error: null, listLoading: false, issueLoading: false }
const listeners = new Set<() => void>()

/** Subscribe to snapshot updates; returns the unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The detected repository, or null when the workspace has none. */
export function getRepo(): RepoRef | null {
  return state.repo
}

/** The current issue list. */
export function getIssues(): Issue[] {
  return state.issues
}

/** The selected issue, or null while the list view is shown. */
export function getSelected(): Issue | null {
  return state.selected
}

/** The last RPC failure's code and message, or null while the snapshot is healthy. */
export function getError(): { code: string; message: string } | null {
  return state.error
}

/** True while a refresh (detection or list) RPC is in flight. */
export function getListLoading(): boolean {
  return state.listLoading
}

/** True while the getIssue RPC for a selection is in flight. */
export function getIssueLoading(): boolean {
  return state.issueLoading
}

/** The `workspacePath` key for an RPC payload, present only for a non-empty path (the Host falls back to its workspace registry otherwise). */
function workspacePayload(workspacePath: string | undefined): { workspacePath?: string } {
  if (typeof workspacePath === 'string' && workspacePath.length > 0) return { workspacePath }
  return {}
}

/** Re-detect the repo and re-list its issues from the Host, then publish. With `force` the list call clears the Host's cache first. */
export async function refresh(workspacePath?: string, force?: boolean): Promise<void> {
  state.listLoading = true
  publish()
  const payload = workspacePayload(workspacePath)
  let detected: { repo: RepoRef | null }
  try {
    detected = (await rpc('detectRepo', payload)) as { repo: RepoRef | null }
  } catch (err) {
    // A detection failure leaves no repo to list; record it and resolve.
    state.repo = null
    state.issues = []
    state.error = asRpcError(err)
    state.listLoading = false
    publish()
    return
  }
  state.repo = detected.repo
  // With no repo the Host's listIssues answers a detection failure, so skip it.
  if (detected.repo === null) {
    state.issues = []
    state.error = null
    state.listLoading = false
    publish()
    return
  }
  let listed: { issues: Issue[] }
  try {
    listed = (await rpc('listIssues', force === true ? { ...payload, force: true } : payload)) as { issues: Issue[] }
  } catch (err) {
    // A list failure keeps the detected repo but shows no issues.
    state.issues = []
    state.error = asRpcError(err)
    state.listLoading = false
    publish()
    return
  }
  state.issues = listed.issues
  state.error = null
  state.listLoading = false
  publish()
}

/** Fetch one issue by number, set it as the selected one, and publish. */
export async function select(number: number, workspacePath?: string): Promise<void> {
  state.issueLoading = true
  publish()
  let fetched: { issue: Issue }
  try {
    fetched = (await rpc('getIssue', { number, ...workspacePayload(workspacePath) })) as { issue: Issue }
  } catch (err) {
    // A selection failure keeps the previous selection.
    state.error = asRpcError(err)
    state.issueLoading = false
    publish()
    return
  }
  state.selected = fetched.issue
  state.error = null
  state.issueLoading = false
  publish()
}

/** Clear the selected issue (back to the list) and publish. */
export function back(): void {
  state.selected = null
  publish()
}

/**
 * Read the failure envelope off a thrown RPC error — the typed `RpcError` in
 * production, a structural double (an `Error` carrying `code`) in the tests.
 * Anything that is not an RPC failure lands on `internal`.
 */
function asRpcError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return { code, message: err.message }
  }
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) }
}

/** Publish the snapshot to the subscribers. */
function publish(): void {
  listeners.forEach(listener => listener())
}

/** The cordis services this plugin's apply reads. */
export const inject = ['connection', 'slots', 'sidebarRight', 'sidebarRightTabs', 'workspaces']

/**
 * Bind the store to the connection and register the "Issues" tab.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  connection = ctx.get('connection') as ConnectionHandle
  const slots = ctx.get('slots') as SlotRegistryFace
  // sidebarRight is injected for the later workspace-view stage.
  const sidebarRightTabs = ctx.get('sidebarRightTabs') as SidebarRightTabsFace
  const workspaces = ctx.get('workspaces') as WorkspacesFace

  // The pane derives its workspace path from the session's workspace row: a
  // selector hook over the `workspaces` list, handed to the body through the
  // seat's inject face (the seat also binds `sessionId` for the session scope).
  const useWorkspaces = <S>(selector: (state: WorkspaceListState) => S): S =>
    useSyncExternalStore(
      (onChange: () => void) => workspaces.list.subscribe(onChange),
      () => selector(workspaces.list.getSnapshot()),
    )

  // Stage one: the tab type — identity, kind, the chip title, and the guide
  // entry that opens it from the Start page (without a guide entry the type has
  // no entry box there and its chip never appears in the strip).
  ctx.effect(() => sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => 'Issues',
    guide: [{
      id: TAB_KIND,
      order: 0,
      title: () => 'Issues',
    }],
  }), 'ghl: tab type')

  // Stage two: the body under the definition's id; the workspace-path selector
  // hook posts through the ui-workspace list service.
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    inject: () => ({ useWorkspaces }),
  }, IssuePane)), 'ghl: tab body')

  void refresh()
}
