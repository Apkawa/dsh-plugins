import { mountImageEditor } from '../src/index.ts'
import type { EditorDebugState, ImageEditorController } from '../src/index.ts'

declare global {
  interface Window {
    __editorState?: () => EditorDebugState
    __lastExport?: { size: number; type: string } | null
  }
}

const editorHost = document.getElementById('editor')
const preview = document.getElementById('preview')
const info = document.getElementById('export-info')
const fileInput = document.getElementById('file')
const pasteArea = document.getElementById('paste')
if (!editorHost || !preview || !info || !(fileInput instanceof HTMLInputElement) || !pasteArea) {
  throw new Error('dev page is missing its elements')
}

let controller: ImageEditorController | null = null

window.__editorState = () => controller?.debugState() ?? null
window.__lastExport = null

function mount(blob: Blob): void {
  controller?.dispose()
  controller = mountImageEditor(editorHost, {
    image: blob,
    onSave: (saved) => {
      window.__lastExport = { size: saved.size, type: saved.type }
      preview.hidden = false
      preview.src = URL.createObjectURL(saved)
      info.textContent = `${saved.size} bytes · ${saved.type}`
    },
    onCancel: () => {
      info.textContent = 'cancelled'
    },
  })
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) mount(file)
})

pasteArea.addEventListener('paste', (event) => {
  const file = event.clipboardData?.files[0]
  if (file) mount(file)
})

const src = new URLSearchParams(window.location.search).get('src')
if (src) fetch(src).then((response) => response.blob()).then(mount)
