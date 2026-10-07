import { describe, expect, it } from 'vitest'
import { buildAddPayload, resolveAgentPreset, resolveTarget } from '../../../src/client/add-to-queue.ts'

/**
 * The add control's target derivation, extracted from the component so it is
 * unit-testable without a DOM: a blank session queues to a NEW session (null);
 * a session with a conversation queues to ITSELF.
 */
describe('resolveTarget', () => {
  it('targets a new session from a blank session (null)', () => {
    expect(resolveTarget(true, 'session-1')).toBeNull()
  })

  it('targets the on-screen session from a non-blank session', () => {
    expect(resolveTarget(false, 'session-1')).toBe('session-1')
  })
})

/**
 * The currently selected agent preset, read through the hero slot's seat
 * inject face (`conversation.hero.agentPreset`): the seat store's `current`
 * is the staged pick. Extracted from the component so the read is
 * unit-testable without a DOM.
 */
describe('resolveAgentPreset', () => {
  const slotsWithPreset = (current: string, seen: (sessionId?: string) => void) => ({
    entriesOfSlot: (key: string) => key === 'conversation.hero.agentPreset'
      ? [{
        inject: (sessionId?: string) => {
          seen(sessionId)
          return { hooks: { agentPresetSeat: { getSnapshot: () => ({ current }) } } }
        },
      }]
      : [],
  })

  it('reads the selected preset id from the conversation.hero.agentPreset seat', () => {
    expect(resolveAgentPreset(slotsWithPreset('standard', () => {}), 'session-1')).toBe('standard')
  })

  it('passes the session id to the seat inject face', () => {
    let seen: string | undefined
    resolveAgentPreset(slotsWithPreset('standard', sessionId => {
      seen = sessionId
    }), 'session-1')
    expect(seen).toBe('session-1')
  })

  it('returns undefined when the seat is not registered', () => {
    expect(resolveAgentPreset({ entriesOfSlot: () => [] }, 'session-1')).toBeUndefined()
  })
})

/**
 * The add payload the Add-to-queue flow sends over the /global-queue
 * channel: the queued text, its workspace, the target session, and the
 * currently selected agent preset.
 */
describe('buildAddPayload', () => {
  it('carries the selected preset id in the add payload', () => {
    expect(buildAddPayload({
      text: 'hello',
      workspacePath: '/ws',
      targetSessionId: null,
      agentPreset: 'standard',
    })).toEqual({
      text: 'hello',
      workspacePath: '/ws',
      targetSessionId: null,
      agentPreset: 'standard',
    })
  })

  it('keeps the session target and the other fields intact', () => {
    expect(buildAddPayload({
      text: 'again',
      workspacePath: '/ws/two',
      targetSessionId: 'session-2',
      agentPreset: 'minimal',
    })).toEqual({
      text: 'again',
      workspacePath: '/ws/two',
      targetSessionId: 'session-2',
      agentPreset: 'minimal',
    })
  })
})
