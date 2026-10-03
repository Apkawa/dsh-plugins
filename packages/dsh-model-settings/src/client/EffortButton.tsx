/**
 * The composer effort button (browser half): a quick-access control in
 * `conversation.input.right` (just left of the model seat) that switches the
 * current model's reasoning effort without opening the full ModelSelect menu.
 * It reads the session's shared model directory through the inject `hooks`
 * compartment (bound to `useDirectory`) and submits through it, so host stays
 * the single fact source — no subscription machinery in this component.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { currentReasoning, effortChoices, effortLabel, type DirectoryState, type EffortChoice, type Selection } from './effort-button.ts'

/** The inject face: the shared directory (bound to `useDirectory`) + load/select verbs. */
export interface EffortButtonFace {
  hooks: { directory: SnapshotStore<DirectoryState> }
  load(): void
  select(selection: Selection): Promise<boolean>
}

/** The composed props the slot dispatcher hands the button. */
type ButtonProps = InjectFace<EffortButtonFace>

export function EffortButton(props: ButtonProps) {
  const state = props.useDirectory(snapshot => snapshot)
  const [open, setOpen] = useState(false)

  // Populate on mount so the button is functional even before the model seat loads.
  useEffect(() => {
    props.load()
  }, [])

  const current = state.current
  const reasoning = currentReasoning(state)
  if (current === null || reasoning === undefined) return null

  const label = effortLabel(reasoning, current) ?? 'Thinking'
  const choices = effortChoices(reasoning)

  function pick(choice: EffortChoice): void {
    setOpen(false)
    if (state.current === null) return
    // Keep provider + model; change only the effort. `effort: undefined` clears it
    // (the host then falls back to the model's default / "provider default").
    const selection: Selection = { provider: state.current.provider, model: state.current.model }
    if (choice.effort !== undefined) selection.reasoningEffort = choice.effort
    void props.select(selection)
  }

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <span role="menu" className="absolute">
          {choices.map(choice => (
            <button key={choice.key} type="button" role="menuitem" onClick={() => pick(choice)}>
              {choice.label}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
