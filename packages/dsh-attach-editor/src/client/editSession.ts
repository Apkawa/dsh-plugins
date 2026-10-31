/**
 * The edit-session state for the attach-editor tab, as a pure module (no DOM,
 * no React) so the open-attempt rule is unit-testable. A later stage writes it
 * from the attachment rail and reads it from the editor tab body.
 */
export interface EditSession {
  readonly sessionId: string
  readonly attachmentId: string
  readonly openedAt: number
}

let active: EditSession | undefined

const listeners = new Set<(edit: EditSession | undefined) => void>()

/** Record the edit session; a second attachment replaces the first. */
export function beginEdit(sessionId: string, attachmentId: string, openedAt: number): EditSession {
  active = { sessionId, attachmentId, openedAt }
  listeners.forEach(listener => listener(active))
  return active
}

/** Clear the active edit (the editor closed, saved, or cancelled). */
export function endEdit(): void {
  active = undefined
  listeners.forEach(listener => listener(undefined))
}

export function activeEdit(): EditSession | undefined {
  return active
}

/** Watch the active edit; the tab body re-renders on every change. */
export function subscribeEdit(listener: (edit: EditSession | undefined) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Whether an open-tab attempt should run now: `skip` while no session surface
 * is mounted, `retry` while the mounted session has not adopted its surface yet
 * (the sidebar's programmatic open throws until adoption), `open` once adopted.
 */
export function planOpenAttempt(mountedSessionId: string | undefined, adopted: boolean): 'open' | 'retry' | 'skip' {
  if (mountedSessionId === undefined) return 'skip'
  if (adopted) return 'open'
  return 'retry'
}
