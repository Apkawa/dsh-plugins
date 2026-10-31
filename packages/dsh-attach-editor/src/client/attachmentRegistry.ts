/**
 * The rail→pane bridge: a module-level registry of image draft attachments.
 * The composer rail remembers what it renders (and forgets what it removed),
 * the "Annotate image" tab body resolves the edited attachment's Blob from it.
 * Cross-plugin runtime imports are forbidden, so the pane reads Blobs here
 * instead of reaching into the conversation service.
 */
export interface RegistryAttachment {
  readonly kind: 'image' | 'file'
  readonly id: string
  /** The draft's file (a Blob the editor can mount). */
  readonly file: File
  /** The draft's preview object URL, when it has one. */
  readonly previewUrl?: string | undefined
}

export interface RegistryEntry {
  readonly id: string
  readonly blob: Blob
  readonly fileName: string
  readonly previewUrl: string
}

const entries = new Map<string, RegistryEntry>()

/**
 * Remember one attachment for the editor. A file-kind attachment is never
 * remembered — only an image can open in the editor. Re-remembering an id
 * replaces its entry (the rail re-renders with fresh draft objects).
 * @param attachment - the runtime draft attachment the rail rendered.
 */
export function rememberAttachment(attachment: RegistryAttachment): void {
  if (attachment.kind !== 'image') return
  entries.set(attachment.id, {
    id: attachment.id,
    blob: attachment.file,
    fileName: attachment.file.name,
    previewUrl: attachment.previewUrl ?? '',
  })
}

/** Drop one attachment (the rail removed it, or its entry was replaced). */
export function forgetAttachment(id: string): void {
  entries.delete(id)
}

/** Resolve an attachment id to its remembered image entry. */
export function lookup(id: string): RegistryEntry | undefined {
  return entries.get(id)
}
