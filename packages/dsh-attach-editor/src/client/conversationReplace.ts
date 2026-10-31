/**
 * The save-replace composition as a pure module: the edited PNG becomes a new
 * draft image that is added to the draft, the edited attachment is removed,
 * and its draft is released. The conversation surface arrives as an injected
 * interface (`src/client/index.ts` wires it from structural service mirrors),
 * so this module imports nothing from dsh and the refusal rule stays unit-
 * testable against a recording stub.
 */
export interface ConversationActions {
  /** Register browser files as runtime draft attachments (image MIME → image draft). */
  createDrafts(sessionId: string, files: readonly File[]): readonly { readonly id: string }[]
  /** Add draft ids to the session draft; false while the composer refuses. */
  addAttachments(sessionId: string, ids: readonly string[]): boolean
  /** Remove one draft attachment; false when the id is not in the draft. */
  removeAttachment(sessionId: string, id: string): boolean
  /** Release one draft attachment (revokes its preview object URL). */
  releaseDraftAttachment(id: string): void
  /** The session's input phase, e.g. 'idle' | 'submitting' | 'adjudicating'. */
  phase(sessionId: string): string
}

export type ReplaceOutcome = 'applied' | 'blocked' | 'unavailable'

let wiredResolver: (() => ConversationActions | undefined) | undefined

/**
 * Install the conversation-surface resolver (or clear it). A resolver, not a
 * captured surface: the plugin activates before `conversation` is provided, so
 * every save re-reads the services instead of holding a stale capture.
 */
export function setConversationActions(next: (() => ConversationActions | undefined) | undefined): void {
  wiredResolver = next
}

export function conversationActions(): ConversationActions | undefined {
  return wiredResolver?.()
}

/**
 * Replace one draft attachment with re-exported bytes, honoring the composer's
 * refusal rule: while a send is in flight the draft must stay untouched.
 * @param surface - the conversation surface, undefined when unwired.
 * @param sessionId - the session the edit belongs to.
 * @param attachmentId - the attachment the editor was opened on.
 * @param blob - the exported PNG bytes.
 * @param fileName - the original attachment's name, kept on the new draft.
 * @returns whether the replacement landed, was refused, or was unavailable.
 */
export function replaceDraftAttachment(
  surface: ConversationActions | undefined,
  sessionId: string,
  attachmentId: string,
  blob: Blob,
  fileName: string,
): ReplaceOutcome {
  if (surface === undefined) return 'unavailable'
  // The composer facade refuses input changes while 'submitting' or
  // 'adjudicating'; refuse BEFORE creating a draft so no orphan draft is left
  // unreleased (the facade returns false instead of throwing).
  if (isLockedPhase(surface.phase(sessionId))) return 'blocked'
  const drafts = surface.createDrafts(sessionId, [new File([blob], fileName, { type: 'image/png' })])
  const draft = drafts[0]
  if (draft === undefined) return 'unavailable'
  if (!surface.addAttachments(sessionId, [draft.id])) {
    surface.releaseDraftAttachment(draft.id)
    return 'blocked'
  }
  // A false here means the old id already left the draft — nothing to release.
  // The phase cannot change inside this synchronous composition, so an add
  // that succeeded means the remove is not phase-blocked.
  if (surface.removeAttachment(sessionId, attachmentId)) surface.releaseDraftAttachment(attachmentId)
  return 'applied'
}

function isLockedPhase(phase: string): boolean {
  return phase === 'adjudicating' || phase === 'submitting'
}
