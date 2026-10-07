import { useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { IconEditOutlineRegular, IconFolderCloseRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueItem, QueueStatus } from '../queue/types.ts'
import css from './queue-pane.module.css'
import { formatStats, workspaceName } from './format.ts'
import { callRpc, getItems, refresh, subscribe } from './index.ts'

/** The composed props the slot dispatcher hands the pane (its inject face). */
type QueuePaneProps = { openSession: (sessionId: string) => void }

/** The status label's state token class, by status. */
const statusClass: Record<QueueStatus, string | undefined> = {
  queued: css.statusQueued,
  running: css.statusRunning,
  done: css.statusDone,
  interrupted: css.statusInterrupted,
}

/** The "Show queue" tab body: one row per queued item in file order. */
export function QueuePane(props: QueuePaneProps) {
  const [items, setItems] = useState<QueueItem[]>(getItems)
  // In-flight DnD state lives at the pane level: the drop target is a
  // sibling of the drag source, so per-row state cannot express it.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  useEffect(() => {
    const unsubscribe = subscribe(setItems)
    void refresh()
    return unsubscribe
  }, [])

  const reorder = (id: string, toIndex: number): void => {
    void callRpc('reorder', { id, toIndex }).then(() => refresh())
  }
  const remove = (id: string): void => {
    void callRpc('remove', { id }).then(() => refresh())
  }
  // Single reset point: dragend fires after both a completed drop and an
  // aborted drag.
  const endDrag = (): void => {
    setDraggingId(null)
    setDragOverIndex(null)
  }

  if (items.length === 0) return <div data-testid="global-queue-pane" className={css.pane}><p className={css.empty}>Queue is empty</p></div>
  return (
    <div data-testid="global-queue-pane" className={css.pane}>
      <div className={css.list}>
        {items.map((item, index) => (
          <Row
            key={item.id}
            item={item}
            index={index}
            dragging={draggingId === item.id}
            dropTarget={dragOverIndex === index}
            onDragStart={() => setDraggingId(item.id)}
            onDragEnd={endDrag}
            onDragOver={() => setDragOverIndex(index)}
            onReorder={reorder}
            onRemove={remove}
            onOpenSession={props.openSession}
          />
        ))}
      </div>
    </div>
  )
}

type RowProps = {
  item: QueueItem
  index: number
  dragging: boolean
  dropTarget: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onReorder: (id: string, toIndex: number) => void
  onRemove: (id: string) => void
  onOpenSession: (sessionId: string) => void
}

function Row(props: RowProps) {
  const { item } = props
  // Only queued items are editable: the Edit button and the double-click
  // trigger render/wire on this gate.
  const editable = item.status === 'queued'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const textarea = useRef<HTMLTextAreaElement>(null)
  // The row element: the drag preview (setDragImage) is the whole row.
  const rowRef = useRef<HTMLDivElement>(null)
  // Guards the settle race: once a settle commits or cancels, a late
  // duplicate of the same settle must not post a second RPC.
  const settled = useRef(false)

  // Auto-grow: the field's height follows its content (CSS caps it).
  const grow = (): void => {
    const el = textarea.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => {
    if (editing) grow()
  }, [editing])

  const beginEdit = (): void => {
    settled.current = false
    setDraft(item.text)
    setEditing(true)
  }
  const commitEdit = (): void => {
    if (settled.current) return
    settled.current = true
    if (draft.trim() === '') { setEditing(false); return }
    setEditing(false)
    void callRpc('editText', { id: item.id, text: draft }).then(() => refresh())
  }
  const discardEdit = (): void => {
    if (settled.current) return
    settled.current = true
    setEditing(false)
  }

  // Drag source = the handle only: the payload is the item id, and the
  // drag preview is the whole row anchored under the cursor.
  const onDragStart = (event: DragEvent): void => {
    event.dataTransfer.setData('text/plain', item.id)
    const row = rowRef.current
    if (row !== null) {
      const rect = row.getBoundingClientRect()
      event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top)
    }
    props.onDragStart()
  }
  // Drop target = the whole row: dragover marks it, drop reorders onto it.
  const onDragOver = (event: DragEvent): void => {
    event.preventDefault()
    props.onDragOver()
  }
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    const dragged = event.dataTransfer.getData('text/plain')
    if (dragged === '' || dragged === item.id) return
    props.onReorder(dragged, props.index)
  }

  const stats = formatStats(item)
  const sessionId = item.sessionId
  // The floating label's text: the workspace's display name (its path's last
  // segment); an empty name renders no label.
  const workspace = workspaceName(item.workspacePath)

  return (
    <div
      ref={rowRef}
      data-testid="global-queue-row"
      data-item-id={item.id}
      className={`${css.row} ${props.dragging ? css.dragging : ''} ${props.dropTarget ? css.dropTarget : ''}`.trim()}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span
        data-testid="global-queue-drag"
        className={css.drag}
        draggable
        onDragStart={onDragStart}
        onDragEnd={props.onDragEnd}
      >
        ⋮⋮
      </span>
      {editing
        ? (
          <div className={css.editWrap}>
            <textarea
              data-testid="global-queue-edit"
              ref={textarea}
              className={css.edit}
              value={draft}
              rows={1}
              autoFocus
              onChange={event => setDraft(event.target.value)}
              onInput={grow}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === 'Escape') discardEdit()
              }}
            />
            <div className={css.editActions}>
              <button type="button" className={css.cancel} data-testid="global-queue-cancel" onClick={discardEdit}>Cancel</button>
              <button type="button" className={css.save} data-testid="global-queue-save" onClick={commitEdit}>Save</button>
            </div>
          </div>
        )
        : (
          // The text cell: the row title.
          <span className={css.textWrap}>
            <span className={css.text} onDoubleClick={editable ? beginEdit : undefined}>{item.text}</span>
          </span>
        )}
      <span className={`${css.status} ${statusClass[item.status]}`} data-testid="global-queue-status">{item.status}</span>
      {editable && <button type="button" className={css.editButton} data-testid="global-queue-edit-button" aria-label="Edit" onClick={beginEdit}><IconEditOutlineRegular size={16} /></button>}
      <button type="button" className={css.remove} data-testid="global-queue-remove" aria-label="Remove" onClick={() => props.onRemove(item.id)}><IconTrashOutlineRegular size={16} /></button>
      {stats !== '' && <span className={css.stats} data-testid="global-queue-stats">{stats}</span>}
      {workspace !== '' && (
        <a
          data-testid="global-queue-open"
          aria-label={sessionId !== undefined ? 'Open session' : 'Workspace'}
          aria-disabled={sessionId === undefined}
          className={`${css.open} ${sessionId === undefined ? css.openDisabled : ''}`.trim()}
          href="#"
          onClick={event => {
            event.preventDefault()
            if (sessionId === undefined) return
            props.onOpenSession(sessionId)
          }}
        >
          <IconFolderCloseRegular size={12} />
          {workspace}
        </a>
      )}
    </div>
  )
}
