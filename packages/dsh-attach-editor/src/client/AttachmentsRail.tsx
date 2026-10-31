/** Our occupant for the composer's `conversation.input.attachments` seat. */

import { useEffect, useState } from 'react'
import css from './attachments-rail.module.css'
import {
  closePreview,
  dropOverlayVisible,
  isEditable,
  openPreview,
  previewOf,
  splitAttachments,
  uploadView,
} from './attachmentRail.ts'
import type { RailItem, RailPreviewState, RailUploads } from './attachmentRail.ts'
import { forgetAttachment, rememberAttachment } from './attachmentRegistry.ts'
import { PreviewOverlay } from './PreviewOverlay.tsx'

/** Runtime draft image item as the composer owner passes it. */
interface RailRuntimeImage {
  readonly kind: 'image'
  readonly id: string
  readonly file: File
  readonly previewUrl: string
  readonly width?: number
  readonly height?: number
}

/** Runtime draft file item as the composer owner passes it. */
interface RailRuntimeFile {
  readonly kind: 'file'
  readonly id: string
  readonly file: File
}

export interface AttachmentsRailProps {
  /** Draft attachments, owned by the composer. */
  readonly attachments: readonly (RailRuntimeImage | RailRuntimeFile)[]
  /** Whether this composer accepts dropped/picked files right now. */
  readonly canAcceptDrop: boolean
  /** Adds picked or dropped files to the draft. */
  readonly onAddFiles: (files: readonly File[], directories?: ReadonlySet<File>) => void
  /** Removes one draft attachment. */
  readonly onRemoveAttachment: (id: string) => void
  /** Per-file upload status, owned by the composer. */
  readonly uploads: RailUploads
  /** Re-uploads a failed file. */
  readonly onRetryFile: (id: string) => void
  /** Image intake limits for the drop hint, when image limits exist. */
  readonly dropLimits?: { readonly count: number; readonly size: string } | undefined
  /** Session scope seat; undefined on a session-less home. */
  readonly sessionId?: string | undefined
  /** Opens the "Annotate image" tab for one image attachment. */
  readonly onEditImage?: ((attachmentId: string) => void) | undefined
}

/**
 * Renders image thumbnails (click opens our preview overlay), file rows with
 * upload progress/retry, per-item remove buttons, and a drop overlay while a
 * file drag is over the window.
 * @param props - composer owner props plus the registrant's edit callback.
 */
export function AttachmentsRail(props: AttachmentsRailProps) {
  const items = props.attachments.flatMap((attachment): RailItem[] =>
    attachment.kind === 'image'
      ? [{
          kind: 'image' as const,
          id: attachment.id,
          fileName: attachment.file.name,
          previewUrl: attachment.previewUrl,
          width: attachment.width,
          height: attachment.height,
        }]
      : [{ kind: 'file' as const, id: attachment.id, fileName: attachment.file.name }],
  )
  const split = splitAttachments(items)
  const [previewState, setPreviewState] = useState<RailPreviewState>({ openId: null })
  const [dragDepth, setDragDepth] = useState(0)
  const preview = previewOf(previewState, items)

  // The rail→pane bridge: remember every attachment this render shows (only
  // images are remembered), forget them when this render is replaced or the
  // rail is removed — the tab body resolves an edited attachment through the
  // registry, and a stale Blob must never win against a fresh re-render.
  useEffect(() => {
    props.attachments.forEach(rememberAttachment)
    const shownIds = props.attachments.map(attachment => attachment.id)
    return () => { shownIds.forEach(forgetAttachment) }
  }, [props.attachments])

  useEffect(() => {
    if (!props.canAcceptDrop) return
    const fileTransfer = (event: DragEvent): DataTransfer | null => {
      if (event.dataTransfer === null || !event.dataTransfer.types.includes('Files')) return null
      return event.dataTransfer
    }
    const droppedDirectories = (dataTransfer: DataTransfer, files: readonly File[]): ReadonlySet<File> => {
      const directories = new Set<File>()
      files.forEach((file, index) => {
        if (dataTransfer.items[index]?.webkitGetAsEntry()?.isDirectory === true) directories.add(file)
      })
      return directories
    }
    const onDragEnter = (event: DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      setDragDepth(depth => depth + 1)
    }
    const onDragOver = (event: DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      if (fileTransfer(event) === null) return
      const leftWindow = document.documentElement === event.target && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight)
      if (leftWindow) {
        setDragDepth(0)
        return
      }
      setDragDepth(depth => Math.max(0, depth - 1))
    }
    const onDrop = (event: DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      setDragDepth(0)
      const files = Array.from(dataTransfer.files)
      props.onAddFiles(files, droppedDirectories(dataTransfer, files))
    }
    const onDragEnd = (): void => setDragDepth(0)
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [props.canAcceptDrop, props.onAddFiles])

  return (
    <div className={css.rail} data-testid="attach-editor-rail">
      {split.images.map(item => (
        <div key={item.id} className={css.imageItem}>
          <button
            type="button"
            className={css.thumbnail}
            data-attachment-kind="image"
            data-testid="attach-editor-thumb"
            onClick={() => {
              if (!isEditable(item)) return
              setPreviewState(openPreview(item.id))
            }}
          >
            <img src={item.previewUrl} alt={item.fileName} />
          </button>
          <button
            type="button"
            className={css.remove}
            aria-label="Remove attachment"
            data-testid="attach-editor-remove"
            onClick={() => props.onRemoveAttachment(item.id)}
          />
        </div>
      ))}
      {split.files.map(item => {
        const view = uploadView(props.uploads[item.id])
        return (
          <div key={item.id} className={css.fileRow} data-attachment-kind="file">
            <span className={css.fileName}>{item.fileName}</span>
            {view.tone === 'pending' ? <span className={css.uploadState}>Preparing…</span> : null}
            {view.tone === 'uploading' ? (
              view.progress === null
                ? <span className={css.indeterminate}>Uploading…</span>
                : <span className={css.progressTrack}><span className={css.progressFill} style={{ width: `${Math.round(view.progress * 100)}%` }} /></span>
            ) : null}
            {view.tone === 'ready' ? <span className={css.uploadState}>Uploaded</span> : null}
            {view.tone === 'error' ? <span className={css.errorState}>{view.detail}</span> : null}
            {view.retry ? (
              <button type="button" className={css.retry} data-testid="attach-editor-retry" onClick={() => props.onRetryFile(item.id)}>Retry</button>
            ) : null}
            <button
              type="button"
              className={css.removeRow}
              aria-label="Remove attachment"
              data-testid="attach-editor-remove"
              onClick={() => props.onRemoveAttachment(item.id)}
            />
          </div>
        )
      })}
      {dropOverlayVisible(props.canAcceptDrop, dragDepth) ? (
        <div className={css.dropOverlay} data-testid="attach-editor-drop-overlay">
          <span>Drop files here</span>
          {props.dropLimits !== undefined ? <span className={css.dropHint}>Up to {props.dropLimits.count} images, {props.dropLimits.size} each</span> : null}
        </div>
      ) : null}
      {preview !== undefined ? (
        <PreviewOverlay
          preview={preview}
          // Editing hands the image to the tab pane, so the overlay closes —
          // its mask would otherwise sit over the canvas and swallow its pointer events.
          onEdit={() => {
            props.onEditImage?.(preview.id)
            setPreviewState(closePreview(previewState))
          }}
          onClose={() => setPreviewState(closePreview(previewState))}
        />
      ) : null}
    </div>
  )
}
