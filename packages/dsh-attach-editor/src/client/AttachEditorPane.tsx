/**
 * The "Annotate image" tab body. Idle until an image attachment's Edit opens
 * an edit session; then it resolves the attachment's Blob from the rail
 * registry and mounts the image editor into the body. A registry miss (the
 * attachment left the draft) shows the missing state and mounts nothing.
 * Saving composes the replacement through the conversation surface wired in
 * `index.ts`; a composer refusal (a send in flight) shows a visible blocked
 * banner and leaves the draft — and the editor — untouched. The tab's
 * lifetime signal ends the edit session when the tab closes; the editor is
 * disposed on unmount and on every edit-session change.
 */

import { useEffect, useRef, useState } from 'react'
import { mountImageEditor } from '@apkawa/image-editor'
import css from './attach-editor-pane.module.css'
import { lookup } from './attachmentRegistry.ts'
import { conversationActions, replaceDraftAttachment } from './conversationReplace.ts'
import { activeEdit, endEdit, subscribeEdit } from './editSession.ts'
import type { EditSession } from './editSession.ts'

/** The framework's tab-info hook, as this pane consumes it (structural mirror). */
interface TabInfoMirror {
  readonly tab: { readonly signal: AbortSignal }
}

export interface AttachEditorPaneProps {
  /** The enclosing tab's reader, delivered by the pane seat's hooks. */
  readonly useTabInfo?: (() => TabInfoMirror) | undefined
}

/**
 * Render the tab body for the current edit session.
 * @param props - the seat props; `useTabInfo` carries the tab's lifetime signal.
 */
export function AttachEditorPane(props: AttachEditorPaneProps) {
  const [edit, setEdit] = useState<EditSession | undefined>(() => activeEdit())
  const [banner, setBanner] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // The tab-info hook runs during render (hooks never inside an effect); it
  // carries the tab's lifetime signal.
  const tabInfo = props.useTabInfo?.()
  const signal = tabInfo?.tab.signal

  // A re-edit from the rail (another attachment) swaps the body without a
  // remount of the pane; every change lands here.
  useEffect(() => subscribeEdit(setEdit), [])

  // The tab's lifetime signal ends the edit session on close; the mount
  // effect's cleanup disposes the editor.
  useEffect(() => {
    if (signal === undefined) return
    const onAbort = (): void => { endEdit() }
    signal.addEventListener('abort', onAbort)
    return () => signal.removeEventListener('abort', onAbort)
  }, [signal])

  const entry = edit === undefined ? undefined : lookup(edit.attachmentId)

  // Dep on `edit` alone: a pane re-render must not remount the canvas (that
  // would drop the shapes drawn so far), only a new edit session may.
  useEffect(() => {
    setBanner(null)
    if (edit === undefined || entry === undefined || bodyRef.current === null) return
    const controller = mountImageEditor(bodyRef.current, {
      image: entry.blob,
      onSave: (blob) => {
        const outcome = replaceDraftAttachment(conversationActions(), edit.sessionId, edit.attachmentId, blob, entry.fileName)
        if (outcome === 'applied') {
          endEdit()
          return
        }
        // The banner names why the save did not land; the draft stays as it was.
        setBanner(outcome === 'blocked' ? 'Cannot replace while sending' : 'Cannot replace: the conversation surface is unavailable')
      },
      onCancel: () => { endEdit() },
    })
    return () => { controller.dispose() }
  }, [edit])

  return (
    <div className={css.pane} data-testid="attach-editor-pane">
      {edit === undefined ? (
        <div className={css.idle} data-testid="attach-editor-idle">Open an image attachment and press Edit image</div>
      ) : entry === undefined ? (
        <div className={css.idle} data-testid="attach-editor-missing">This attachment is no longer in the draft</div>
      ) : (
        <>
          {banner !== null ? <div className={css.blocked} role="status" data-testid="attach-editor-blocked">{banner}</div> : null}
          <div ref={bodyRef} className={css.body} data-testid="attach-editor-body" />
        </>
      )}
    </div>
  )
}
