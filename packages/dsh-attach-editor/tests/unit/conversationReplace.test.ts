import { describe, expect, it } from 'vitest'
import { replaceDraftAttachment } from '../../src/client/conversationReplace.ts'
import type { ConversationActions } from '../../src/client/conversationReplace.ts'

/** The conversation surface as a recording stub (an injected interface, not a mock of globals). */
function actionsStub(opts: {
  readonly phase?: string
  readonly addOk?: boolean
  readonly removeOk?: boolean
}): ConversationActions & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    createDrafts: (sessionId, files) => {
      calls.push(`createDrafts:${sessionId}:${files.length}:${files[0]?.type ?? ''}`)
      return [{ id: 'draft-new' }]
    },
    addAttachments: (sessionId, ids) => {
      calls.push(`add:${sessionId}:${ids.join(',')}`)
      return opts.addOk ?? true
    },
    removeAttachment: (sessionId, id) => {
      calls.push(`remove:${sessionId}:${id}`)
      return opts.removeOk ?? true
    },
    releaseDraftAttachment: (id) => { calls.push(`release:${id}`) },
    phase: (sessionId) => {
      calls.push(`phase:${sessionId}`)
      return opts.phase ?? 'idle'
    },
  }
}

/**
 * The save-replace composition: the edited bytes become a new draft image that
 * is added, the old attachment is removed, and the old draft is released. A
 * composer refusal must leave the draft untouched and release nothing stale.
 */
describe('conversationReplace: save-replace composition', () => {
  it('reports unavailable when the conversation actions are missing', () => {
    expect(replaceDraftAttachment(undefined, 'session-1', 'old-1', new Blob(['x'], { type: 'image/png' }), 'a.png')).toBe('unavailable')
  })

  it('blocks while submitting without creating a draft', () => {
    const actions = actionsStub({ phase: 'submitting' })
    expect(replaceDraftAttachment(actions, 'session-1', 'old-1', new Blob(['x'], { type: 'image/png' }), 'a.png')).toBe('blocked')
    expect(actions.calls).toEqual(['phase:session-1'])
  })

  it('blocks while adjudicating without creating a draft', () => {
    const actions = actionsStub({ phase: 'adjudicating' })
    expect(replaceDraftAttachment(actions, 'session-1', 'old-1', new Blob(['x'], { type: 'image/png' }), 'a.png')).toBe('blocked')
    expect(actions.calls).toEqual(['phase:session-1'])
  })

  it('applies the replacement in the add → remove → release order', () => {
    const actions = actionsStub({})
    expect(replaceDraftAttachment(actions, 'session-1', 'old-1', new Blob(['png-bytes'], { type: 'image/png' }), 'a.png')).toBe('applied')
    expect(actions.calls).toEqual([
      'phase:session-1',
      'createDrafts:session-1:1:image/png',
      'add:session-1:draft-new',
      'remove:session-1:old-1',
      'release:old-1',
    ])
  })

  it('releases the new draft and keeps the old attachment when the add refuses', () => {
    const actions = actionsStub({ addOk: false })
    expect(replaceDraftAttachment(actions, 'session-1', 'old-1', new Blob(['x'], { type: 'image/png' }), 'a.png')).toBe('blocked')
    expect(actions.calls).toEqual(['phase:session-1', 'createDrafts:session-1:1:image/png', 'add:session-1:draft-new', 'release:draft-new'])
  })

  it('applies when the old id is already gone (nothing left to release)', () => {
    const actions = actionsStub({ removeOk: false })
    expect(replaceDraftAttachment(actions, 'session-1', 'old-1', new Blob(['x'], { type: 'image/png' }), 'a.png')).toBe('applied')
    expect(actions.calls).toEqual(['phase:session-1', 'createDrafts:session-1:1:image/png', 'add:session-1:draft-new', 'remove:session-1:old-1'])
  })
})
