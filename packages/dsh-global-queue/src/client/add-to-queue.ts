/**
 * The add control's target derivation: a blank session queues to a NEW
 * session (null target); a session with a conversation queues to ITSELF.
 * Extracted from the component so the derivation is unit-testable without a
 * DOM (the client half has no jsdom).
 */
export function resolveTarget(blank: boolean, sessionId: string): string | null {
  if (blank) return null
  return sessionId
}

/** One registered slot entry with an inject face, as the add flow reads it (structural mirror; only the hero agent-preset seat is consumed). */
interface AgentPresetEntry {
  inject(sessionId: string): {
    hooks: {
      agentPresetSeat: {
        getSnapshot(): { current: string }
      }
    }
  }
}

/** The slot registry face the add flow reads (structural mirror). */
export interface AgentPresetSlots {
  entriesOfSlot(key: string): readonly AgentPresetEntry[]
}

/**
 * The currently selected agent preset, read through the hero slot's seat
 * inject face (`conversation.hero.agentPreset`): the seat store's `current`
 * is the staged pick.
 * @param slots - the slot registry face.
 * @param sessionId - the session the composer belongs to.
 * @returns the selected preset id; `undefined` when the seat is not registered.
 */
export function resolveAgentPreset(slots: AgentPresetSlots, sessionId: string): string | undefined {
  const entry = slots.entriesOfSlot('conversation.hero.agentPreset')[0]
  if (entry === undefined) return undefined
  return entry.inject(sessionId).hooks.agentPresetSeat.getSnapshot().current
}

/**
 * The `add` RPC payload the add flow sends over the /global-queue channel:
 * the queued text, its workspace, the target session, and the currently
 * selected agent preset.
 */
export function buildAddPayload({
  text,
  workspacePath,
  targetSessionId,
  agentPreset,
}: {
  text: string
  workspacePath: string
  targetSessionId: string | null
  agentPreset: string | undefined
}) {
  return { text, workspacePath, targetSessionId, agentPreset }
}
