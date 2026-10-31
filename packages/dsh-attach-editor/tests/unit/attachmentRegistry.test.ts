import { describe, expect, it } from 'vitest'
import { forgetAttachment, lookup, rememberAttachment } from '../../src/client/attachmentRegistry.ts'

/** One runtime draft image, shaped as the composer rail passes it. */
function imageAttachment(id: string, content: string): {
  readonly kind: 'image'
  readonly id: string
  readonly file: File
  readonly previewUrl: string
} {
  return { kind: 'image', id, file: new File([content], `${id}.png`, { type: 'image/png' }), previewUrl: `blob:${id}` }
}

/**
 * The rail→pane bridge: the rail remembers what it renders, the pane resolves
 * an edited attachment's Blob from it. Images only — a file row is never a
 * candidate for the image editor.
 */
describe('attachmentRegistry: image entries', () => {
  it('remembers an image attachment and resolves it by id', async () => {
    rememberAttachment(imageAttachment('img-1', 'first bytes'))
    const entry = lookup('img-1')
    expect(entry).toBeDefined()
    expect(entry?.blob).toBeInstanceOf(File)
    expect(entry?.fileName).toBe('img-1.png')
    expect(await entry?.blob.text()).toBe('first bytes')
  })

  it('never remembers a file-kind attachment', () => {
    rememberAttachment({ kind: 'file', id: 'file-1', file: new File(['text'], 'notes.txt', { type: 'text/plain' }) })
    expect(lookup('file-1')).toBeUndefined()
  })

  it('replaces the entry when the rail re-renders the same id', async () => {
    rememberAttachment(imageAttachment('img-1', 'stale bytes'))
    rememberAttachment(imageAttachment('img-1', 'fresh bytes'))
    const entry = lookup('img-1')
    expect(entry?.previewUrl).toBe('blob:img-1')
    expect(await entry?.blob.text()).toBe('fresh bytes')
  })

  it('forgets an attachment the rail removed', () => {
    rememberAttachment(imageAttachment('img-1', 'bytes'))
    forgetAttachment('img-1')
    expect(lookup('img-1')).toBeUndefined()
  })

  it('resolves an unknown id to undefined', () => {
    expect(lookup('never-remembered')).toBeUndefined()
  })
})
