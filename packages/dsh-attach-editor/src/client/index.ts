/**
 * The attach-editor plugin, browser half. It registers the "Annotate image"
 * right-sidebar tab: the tab type into `ctx.sidebarRightTabs` (with its Start-
 * page entry capsule), the editor body under the keyed `sidebar.right.pane.tab`
 * seat, keyed by this plugin's id, and the attachment rail into the composer's
 * `conversation.input.attachments` seat at priority -1 (shadowing the shipped
 * rail). An image thumbnail's Edit opens the tab through `sidebarRight.openTab`,
 * retried until the session surface is adopted. The rail remembers what it
 * renders in `attachmentRegistry`; the pane resolves the edited Blob there and,
 * on save, replaces the draft attachment through the conversation surface wired
 * from `ctx.get('conversation')` + `ctx.get('sessions')` structural mirrors.
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachEditorPane } from './AttachEditorPane.tsx'
import { AttachmentsRail } from './AttachmentsRail.tsx'
import type { AttachmentsRailProps } from './AttachmentsRail.tsx'
import { beginEdit, planOpenAttempt } from './editSession.ts'
import { setConversationActions } from './conversationReplace.ts'
import type { ConversationActions } from './conversationReplace.ts'

/** One bare observable, as this plugin consumes it. */
interface Snapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** The slot registry, as this plugin consumes it (structural mirror). */
interface SlotRegistryFace {
  register(options: unknown, component: unknown): () => void
  inject(key: string, callback: () => unknown): () => void
}

