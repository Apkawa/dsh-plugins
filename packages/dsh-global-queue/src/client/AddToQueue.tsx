/**
 * The "Add to queue" composer control (browser half): a button in the
 * composer's right control area (`conversation.input.right`, session scope)
 * that queues the composer's draft through the /global-queue channel. The
 * target session is derived from the session's blank signal — a blank
 * session queues to a new session, a session with a conversation queues to
 * itself — so a single click adds without a target choice.
 *
 * Styled as the dense capsule of the settings-panel design language (h28,
 * 14px corners, 12/18 text, a `border-l3` hairline, the shared focus ring)
 * with a leading 16px plus drawn in the label ink; every color resolves
 * through a `--dsw-alias-*` token.
 */

import css from './add-to-queue.module.css'
import { callRpc, refresh } from './index.ts'
import { buildAddPayload, resolveAgentPreset, resolveTarget } from './add-to-queue.ts'
import type { AgentPresetSlots } from './add-to-queue.ts'

/** The standard session props the slot dispatcher hands the control (structural mirror: this package does not declare the dsh client packages as dependencies). */
interface AddToQueueProps {
  /** The session the composer belongs to. */
  sessionId: string
  /** Selector hook over the session input state (the draft text). */
  useInput: <S>(sel: (state: { draft: string }) => S) => S
  /** The stable input actions (setDraft replaces the whole draft). */
  inputActions: { setDraft(text: string): void }
  /** Selector hook over the workspace rows (path + session ids per workspace). */
  useWorkspaces: <S>(sel: (state: { items: readonly { path: string; sessionIds: readonly string[] }[] }) => S) => S
  /** Selector hook over the session snapshot (the blank bit: true until the first prompt is accepted). */
  useSession: <S>(sel: (state: { blank: boolean }) => S) => S
  /** The slot registry face (structural mirror); the add flow reads the selected agent preset through it. */
  slots: AgentPresetSlots
}

/** The "Add to queue" button; one click queues the draft for the context-derived target. */
export function AddToQueue(props: AddToQueueProps) {
  const draft = props.useInput(state => state.draft)
  const blank = props.useSession(state => state.blank)
  const workspacePath = props.useWorkspaces(state => state.items.find(workspace => workspace.sessionIds.includes(props.sessionId))?.path)

  // The Host's add rejects empty text, so an empty draft no-ops here too.
  const add = (): void => {
    const text = draft.trim()
    if (text === '' || workspacePath === undefined) return
    const payload = buildAddPayload({
      text,
      workspacePath,
      targetSessionId: resolveTarget(blank, props.sessionId),
      agentPreset: resolveAgentPreset(props.slots, props.sessionId),
    })
    void callRpc('add', payload).then(() => {
      props.inputActions.setDraft('')
      void refresh()
    })
  }

  return (
    <button type="button" className={css.capsule} data-testid="global-queue-add" onClick={add}>
      {/* The plus, in the label ink: the add gesture on the capsule. */}
      <svg className={css.icon} width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2V14" stroke="currentColor" strokeWidth={1} />
        <path d="M2 8H14" stroke="currentColor" strokeWidth={1} />
      </svg>
      Add to queue
    </button>
  )
}
