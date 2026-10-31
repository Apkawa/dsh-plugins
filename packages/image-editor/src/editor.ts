import { renderPng } from './export.ts'
import { attachInput } from './input.ts'
import type { InputApi } from './input.ts'
import { OVERLAY_COLOR, drawScene, resizeCanvas } from './render.ts'
import {
  COLOR_PRESETS,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_PRESETS,
  TOOL_DEFAULT_COLORS,
  TOOL_DEFAULT_WIDTHS,
  WIDTH_PRESETS,
  addShape,
  createScene,
  replaceShape,
  setDefaults,
  shapeOf,
  textExtent,
} from './scene.ts'
import { EDITOR_TOOLS, toolRegistry } from './tools.ts'
import { localToWorld, withFontSize } from './transform.ts'
import { createHistory } from './undo.ts'
import { createView, fitView, worldToScreen } from './view.ts'
import type { EditorTool, LeaderShape, Point, Scene, Shape, SpeechShape, TextShape, Transform } from './scene.ts'
import type { View } from './view.ts'

export interface ImageEditorOptions {
  image: Blob
  onSave(blob: Blob): void
  onCancel(): void
}

export interface ImageEditorController {
  setTool(tool: EditorTool): void
  setColor(hex: string): void
  setWidth(px: number): void
  undo(): void
  exportPng(): Promise<Blob>
  dispose(): void
  /** Debug snapshot for the dev page's `window.__editorState`; not part of the mount contract. */
  debugState(): EditorDebugState
}

export type EditorDebugState = {
  tool: EditorTool | null
  color: string
  width: number
  shapeCount: number
  /** First selected id, or null when nothing is selected. */
  selectedId: string | null
  selectedIds: readonly string[]
  scale: number
  offsetX: number
  offsetY: number
  transforms: readonly Transform[]
  /** Shape kinds in stacking order — what the scene holds, alongside `transforms`. */
  kinds: readonly EditorTool[]
  /** Text labels — plain ones, balloon texts and callout texts — in stacking order, each with the font size it is drawn at. */
  texts: readonly { text: string; fontSize: number }[]
}

/** Palette popover kind; the three triggers share one open slot. */
type PaletteKind = 'color' | 'width' | 'size'

/** Distance from a label's top edge (or the editing field) up to its font-size button. */
const TEXT_SIZE_BUTTON_GAP = 34

const EDITOR_STYLE = `
.ie-root { display: flex; flex-direction: column; height: 100%; font: 13px ui-sans-serif, system-ui, sans-serif; color: #1a1a1a; background: #f7f7f8; }
.ie-toolbar { position: relative; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; padding: 8px; background: #ffffff; border-bottom: 1px solid #d8dbe0; }
.ie-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 1px solid #c9ced6; border-radius: 6px; background: #ffffff; color: #1a1a1a; font: inherit; cursor: pointer; }
.ie-btn[data-active="true"] { border-color: #1a1a1a; background: #1a1a1a; color: #ffffff; }
.ie-swatch { width: 22px; height: 22px; padding: 0; border: 1px solid #c9ced6; border-radius: 6px; cursor: pointer; }
.ie-swatch[data-active="true"] { outline: 2px solid #1a1a1a; outline-offset: 1px; }
.ie-sep { width: 1px; height: 20px; background: #d8dbe0; }
.ie-popover { position: absolute; top: 100%; z-index: 10; display: flex; gap: 6px; padding: 6px; background: #ffffff; border: 1px solid #c9ced6; border-radius: 6px; box-shadow: 0 4px 12px rgba(26, 26, 26, 0.15); }
.ie-popover[hidden] { display: none; }
.ie-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #e8eaed; }
.ie-canvas { display: block; width: 100%; height: 100%; touch-action: none; }
/* The field's line-height mirrors LINE_HEIGHT so typed lines stack exactly as the canvas draws them. */
.ie-text-input { position: absolute; border: 1px solid #1a1a1a; border-radius: 4px; background: #ffffff; font: inherit; padding: 2px 4px; resize: none; overflow: hidden; line-height: 1.5; }
.ie-size-button { position: absolute; z-index: 10; height: 24px; padding: 2px 8px; border: 1px solid #c9ced6; border-radius: 6px; background: #ffffff; color: #1a1a1a; font: inherit; cursor: pointer; }
.ie-size-button[hidden] { display: none; }
.ie-status { padding: 6px 8px; background: #ffffff; border-top: 1px solid #d8dbe0; color: #5b6268; }
`