/** The right sidebar as a whole (structural mirror): the mounted session and the programmatic tab open. */
interface SidebarRightFace {
  /** The session whose surface the sidebar has mounted; undefined before adoption. */
  readonly mounted: Snapshot<string | undefined>
  /** Opens a tab by kind; throws while the mounted session's surface is not adopted yet. */
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

/** The session's input shell, as the save-replace consumes it (structural mirror). */
interface InputShellFace {
  /** Adds draft ids to the draft; false while the composer refuses. */
  addAttachments(ids: readonly string[]): boolean
  /** Removes one draft attachment; false when the id is not in the draft. */
  removeAttachment(id: string): boolean
  /** Public snapshot; `phase` is 'idle' | 'submitting' | 'adjudicating' … */
  readonly snapshot: { readonly phase: string }
}

/** The conversation service, as this plugin consumes it (structural mirror). */
interface ConversationFace {
  createDrafts(sessionId: string, files: readonly File[]): readonly { readonly id: string }[]
  releaseDraftAttachment(id: string): void
  /** The input hub; `shell(id)` is the public id-addressed path. */
  input: { shell(sessionId: string): InputShellFace }
}

/** The session registry, as this plugin consumes it (structural mirror). */
interface SessionsFace {
  /** Whether this session id resolves a binding right now. */
  binding(sessionId: string): unknown
}

/** The tab type's identity: the key its body registers under, and the kind it opens by. */
const TAB_ID = '@apkawa/dsh-attach-editor'
const TAB_KIND = 'attach-editor'

/** The cordis services this plugin's apply reads. */
export const inject = ['connection', 'slots', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace']

/**
 * Register the "Annotate image" tab.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as SlotRegistryFace
  const sidebarRight = ctx.get('sidebarRight') as SidebarRightFace
  const sidebarRightTabs = ctx.get('sidebarRightTabs') as SidebarRightTabsFace

  // The conversation action surface for save-replace. `ctx.get('conversation')`
  // is the seam ui-conversation itself uses (`apply.ts`: "const
  // concreteConversation = ctx.get('conversation') as ConversationController |
  // undefined"), and `ctx.get('sessions')` resolves the session registry
  // (`api/session-controller/src/client/sessions/service.ts`:
  // "rootCtx.reflect.provide('sessions', this, undefined)"). Per-session input
  // access goes through the hub's public id-addressed path
  // ("Resident shell by session id (service-face path … covers direct
  // id-addressed access)"), which THROWS when the binding is gone, so
  // `sessions.binding(id)` guards it first. The mirror is resolved per save,
  // not captured at apply: this plugin activates before ui-conversation
  // provides `conversation`, so a capture would stay undefined forever.
  ctx.effect(() => {
    setConversationActions(() => conversationActionsFor(ctx.get('conversation') as ConversationFace | undefined, ctx.get('sessions') as SessionsFace | undefined))
    return () => { setConversationActions(undefined) }
  }, 'attach-editor: save-replace actions')

  // The edit-open attempt: opening the tab programmatically throws until the
  // mounted session's surface is adopted, so `planOpenAttempt` decides open /
  // retry / skip and every mounted change re-attempts the pending session.
  let desiredSession: string | undefined
  const attempt = (): void => {
    if (desiredSession === undefined) return
    const mounted = sidebarRight.mounted.getSnapshot()
    const plan = planOpenAttempt(mounted, mounted === desiredSession)
    if (plan === 'skip') return
    if (plan === 'retry') {
      setTimeout(() => attempt(), 0)
      return
    }
    try {
      sidebarRight.openTab(TAB_KIND)
    } catch {
      // openTab refuses while the sidebar surface is mid-adoption; retry next tick.
      setTimeout(() => attempt(), 0)
    }
  }
  ctx.effect(() => sidebarRight.mounted.subscribe(() => attempt()), 'attach-editor: edit open attempt')

  // The tab type — identity, kind, chip title, and the Start-page entry
  // capsule (picking it opens this tab; no icon, the guide draws its cube
  // placeholder in its place).
  ctx.effect(() => sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => 'Annotate image',
    guide: [{
      id: 'attach-editor',
      order: 45,
      title: () => 'Annotate image',
      description: () => 'Draw on an attachment before it is sent',
    }],
  }), 'attach-editor: tab type')

  // The attachment rail as the composer's occupant: the seat
  // `conversation.input.attachments` ships `ComposerAttachments` at priority 0
  // and marks it `shadows-shipped-ui`, so we register at priority -1 (lowest
  // live entry renders). The seat is declared by ui-conversation, so the
  // registration waits through `slots.inject`; the wrapper threads the edit
  // callback the owner props do not carry.
  const railComponent = (props: AttachmentsRailProps) => AttachmentsRail({
    ...props,
    onEditImage: (attachmentId: string) => {
      if (props.sessionId === undefined) return
      beginEdit(props.sessionId, attachmentId, Date.now())
      desiredSession = props.sessionId
      attempt()
    },
  })
  ctx.effect(() => slots.inject('conversation.input.attachments', () => slots.register({
    name: 'conversation.input.attachments',
    priority: -1,
  }, railComponent)), 'attach-editor: rail')

  // The body under the definition's id. The seat is session-scoped and keyed;
  // the tab facts (id, title, active, store) arrive through the framework's
  // tabInfo hook, so the inject face stays empty until the rail needs a link.
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    inject: () => ({}),
  }, AttachEditorPane)), 'attach-editor: tab body')
}

/**
 * Build the conversation surface from the mirrors, or report it unavailable.
 * The composition mirrors the composer wrapper verbatim
 * (`ui-conversation/src/client/apply.ts`): a successful intake runs
 * `conversation.createDrafts(sessionId, uploads)` then
 * "if (!shell.addFiles(references, drafts.map(d => d.id)))
 * conversation.releaseDraftAttachments(drafts)", and removal runs
 * "if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id)".
 * The refusal rule is the facade guard (`ui-conversation/src/client/input/facade.ts`):
 * "if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase ===
 * 'submitting') return false" — a boolean refusal, not a throw, so the pane
 * shows its blocked state instead of corrupting the draft.
 * @param conversation - the conversation service mirror, absent on a bare host.
 * @param sessions - the session registry mirror, absent on a bare host.
 */
function conversationActionsFor(
  conversation: ConversationFace | undefined,
  sessions: SessionsFace | undefined,
): ConversationActions | undefined {
  if (conversation === undefined || sessions === undefined) return undefined
  // The public `input.shell(id)` throws when the id resolves no binding, so
  // the binding check comes first; a missing shell behaves as a refusal.
  const shellFor = (sessionId: string): InputShellFace | undefined => {
    if (sessions.binding(sessionId) === undefined) return undefined
    return conversation.input.shell(sessionId)
  }
  return {
    // An unbound session yields no drafts, so the throwing shell path is never reached.
    createDrafts: (sessionId, files) => sessions.binding(sessionId) === undefined ? [] : conversation.createDrafts(sessionId, files),
    addAttachments: (sessionId, ids) => shellFor(sessionId)?.addAttachments(ids) ?? false,
    removeAttachment: (sessionId, id) => shellFor(sessionId)?.removeAttachment(id) ?? false,
    releaseDraftAttachment: (id) => { conversation.releaseDraftAttachment(id) },
    phase: (sessionId) => shellFor(sessionId)?.snapshot.phase ?? 'idle',
  }
}
