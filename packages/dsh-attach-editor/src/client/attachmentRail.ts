/**
 * The attachment rail's decision logic as a pure module (no DOM, no React):
 * the image/file split, the edit affordance rule, the preview state machine,
 * the upload rendering decision, and the drop-overlay rule. `AttachmentsRail.tsx`
 * consumes every decision; the unit tests pin them.
 */
export interface RailImageItem {
  readonly kind: 'image'
  readonly id: string
  readonly fileName: string
  readonly previewUrl: string
  readonly width?: number | undefined
  readonly height?: number | undefined
}

export interface RailFileItem {
  readonly kind: 'file'
  readonly id: string
  readonly fileName: string
}

export type RailItem = RailImageItem | RailFileItem

/** One file upload's host-reported state; `undefined` = not started yet. */
export type RailUpload =
  | { readonly status: 'uploading'; readonly loaded: number; readonly total?: number | undefined }
  | { readonly status: 'ready'; readonly receiptId: string }
  | { readonly status: 'error'; readonly message: string }

export type RailUploads = Readonly<Record<string, RailUpload | undefined>>

export interface RailSplit {
  readonly images: readonly RailImageItem[]
  readonly files: readonly RailFileItem[]
}

/** Images render as thumbnails, files as rows — the split drives that choice. */
export function splitAttachments(items: readonly RailItem[]): RailSplit {
  return {
    images: items.filter(item => item.kind === 'image'),
    files: items.filter(item => item.kind === 'file'),
  }
}

/** Only an image carries an edit affordance; a file row never offers one. */
export function isEditable(item: RailItem): boolean {
  return item.kind === 'image'
}

export interface RailPreviewState {
  readonly openId: string | null
}

/** The preview is a single opened id; opening a new item replaces it. */
export function openPreview(id: string): RailPreviewState {
  return { openId: id }
}

export function closePreview(state: RailPreviewState): RailPreviewState {
  return { openId: null }
}

/** The opened preview resolves only to an image item — a file id never opens. */
export function previewOf(state: RailPreviewState, items: readonly RailItem[]): RailImageItem | undefined {
  if (state.openId === null) return undefined
  const item = items.find(candidate => candidate.id === state.openId)
  return item?.kind === 'image' ? item : undefined
}

export interface UploadView {
  readonly tone: 'pending' | 'uploading' | 'ready' | 'error'
  /** A 0..1 fraction when the host reported a total, `null` when indeterminate. */
  readonly progress: number | null
  readonly retry: boolean
  readonly detail: string
}

/** uploading → progress bar, ready → actionable row, error → retry affordance. */
export function uploadView(upload: RailUpload | undefined): UploadView {
  if (upload === undefined) return { tone: 'pending', progress: null, retry: false, detail: '' }
  if (upload.status === 'uploading') {
    const total = upload.total
    return { tone: 'uploading', progress: total === undefined || total <= 0 ? null : upload.loaded / total, retry: false, detail: '' }
  }
  if (upload.status === 'ready') return { tone: 'ready', progress: null, retry: false, detail: '' }
  return { tone: 'error', progress: null, retry: true, detail: upload.message }
}

/** The drop overlay rides the document drag counter, gated by acceptance. */
export function dropOverlayVisible(canAcceptDrop: boolean, dragDepth: number): boolean {
  return canAcceptDrop && dragDepth > 0
}
