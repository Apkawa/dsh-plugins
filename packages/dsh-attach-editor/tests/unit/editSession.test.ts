import { describe, expect, it } from 'vitest'
import { activeEdit, beginEdit, endEdit, planOpenAttempt, subscribeEdit } from '../../src/client/editSession.ts'
import type { EditSession } from '../../src/client/editSession.ts'

/**
 * The pure edit-session module (no DOM, no React): the active edit session and
 * the open-attempt rule the tab-opening effect will consume in a later stage.
 */
describe('editSession: active edit state', () => {
  it('beginEdit records the session, the attachment, and the open time', () => {
    beginEdit('session-1', 'attachment-1', 1000)
    expect(activeEdit()).toEqual({ sessionId: 'session-1', attachmentId: 'attachment-1', openedAt: 1000 })
  })

  it('beginEdit replaces a previous active edit (editing a second attachment wins)', () => {
    beginEdit('session-1', 'attachment-1', 1000)
    beginEdit('session-2', 'attachment-2', 2000)
    expect(activeEdit()).toEqual({ sessionId: 'session-2', attachmentId: 'attachment-2', openedAt: 2000 })
  })

  it('endEdit clears the active edit', () => {
    beginEdit('session-1', 'attachment-1', 1000)
    endEdit()
    expect(activeEdit()).toBeUndefined()
  })
})

describe('editSession: open-attempt plan', () => {
  it('skips when no session surface is mounted, adopted or not', () => {
    expect(planOpenAttempt(undefined, true)).toBe('skip')
    expect(planOpenAttempt(undefined, false)).toBe('skip')
  })

  it('opens when the mounted session has adopted its surface', () => {
    expect(planOpenAttempt('session-1', true)).toBe('open')
  })

  it('retries while the mounted session has not adopted its surface yet', () => {
    expect(planOpenAttempt('session-1', false)).toBe('retry')
  })
})

describe('editSession: subscribers', () => {
  it('notifies a subscriber with the edit on begin and with undefined on end', () => {
    const seen: (EditSession | undefined)[] = []
    const off = subscribeEdit(edit => { seen.push(edit) })
    beginEdit('session-1', 'attachment-1', 1000)
    endEdit()
    expect(seen).toEqual([{ sessionId: 'session-1', attachmentId: 'attachment-1', openedAt: 1000 }, undefined])
    off()
    beginEdit('session-2', 'attachment-2', 3000)
    expect(seen.length).toBe(2)
    endEdit()
  })

  it('a late subscriber sees the next begin after an earlier one unsubscribed', () => {
    const off = subscribeEdit(() => {})
    off()
    const late: (EditSession | undefined)[] = []
    subscribeEdit(edit => { late.push(edit) })
    beginEdit('session-3', 'attachment-3', 4000)
    expect(late).toEqual([{ sessionId: 'session-3', attachmentId: 'attachment-3', openedAt: 4000 }])
    endEdit()
  })
})
