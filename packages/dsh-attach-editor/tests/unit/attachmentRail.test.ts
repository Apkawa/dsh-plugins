import { describe, expect, it } from 'vitest'
import {
  closePreview,
  dropOverlayVisible,
  isEditable,
  openPreview,
  previewOf,
  splitAttachments,
  uploadView,
} from '../../src/client/attachmentRail.ts'
import type { RailItem, RailUpload } from '../../src/client/attachmentRail.ts'

const image = (id: string, previewUrl = `blob:${id}`): RailItem =>
  ({ kind: 'image', id, fileName: `${id}.png`, previewUrl, width: 800, height: 600 })
const file = (id: string): RailItem => ({ kind: 'file', id, fileName: `${id}.txt` })

describe('splitAttachments', () => {
  it('splits image items from file items, keeping each side in input order', () => {
    const split = splitAttachments([image('a'), file('b'), image('c'), file('d')])
    expect(split.images.map(item => item.id)).toEqual(['a', 'c'])
    expect(split.files.map(item => item.id)).toEqual(['b', 'd'])
  })

  it('returns empty sides for a homogeneous list', () => {
    expect(splitAttachments([file('x')]).images).toEqual([])
    expect(splitAttachments([image('x')]).files).toEqual([])
  })
})

describe('edit affordance rule', () => {
  it('offers editing for image items only', () => {
    expect(isEditable(image('a'))).toBe(true)
    expect(isEditable(file('a'))).toBe(false)
  })
})

describe('preview state machine', () => {
  it('openPreview records the opened id as the whole state', () => {
    expect(openPreview('a')).toEqual({ openId: 'a' })
  })

  it('a new open replaces the previous preview id', () => {
    const items = [image('a'), image('b')]
    expect(previewOf(openPreview('b'), items)?.id).toBe('b')
  })

  it('closePreview clears the opened id', () => {
    expect(closePreview(openPreview('a'))).toEqual({ openId: null })
    expect(closePreview({ openId: null })).toEqual({ openId: null })
  })

  it('previewOf resolves the opened id to its image item', () => {
    const items = [image('a'), file('b'), image('c')]
    expect(previewOf(openPreview('c'), items)?.id).toBe('c')
  })

  it('previewOf is undefined when nothing is open', () => {
    expect(previewOf({ openId: null }, [image('a')])).toBeUndefined()
  })

  it('previewOf never resolves a file id to a preview', () => {
    expect(previewOf(openPreview('b'), [image('a'), file('b')])).toBeUndefined()
  })
})

describe('upload rendering decision', () => {
  it('a missing upload renders as pending, with no progress and no retry', () => {
    expect(uploadView(undefined)).toEqual({ tone: 'pending', progress: null, retry: false, detail: '' })
  })

  it('an uploading upload renders as progress with a fraction when the total is known', () => {
    const upload: RailUpload = { status: 'uploading', loaded: 30, total: 100 }
    expect(uploadView(upload)).toEqual({ tone: 'uploading', progress: 0.3, retry: false, detail: '' })
  })

  it('an uploading upload without a total renders indeterminate progress', () => {
    expect(uploadView({ status: 'uploading', loaded: 42 })).toEqual({ tone: 'uploading', progress: null, retry: false, detail: '' })
  })

  it('a ready upload renders actionable, not as progress or retry', () => {
    expect(uploadView({ status: 'ready', receiptId: 'r1' })).toEqual({ tone: 'ready', progress: null, retry: false, detail: '' })
  })

  it('an error upload renders a retry affordance carrying the message', () => {
    const view = uploadView({ status: 'error', message: 'upload failed' })
    expect(view.tone).toBe('error')
    expect(view.retry).toBe(true)
    expect(view.detail).toBe('upload failed')
  })
})

describe('drop overlay decision', () => {
  it('shows the overlay only while a drag is held over an accepting composer', () => {
    expect(dropOverlayVisible(true, 1)).toBe(true)
    expect(dropOverlayVisible(true, 0)).toBe(false)
    expect(dropOverlayVisible(false, 2)).toBe(false)
  })
})