// Hand-written stroke icons on an 18×18 grid. stroke="currentColor" lets the
// active state (dark fill, white text) recolor the glyph without extra CSS.
function iconSvg(paths: string): string {
  return `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

const TOOL_ICONS: Record<EditorTool, { label: string; icon: string }> = {
  // Mouse pointer: tip at the top-left, tail widening towards the bottom-right.
  select: {
    label: 'Select',
    icon: iconSvg('<path d="M4.5 2.5 4.5 14.5 8 11.5 10.75 15.5 12.75 14.25 10 10 15 10Z"/>'),
  },
  marker: {
    label: 'Marker',
    icon: iconSvg('<path d="M2.5 15.5 4 11 10.5 4.5 13.5 7.5 7 14.5 2.5 15.5Z"/><path d="M8.5 6.5 11 10.5"/>'),
  },
  highlighter: {
    label: 'Highlighter',
    icon: iconSvg('<path d="M11.5 4 14.5 7"/><path d="M11 5.5 6 10.5 4 11 4.5 9 9.5 3.5Z"/>'),
  },
  arrow: {
    label: 'Arrow',
    icon: iconSvg('<path d="M12.75 5.25 5.25 12.75"/><path d="M5.25 5.25 12.75 5.25 12.75 12.75"/>'),
  },
  rect: {
    label: 'Rectangle',
    icon: iconSvg('<rect x="3.5" y="4.5" width="11" height="9" rx="1.5"/>'),
  },
  text: {
    label: 'Text',
    icon: iconSvg('<path d="M3 5.25 3 3 15 3 15 5.25"/><path d="M9 3 9 15"/><path d="M6.75 15 11.25 15"/>'),
  },
  // Numbered badge: circle plus the digit hint "1" (stem with its short serif).
  step: {
    label: 'Step',
    icon: iconSvg('<circle cx="9" cy="9" r="6"/><path d="M8.25 6.75 9.75 5.25V11.25"/>'),
  },
  // Speech balloon: oval with a two-line tail converging on the tip, like the drawn shape.
  speech: {
    label: 'Speech balloon',
    icon: iconSvg('<ellipse cx="9.5" cy="7.5" rx="5.5" ry="4"/><path d="M6.4 10.6 4.5 15.5"/><path d="M9.3 11.4 4.5 15.5"/>'),
  },
  // Callout: dot at the start, shaft rising to the shelf end, shelf stroked under the label.
  leader: {
    label: 'Callout',
    icon: iconSvg('<circle cx="4.5" cy="14" r="2.25"/><path d="M4.5 14 11.5 6.5"/><path d="M8.5 6.5H14.5"/>'),
  },
}

// Undo arrow: tip points left from the leftmost vertex, shaft runs right, then quarter-arc
// hooks drop below the shaft and loop back left — nothing sweeps over the top like a U-turn.
const UNDO_ICON = iconSvg('<path d="M6.75 9.75 3 6 6.75 2.25"/><path d="M3 6h7.875v2.25"/><path d="M10.875 8.25a3.375 3.375 0 0 1 3.375 3.375a3.375 3.375 0 0 1-3.375 3.375H6.75"/>')
// Four corner brackets: the picture refits to the frame they describe.
const RESET_ICON = iconSvg('<path d="M3.5 6.5V3.5H7"/><path d="M14.5 6.5V3.5H11"/><path d="M3.5 11.5v3.5H7"/><path d="M14.5 11.5v3.5H11"/>')
const SAVE_ICON = iconSvg('<path d="M14.25 15.75H3.75a1.5 1.5 0 0 1-1.5-1.5V3.75a1.5 1.5 0 0 1 1.5-1.5h8.25l3.75 3.75v8.25a1.5 1.5 0 0 1-1.5 1.5Z"/><path d="M12.75 15.75V9.75H5.25V15.75"/><path d="M5.25 2.25V6H11.25"/>')
const CANCEL_ICON = iconSvg('<path d="M4.5 4.5 13.5 13.5"/><path d="M13.5 4.5 4.5 13.5"/>')

// A short horizontal bar stroked at the current thickness; stroke="currentColor"
// keeps the glyph readable on the dark active state, like the tool icons.
function widthGlyph(px: number): string {
  return `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="9" x2="15" y2="9" stroke-width="${px}"/></svg>`
}

/** Mounts the editor into `container` and returns the controller. */
export function mountImageEditor(container: HTMLElement, options: ImageEditorOptions): ImageEditorController {
  const style = document.createElement('style')
  style.textContent = EDITOR_STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.className = 'ie-root'
  const toolbar = document.createElement('div')
  toolbar.className = 'ie-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  const stage = document.createElement('div')
  stage.className = 'ie-stage'
  const canvas = document.createElement('canvas')
  canvas.className = 'ie-canvas'
  canvas.dataset.testid = 'editor-canvas'
  const status = document.createElement('div')
  status.className = 'ie-status'
  status.dataset.testid = 'editor-status'
  stage.appendChild(canvas)
  root.appendChild(toolbar)
  root.appendChild(stage)
  root.appendChild(status)
  container.appendChild(root)

  let scene = createScene()
  let view = createView({ width: canvas.clientWidth, height: canvas.clientHeight })
  let tool: EditorTool | null = 'marker'
  let selectedIds: readonly string[] = []
  /** Per-tool remembered colors; live UI state, deliberately outside the undoable scene. */
  const colors: Record<EditorTool, string> = { ...TOOL_DEFAULT_COLORS }
  /** Per-tool remembered thicknesses, same live UI state as the colors. */
  const widths: Record<EditorTool, number> = { ...TOOL_DEFAULT_WIDTHS }
  /** Rubber band mid-drag; null once the gesture ends. */
  let marquee: Transform | null = null
  /** Editing field for a new or existing label; Ctrl+Enter inserts a line inside it. */
  let textInput: HTMLTextAreaElement | null = null
  /** Font-size button that sits above the editing field, created with the field. */
  let textSizeButton: HTMLButtonElement | null = null
  /** Id of the label being edited, or null when the field writes a new one. */
  let editingId: string | null = null
  /** Font size the field is writing at; the palette rewrites it for the whole field. */
  let editingFontSize = DEFAULT_FONT_SIZE

  const history = createHistory()
  history.push(scene)

  const objectUrl = URL.createObjectURL(options.image)
  const img = new Image()
  const imageReady = new Promise<void>((resolve) => {
    img.onload = () => {
      fitToViewport()
      resolve()
    }
    img.onerror = () => {
      status.textContent = 'image failed to load'
      resolve()
    }
    img.src = objectUrl
  })

  const detachInput = attachInput(canvas, inputApi())

  function redraw(): void {
    resizeCanvas(canvas, canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0)
    // The selection highlight and rubber band follow the scene defaults, so a pick that
    // repaints selected shapes also repaints the outline while the selection stands.
    const measured = drawScene(ctx, scene, img, view, selectedIds, marquee ?? undefined, tool ? scene.defaults.color : OVERLAY_COLOR)
    if (measured) scene = measured
    syncTextSizeButton()
    status.textContent = `${scene.shapes.length} shapes · tool ${tool ?? 'none'} · zoom ${view.scale.toFixed(2)}`
  }

  /** Scales and centers the image in the viewport — the state the reset button restores. */
  function fitToViewport(): void {
    view = fitView({ width: canvas.clientWidth, height: canvas.clientHeight }, img.naturalWidth, img.naturalHeight)
    redraw()
  }

  function inputApi(): InputApi {
    return {
      scene: () => scene,
      view: () => view,
      viewBounds: () => ({ viewport: { width: canvas.clientWidth, height: canvas.clientHeight }, image: { width: img.naturalWidth, height: img.naturalHeight } }),
      tool: () => tool,
      defaults: () => scene.defaults,
      selectedIds: () => selectedIds,
      setView: (next) => {
        view = next
        redraw()
      },
      select: (ids) => {
        selectedIds = ids
        // A selection change drops any hover cursor a previous move left behind.
        canvas.style.cursor = ''
        redraw()
      },
      marquee: (rect) => {
        marquee = rect
        redraw()
      },
      preview: (next) => {
        scene = next
        redraw()
      },
      commit: commit,
      undo: undo,
      editText: (anchor, id) => openTextInput(anchor, id),
      setCursor: (css) => {
        canvas.style.cursor = css
      },
    }
  }

  /**
   * Opens the editing field at `anchor`. With `id` the field is pre-filled with that
   * label and committing replaces it in place; without it the field writes a new label.
   */
  function openTextInput(anchor: Point, id?: string): void {
    closeTextInput()
    const editing = labelOf(id)
    editingId = editing?.id ?? null
    editingFontSize = editing?.fontSize ?? DEFAULT_FONT_SIZE
    const field = document.createElement('textarea')
    field.className = 'ie-text-input'
    field.dataset.testid = 'editor-text-input'
    field.spellcheck = false
    field.value = editing?.text ?? ''
    const position = worldToScreen(view, anchor)
    field.style.left = `${position.x}px`
    field.style.top = `${position.y}px`
    const button = makeSizeButton('editor-text-size', () => toggleSizePalette(button))
    button.style.left = `${position.x}px`
    button.style.top = `${position.y - TEXT_SIZE_BUTTON_GAP}px`
    button.textContent = `${editingFontSize}`
    textInput = field
    textSizeButton = button
    // The field already carries the size button, so the canvas-level one steps aside.
    shapeSizeButton.hidden = true
    stage.append(field, button)
    sizeTextField()
    field.focus()
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeTextInput()
        return
      }
      if (event.key !== 'Enter') return
      event.preventDefault()
      // Browsers treat Ctrl/Cmd+Enter as a no-op inside a textarea, so the line break is inserted here.
      if (event.ctrlKey || event.metaKey) {
        insertLineBreak(field)
        return
      }
      commitText(anchor, field.value)
    })
    // Removing a focused field fires blur; the null check keeps Escape from committing.
    field.addEventListener('blur', () => {
      if (textInput) commitText(anchor, field.value)
    })
    field.addEventListener('input', sizeTextField)
  }

  /** Commits the field: an existing label is replaced in place, otherwise a new one is placed. */
  function commitText(anchor: Point, value: string): void {
    const id = editingId
    const fontSize = editingFontSize
    closeTextInput()
    const text = value.trim()
    if (text.length === 0) return
    const editing = labelOf(id)
    if (editing) {
      // A callout keeps its dot and shelf: the box is shaft geometry, so only the label and its size change.
      if (editing.kind === 'leader') {
        commit(replaceShape(scene, editing.id, { ...editing, text, fontSize }))
        return
      }
      // A balloon keeps its tail tip in image space; `withFontSize` grows the box around it.
      commit(replaceShape(scene, editing.id, withFontSize({ ...editing, text }, fontSize)))
      return
    }
    // A fresh balloon is placed by its own gesture, which puts the tail tip at the anchor.
    const gesture = tool === 'speech' ? toolRegistry.speech.begin(anchor, scene.defaults) : toolRegistry.text.begin(anchor, scene.defaults)
    gesture.withText(text, fontSize)
    commit(addShape(scene, gesture.finish()))
  }

  function closeTextInput(): void {
    const field = textInput
    const button = textSizeButton
    textInput = null
    textSizeButton = null
    editingId = null
    if (field) field.remove()
    if (button) button.remove()
    // Escape closes without committing, so nothing redraws: the canvas-level size
    // button has to be brought back for whatever is still selected.
    syncTextSizeButton()
  }

  /** The field mirrors the label's drawn size at the current zoom, so typing never wraps mid-word. */
  function sizeTextField(): void {
    if (!textInput) return
    const extent = textExtent(textInput.value, editingFontSize)
    textInput.style.fontSize = `${editingFontSize * view.scale}px`
    textInput.style.width = `${Math.max(extent.w * view.scale, 120) + 12}px`
    textInput.style.height = `${extent.h * view.scale + 10}px`
  }

  /** Splits the field at the caret so Ctrl+Enter reads as starting a new line. */
  function insertLineBreak(field: HTMLTextAreaElement): void {
    const caret = field.selectionEnd
    field.value = field.value.slice(0, field.selectionStart) + '\n' + field.value.slice(caret)
    field.selectionStart = caret + 1
    field.selectionEnd = caret + 1
    sizeTextField()
  }

  /** The selected shapes, in stacking order. */
  function selectedShapes(): Shape[] {
    return scene.shapes.filter((shape) => selectedIds.includes(shape.id))
  }

  /** The selected labels, balloons and callouts, in stacking order — the shapes that carry text. */
  function selectedLabels(): (TextShape | SpeechShape | LeaderShape)[] {
    return scene.shapes.filter((shape): shape is TextShape | SpeechShape | LeaderShape =>
      (shape.kind === 'text' || shape.kind === 'speech' || shape.kind === 'leader') && selectedIds.includes(shape.id),
    )
  }

  /** The label, balloon or callout behind `id`, or undefined for a fresh one. */
  function labelOf(id: string | null | undefined): TextShape | SpeechShape | LeaderShape | undefined {
    if (id === null || id === undefined) return undefined
    const shape = shapeOf(scene, id)
    if (shape && (shape.kind === 'text' || shape.kind === 'speech' || shape.kind === 'leader')) return shape
    return undefined
  }

  /** Floating font-size button above the selected label or balloon, hidden while a field is open. */
  function syncTextSizeButton(): void {
    const target = selectedLabels()[0]
    if (!target || textInput) {
      shapeSizeButton.hidden = true
      return
    }
    const position = worldToScreen(view, localToWorld(target.transform, { x: 0, y: 0 }))
    shapeSizeButton.style.left = `${position.x}px`
    shapeSizeButton.style.top = `${position.y - TEXT_SIZE_BUTTON_GAP}px`
    shapeSizeButton.textContent = `${Math.round(target.fontSize)}`
    shapeSizeButton.hidden = false
  }

  function commit(next: Scene): void {
    scene = next
    history.push(next)
    redraw()
  }

  const toolButtons = EDITOR_TOOLS.map((name) =>
    makeIconButton(`editor-tool-${name}`, TOOL_ICONS[name].label, TOOL_ICONS[name].icon, () => setTool(name)),
  )
  // Color and thickness are single trigger buttons opening a palette popover anchored
  // below the toolbar; only one popover can be open at a time.
  let openPalette: PaletteKind | null = null
  const colorTrigger = makeTriggerButton('editor-color-picker', 'Color', () => togglePalette('color'))
  const colorSwatch = document.createElement('span')
  colorSwatch.className = 'ie-swatch'
  colorTrigger.appendChild(colorSwatch)
  const widthTrigger = makeTriggerButton('editor-width-picker', 'Thickness', () => togglePalette('width'))
  const colorPopover = makePopover()
  const colorItems = COLOR_PRESETS.map((hex) => {
    const item = makeButton(`editor-color-${hex}`, '', () => pickColor(hex))
    item.className = 'ie-btn ie-swatch'
    item.style.background = hex
    item.title = hex
    item.setAttribute('aria-label', hex)
    colorPopover.appendChild(item)
    return item
  })
  const widthPopover = makePopover()
  const widthItems = WIDTH_PRESETS.map((px) => {
    const item = makeButton(`editor-width-${px}`, `${px}`, () => pickWidth(px))
    item.title = `${px}px`
    item.setAttribute('aria-label', `${px}px`)
    widthPopover.appendChild(item)
    return item
  })
  const undoButton = makeIconButton('editor-undo', 'Undo (Ctrl+Z)', UNDO_ICON, () => undo())
  const resetButton = makeIconButton('editor-reset-view', 'Reset view', RESET_ICON, fitToViewport)
  const saveButton = makeIconButton('editor-save', 'Save', SAVE_ICON, () => {
    exportPng().then((blob) => options.onSave(blob))
  })
  const cancelButton = makeIconButton('editor-cancel', 'Cancel', CANCEL_ICON, () => options.onCancel())
  toolbar.append(...toolButtons, separator(), colorTrigger, widthTrigger, separator(), resetButton, undoButton, separator(), saveButton, cancelButton, colorPopover, widthPopover)

  // The font palette lives in the stage because both of its triggers do: the button above
  // the editing field and the button above a selected text label.
  const sizePopover = makePopover()
  FONT_SIZE_PRESETS.forEach((px) => {
    const item = makeButton(`editor-font-size-${px}`, `${px}`, () => pickFontSize(px))
    item.title = `${px}px`
    item.setAttribute('aria-label', `${px}px`)
    // Picking a size must not blur the field, which would commit before the size lands.
    item.addEventListener('mousedown', (event) => event.preventDefault())
    sizePopover.appendChild(item)
  })
  const shapeSizeButton = makeSizeButton('editor-shape-size', () => toggleSizePalette(shapeSizeButton))
  shapeSizeButton.hidden = true
  stage.append(shapeSizeButton, sizePopover)

  function makeButton(testid: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'ie-btn'
    button.dataset.testid = testid
    button.textContent = label
    button.addEventListener('click', onClick)
    return button
  }

  function makeIconButton(testid: string, label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'ie-btn'
    button.dataset.testid = testid
    button.innerHTML = icon
    button.title = label
    button.setAttribute('aria-label', label)
    button.addEventListener('click', onClick)
    return button
  }

  function separator(): HTMLElement {
    const sep = document.createElement('div')
    sep.className = 'ie-sep'
    return sep
  }

  // Toolbar buttons whose visible content is a swatch or a stroke glyph rather than
  // an icon; they expand a palette popover instead of acting directly.
  function makeTriggerButton(testid: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'ie-btn'
    button.dataset.testid = testid
    button.title = label
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-expanded', 'false')
    button.addEventListener('click', onClick)
    return button
  }

  // A font-size button floats over the canvas rather than in the toolbar, so it carries its
  // own label text. mousedown is cancelled so a click never blurs the editing field.
  function makeSizeButton(testid: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'ie-size-button'
    button.dataset.testid = testid
    button.title = 'Font size'
    button.setAttribute('aria-label', 'Font size')
    button.setAttribute('aria-expanded', 'false')
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', onClick)
    return button
  }

  function makePopover(): HTMLDivElement {
    const popover = document.createElement('div')
    popover.className = 'ie-popover'
    popover.hidden = true
    return popover
  }

  function togglePalette(kind: 'color' | 'width'): void {
    if (openPalette === kind) {
      closePalette()
      return
    }
    closePalette()
    openPalette = kind
    const trigger = kind === 'color' ? colorTrigger : widthTrigger
    const popover = kind === 'color' ? colorPopover : widthPopover
    // The toolbar is the trigger's offsetParent (its only positioned ancestor), so offsetLeft
    // tracks the flex position — the popover stays under the trigger even with a centered row.
    popover.style.left = `${trigger.offsetLeft}px`
    popover.hidden = false
    syncPalette()
  }

  /** Opens the font palette directly below the size button that was clicked. */
  function toggleSizePalette(trigger: HTMLButtonElement): void {
    if (openPalette === 'size') {
      closePalette()
      return
    }
    closePalette()
    openPalette = 'size'
    trigger.setAttribute('aria-expanded', 'true')
    // The stage is the trigger's offsetParent, so the palette lands under the button.
    sizePopover.style.left = `${trigger.offsetLeft}px`
    sizePopover.style.top = `${trigger.offsetTop + trigger.offsetHeight}px`
    sizePopover.hidden = false
  }

  function closePalette(): void {
    if (openPalette === null) return
    openPalette = null
    colorPopover.hidden = true
    widthPopover.hidden = true
    sizePopover.hidden = true
    textSizeButton?.setAttribute('aria-expanded', 'false')
    shapeSizeButton.setAttribute('aria-expanded', 'false')
    syncPalette()
  }

  function syncPalette(): void {
    colorTrigger.setAttribute('aria-expanded', openPalette === 'color' ? 'true' : 'false')
    widthTrigger.setAttribute('aria-expanded', openPalette === 'width' ? 'true' : 'false')
  }

  /** Applies a color to everything being colored: every selected shape plus the defaults, as one commit. */
  function pickColor(hex: string): void {
    closePalette()
    const targets = selectedShapes()
    if (targets.length === 0) {
      setColor(hex)
      return
    }
    // Undo re-applies the per-tool remembered color, so the pick moves the scene defaults
    // and the shapes but leaves `colors` untouched — one Ctrl+Z restores both.
    commit(targets.reduce((acc, shape) => replaceShape(acc, shape.id, { ...shape, color: hex }), setDefaults(scene, { color: hex })))
    syncToolbar()
  }

  /** Applies a thickness to everything being thickened: every selected shape plus the defaults, as one commit. */
  function pickWidth(px: number): void {
    closePalette()
    const targets = selectedShapes()
    if (targets.length === 0) {
      setWidth(px)
      return
    }
    commit(targets.reduce((acc, shape) => replaceShape(acc, shape.id, { ...shape, width: px }), setDefaults(scene, { width: px })))
    syncToolbar()
  }

  /** Applies a size to everything being sized: the open field, or every selected label. */
  function pickFontSize(px: number): void {
    closePalette()
    if (textInput) {
      editingFontSize = px
      if (textSizeButton) textSizeButton.textContent = `${px}`
      sizeTextField()
      return
    }
    const targets = selectedLabels()
    if (targets.length === 0) return
    // A callout's box is shaft geometry — a size only restacks the label band above the shelf, so the box is not grown.
    commit(targets.reduce((acc, shape) => replaceShape(acc, shape.id, shape.kind === 'leader' ? { ...shape, fontSize: px } : withFontSize(shape, px)), scene))
  }

  function closeOnOutsideClick(event: MouseEvent): void {
    if (openPalette === null) return
    const target = event.target
    if (target instanceof Node) {
      if (colorTrigger.contains(target) || widthTrigger.contains(target)) return
      if (colorPopover.contains(target) || widthPopover.contains(target)) return
      if (sizePopover.contains(target) || shapeSizeButton.contains(target)) return
      if (textSizeButton?.contains(target)) return
    }
    closePalette()
  }

  function closeOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    closePalette()
  }

  function syncToolbar(): void {
    toolButtons.forEach((button, index) => markActive(button, EDITOR_TOOLS[index] === tool))
    colorItems.forEach((item, index) => markActive(item, COLOR_PRESETS[index] === scene.defaults.color))
    widthItems.forEach((item, index) => markActive(item, WIDTH_PRESETS[index] === scene.defaults.width))
    colorSwatch.style.background = scene.defaults.color
    widthTrigger.innerHTML = widthGlyph(scene.defaults.width)
    widthTrigger.title = `Thickness ${scene.defaults.width}px`
  }

  function markActive(button: HTMLButtonElement, active: boolean): void {
    button.dataset.active = active ? 'true' : 'false'
    button.setAttribute('aria-pressed', active ? 'true' : 'false')
  }

  function setTool(next: EditorTool): void {
    tool = next
    // Every tool has its own remembered color and thickness; the switch applies both to the scene defaults.
    scene = setDefaults(scene, { color: colors[next], width: widths[next] })
    // A tool switch acts on the canvas, not on the old selection, so it deselects.
    selectedIds = []
    syncToolbar()
    redraw()
  }

  function setColor(hex: string): void {
    if (tool) colors[tool] = hex
    scene = setDefaults(scene, { color: hex })
    syncToolbar()
    redraw()
  }

  function setWidth(px: number): void {
    if (tool) widths[tool] = px
    scene = setDefaults(scene, { width: px })
    syncToolbar()
    redraw()
  }

  function undo(): void {
    const previous = history.undo()
    if (!previous) return
    // Colors and thickness live in UI state, not in the snapshot stack: a restored scene keeps the active tool's values.
    scene = tool ? setDefaults(previous, { color: colors[tool], width: widths[tool] }) : previous
    // Undo rewrites the scene, so ids that may no longer exist are dropped.
    selectedIds = []
    redraw()
  }

  function exportPng(): Promise<Blob> {
    return imageReady.then(() => renderPng(img, scene))
  }

  function debugState(): EditorDebugState {
    return {
      tool,
      color: scene.defaults.color,
      width: scene.defaults.width,
      shapeCount: scene.shapes.length,
      selectedId: selectedIds[0] ?? null,
      selectedIds,
      scale: view.scale,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
      transforms: scene.shapes.map((shape) => shape.transform),
      kinds: scene.shapes.map((shape) => shape.kind),
      texts: scene.shapes.flatMap((shape) => (shape.kind === 'text' || shape.kind === 'speech' || shape.kind === 'leader' ? [{ text: shape.text, fontSize: shape.fontSize }] : [])),
    }
  }

  window.addEventListener('resize', redraw)
  document.addEventListener('click', closeOnOutsideClick)
  window.addEventListener('keydown', closeOnEscape)
  syncToolbar()
  redraw()

  return {
    setTool,
    setColor,
    setWidth,
    undo,
    exportPng,
    debugState,
    dispose: () => {
      window.removeEventListener('resize', redraw)
      document.removeEventListener('click', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
      detachInput()
      closeTextInput()
      URL.revokeObjectURL(objectUrl)
      root.remove()
      style.remove()
    },
  }
}
