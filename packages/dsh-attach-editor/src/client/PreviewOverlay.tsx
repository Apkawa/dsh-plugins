/**
 * The preview dialog over an image attachment: a portal on `document.body`
 * (the rail sits inside the composer card, so an absolute child cannot cover
 * the page), a dimming mask that closes on click, Escape to close, a focus
 * trap, and a header ABOVE the image carrying the edit affordance and the
 * close button. Mirrors the shipped `ImageLightbox` overlay mechanics; the
 * header is ours — the lightbox has no slot for an edit action.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import css from './preview-overlay.module.css'
import type { RailImageItem } from './attachmentRail.ts'

export interface PreviewOverlayProps {
  readonly preview: RailImageItem
  readonly onEdit: () => void
  readonly onClose: () => void
}

export function PreviewOverlay(props: PreviewOverlayProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const editRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      // Capture phase: the composer's own keymap must not see the Escape that
      // closes this dialog.
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onClose()
        return
      }
      if (event.key === 'Tab') {
        // The trap: with two focusables, Tab always lands on the other one.
        event.preventDefault()
        const target = document.activeElement === editRef.current ? closeRef.current : editRef.current
        target?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [props.onClose])

  return createPortal(
    <div className={css.backdrop} role="dialog" aria-modal="true" aria-label="Image preview" data-testid="attach-editor-preview">
      <div className={css.mask} aria-hidden="true" data-testid="attach-editor-mask" onMouseDown={props.onClose} />
      <div className={css.sheet}>
        {/* The header must sit above the image: the edit action reads as a
            command for what is shown below it. */}
        <div className={css.header}>
          <button ref={editRef} type="button" className={css.action} data-testid="attach-editor-edit-button" onClick={props.onEdit}>
            Edit image
          </button>
          <button ref={closeRef} type="button" className={css.action} data-testid="attach-editor-close-button" onClick={props.onClose}>
            Close
          </button>
        </div>
        <img className={css.image} src={props.preview.previewUrl} alt={props.preview.fileName} />
      </div>
    </div>,
    document.body,
  )
}
