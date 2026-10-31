import { hitHandle, hitShape, shapesWithin, topShapeAt } from './hit.ts'
import { addShape, removeShape, replaceShape, shapeOf } from './scene.ts'
import { toolRegistry } from './tools.ts'
import { cursorFor, editEndpoint, localToWorld, moveShape, resizeShape, rotateShape } from './transform.ts'
import { clampToWorld, pan, screenToWorld, zoomAt } from './view.ts'
import type { EndpointEnd, HandleId, ResizeHandle } from './transform.ts'
import type { EditorTool, Point, Scene, SceneDefaults, Shape, Transform } from './scene.ts'
import type { Gesture } from './tools.ts'
import type { View, ViewBounds } from './view.ts'

/** Everything the gesture layer needs from the host; all editing goes through it. */
export type InputApi = {
  scene(): Scene
  view(): View
  viewBounds(): ViewBounds
  tool(): EditorTool | null
  defaults(): SceneDefaults
  selectedIds(): readonly string[]
  setView(view: View): void
  select(ids: readonly string[]): void
  /** The rubber band currently being dragged, or null once the gesture ends. */
  marquee(rect: Transform | null): void
  preview(scene: Scene): void
  commit(scene: Scene): void
  undo(): void
  /** Opens the editing field at `anchor`; `id` edits an existing label in place. */
  editText(anchor: Point, id?: string): void
  /** Sets the canvas CSS cursor; an empty string restores the plain default. */
  setCursor(css: string): void
}

const PRIMARY_BUTTON = 0
const PAN_BUTTON = 1
const HANDLE_HIT_PX = 12
const SHAPE_HIT_PX = 8
const WHEEL_ZOOM_BASE = 1.2

/**
 * Wires pointer/wheel/keyboard gestures onto the canvas. All math happens in the
 * pure modules; this layer only translates events into canvas-local screen and
 * world points and routes them to the api. Returns the detach function.
 */
export function attachInput(canvas: HTMLCanvasElement, api: InputApi): () => void {
  let mode: 'none' | 'pan' | 'draw' | 'move' | 'resize' | 'rotate' | 'endpoint' | 'text' | 'marquee' = 'none'
  /** Pointerdown position in canvas-local screen pixels; pan moves by screen deltas. */
  let origin: Point = { x: 0, y: 0 }
  /** View captured at pointerdown; every pan step is measured against it, never against the view it just moved. */
  let panBase: View | null = null
  let gesture: Gesture | null = null
  /** Shapes captured at pointerdown; a multi-selection drags all of them with one delta. */
  let dragBases: Shape[] = []
  let handleId: ResizeHandle | null = null
  /** Which payload endpoint the current endpoint drag moves; set when a dot is grabbed. */
  let endpointEnd: EndpointEnd | null = null
  let anchor: Point | null = null
  let previewId: string | null = null
  let dragged = false
  /** Shape a Ctrl press landed on while it was already selected; dropped when the press never dragged. */
  let pressToggle: string | null = null

  function onPointerDown(event: PointerEvent): void {
    const screen = screenPoint(event)
    origin = screen
    const world = screenToWorld(api.view(), screen)
    canvas.setPointerCapture(event.pointerId)
    if (event.button === PAN_BUTTON) {
      startPan()
      return
    }
    if (event.button !== PRIMARY_BUTTON) return
    const tool = api.tool()
    const modifier = event.ctrlKey || event.metaKey
    const selectedIds = api.selectedIds()
    // The Ctrl gate covers picking; operating an existing selection needs no tool or modifier,
    // so a shape picked by Ctrl stays resizable, movable and rotatable while a tool is active.
    const only = selectedIds.length === 1 ? selectedIds[0] : undefined
    const selected = only ? shapeOf(api.scene(), only) : undefined
    const handle = selected ? hitHandle(selected, world, HANDLE_HIT_PX / api.view().scale) : null
    if (selected && handle && handleGrabbable(selected, handle, world)) {
      // A dragless press on a mark of the selected shape is a click, exactly like a press on
      // its body: with Ctrl and a drawing tool it drops the shape instead of editing it.
      pressToggle = tool !== 'select' && modifier ? selected.id : null
      // Arrows and callouts are edited through their marks: a dot moves one endpoint, the
      // center square translates the whole shape. These kinds expose no rotate handle, so
      // rotation is unreachable for them — a press at the old rotate slot hits nothing.
      if (handle === 'end-start' || handle === 'end-end') {
        mode = 'endpoint'
        endpointEnd = handle === 'end-start' ? 'start' : 'end'
        dragBases = [selected]
        return
      }
      if (handle === 'center') {
        mode = 'move'
        dragBases = [selected]
        return
      }
      mode = handle === 'rotate' ? 'rotate' : 'resize'
      handleId = handle === 'rotate' ? null : handle
      dragBases = [selected]
      return
    }
    const hit = topShapeAt(api.scene().shapes, world, SHAPE_HIT_PX / api.view().scale)
    // A press on a shape that is already selected drags the whole selection under any tool; a
    // press on an unselected shape still needs select active or Ctrl/Cmd, or it paints below.
    if (hit && (selectedIds.includes(hit.id) || pickingAllowed(tool, modifier))) {
      mode = 'move'
      // A shape already in the selection keeps the whole selection and drags it; a Ctrl press
      // with a drawing tool adds the hit shape, so several can be gathered while drawing.
      const ids = pickedIds(tool, selectedIds, hit.id)
      // The toggle-off of a Ctrl press on an already selected shape is decided on release: a
      // dragless press is a click and drops it, a dragged one moves the whole selection.
      pressToggle = tool !== 'select' && modifier && selectedIds.includes(hit.id) ? hit.id : null
      api.select(ids)
      dragBases = api.scene().shapes.filter((shape) => ids.includes(shape.id))
      return
    }
    if (tool === 'select') {
      // A band has to start inside the picture; outside it there is nothing to catch.
      const image = api.viewBounds().image
      if (!(world.x >= 0 && world.x <= image.width && world.y >= 0 && world.y <= image.height)) return
      mode = 'marquee'
      api.marquee(dragRect(world))
      return
    }
    if (tool) {
      const image = api.viewBounds().image
      // A gesture outside the picture draws nothing the export can show — the PNG is the
      // image's natural size — so it never starts. NaN misses the rect on every comparison,
      // and an inert press leaves the selection alone.
      if (!(world.x >= 0 && world.x <= image.width && world.y >= 0 && world.y <= image.height)) return
      // Nothing was picked, so this press starts fresh work: the drawing gesture begins with
      // an empty selection, even when it landed on a shape that is already drawn.
      api.select([])
      const pinned = clampToWorld(world, image)
      // A label or a balloon is placed by a click: no drag, no preview. The point is the commit
      // anchor — a label's top-left corner, a balloon's tail tip.
      if (tool === 'text' || tool === 'speech') {
        mode = 'text'
        anchor = pinned
        return
      }
      mode = 'draw'
      gesture = toolRegistry[tool].begin(pinned, api.defaults())
      previewId = api.scene().nextId()
      api.preview(addShape(api.scene(), { ...gesture.finish(), id: previewId }))
      return
    }
    startPan()
  }

  function onPointerMove(event: PointerEvent): void {
    // Idle moves carry hover only: a running drag or band must never rewrite the cursor.
    if (mode === 'none') {
      hoverCursor(screenPoint(event))
      return
    }
    if (mode === 'pan') {
      if (!panBase) return
      const screen = screenPoint(event)
      api.setView(pan(panBase, screen.x - origin.x, screen.y - origin.y, api.viewBounds()))
      return
    }
    const world = screenToWorld(api.view(), screenPoint(event))
    if (mode === 'draw') {
      // Points of an in-progress gesture are pinned to the image, so a stroke, arrow or
      // box can never leave the picture even when the pointer wanders into the letterbox.
      gesture?.extend(clampToWorld(world, api.viewBounds().image))
      if (gesture && previewId) api.preview(replaceShape(api.scene(), previewId, { ...gesture.finish(), id: previewId }))
      return
    }
    if (mode === 'marquee') {
      api.marquee(dragRect(world))
      return
    }
    if (mode === 'text' || dragBases.length === 0) return
    dragged = true
    api.preview(dragBases.reduce((acc, shape) => replaceShape(acc, shape.id, draggedShape(shape, world)), api.scene()))
  }

  function onPointerUp(event: PointerEvent): void {
    canvas.releasePointerCapture(event.pointerId)
    if (mode === 'draw' && gesture) {
      api.commit(api.scene())
      // A callout is drawn first and labelled after: the field opens over the shelf end of the
      // shape just committed, so typing fills it in place — like a balloon opened at its tip.
      const drawn = previewId ? shapeOf(api.scene(), previewId) : undefined
      if (drawn?.kind === 'leader') api.editText(localToWorld(drawn.transform, { x: drawn.to[0], y: drawn.to[1] }), drawn.id)
    }
    if (mode === 'text' && anchor) api.editText(anchor)
    if (mode === 'marquee') {
      api.marquee(null)
      const band = dragRect(screenToWorld(api.view(), screenPoint(event)))
      // The release always rewrites the selection: crossed shapes become it, an empty band clears it.
      api.select(shapesWithin(api.scene().shapes, band).map((shape) => shape.id))
    }
    if ((mode === 'move' || mode === 'resize' || mode === 'rotate' || mode === 'endpoint') && dragged) api.commit(api.scene())
    // A dragless Ctrl press on a shape that was already selected is a click, on a mark or its body: it drops that shape.
    if (pressToggle && !dragged) api.select(api.selectedIds().filter((id) => id !== pressToggle))
    mode = 'none'
    gesture = null
    dragBases = []
    handleId = null
    endpointEnd = null
    anchor = null
    previewId = null
    dragged = false
    panBase = null
    pressToggle = null
    // A finished gesture gives the cursor back; the next idle move re-evaluates hover.
    api.setCursor('')
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    api.setView(zoomAt(api.view(), screenPoint(event), Math.pow(WHEEL_ZOOM_BASE, -event.deltaY / 100), api.viewBounds()))
    // A wheel that lands mid-pan re-bases the drag so the picture does not jump back.
    if (panBase) panBase = api.view()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      api.undo()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const ids = api.selectedIds()
      if (ids.length === 0) return
      api.commit(ids.reduce((acc, id) => removeShape(acc, id), api.scene()))
      api.select([])
      return
    }
    if (event.key === 'Escape') api.select([])
  }

  /** Opens the label or balloon under the pointer for editing, keeping its id so the commit replaces it. */
  function onDoubleClick(event: MouseEvent): void {
    if (!pickingAllowed(api.tool(), event.ctrlKey || event.metaKey)) return
    const hit = topShapeAt(api.scene().shapes, screenToWorld(api.view(), screenPoint(event)), SHAPE_HIT_PX / api.view().scale)
    if (!hit) return
    const label = shapeOf(api.scene(), hit.id)
    if (label?.kind !== 'text' && label?.kind !== 'speech' && label?.kind !== 'leader') return
    // A label or balloon re-edits at its top-left; a callout opens over its shelf, where its label sits.
    const labelAnchor = label.kind === 'leader' ? { x: label.to[0], y: label.to[1] } : { x: 0, y: 0 }
    api.select([hit.id])
    api.editText(localToWorld(label.transform, labelAnchor), hit.id)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('dblclick', onDoubleClick)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeyDown)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('dblclick', onDoubleClick)
    canvas.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKeyDown)
  }

  function screenPoint(event: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** Pan measures every move against the view captured here, so deltas never accumulate. */
  function startPan(): void {
    mode = 'pan'
    panBase = api.view()
  }

  /** Drag rect in world space, normalized so any drag direction yields a positive box. */
  function dragRect(now: Point): Transform {
    const start = screenToWorld(api.view(), origin)
    return {
      x: Math.min(start.x, now.x),
      y: Math.min(start.y, now.y),
      w: Math.abs(now.x - start.x),
      h: Math.abs(now.y - start.y),
      rotation: 0,
    }
  }

  /** World-space drag applied to the shape captured at pointerdown. */
  function draggedShape(base: Shape, world: Point): Shape {
    // An endpoint drag places the dot exactly at the pointer — no delta translation — and
    // re-normalizes the bbox over both ends, so the shape is flat again after the drag.
    if (mode === 'endpoint' && endpointEnd && (base.kind === 'arrow' || base.kind === 'leader')) return editEndpoint(base, endpointEnd, world)
    const start = screenToWorld(api.view(), origin)
    const dx = world.x - start.x
    const dy = world.y - start.y
    if (mode === 'rotate') {
      const cx = base.transform.x + base.transform.w / 2
      const cy = base.transform.y + base.transform.h / 2
      return rotateShape(base, Math.atan2(world.y - cy, world.x - cx) - Math.atan2(start.y - cy, start.x - cx))
    }
    if (mode === 'resize' && handleId) return resizeShape(base, handleId, { x: dx, y: dy })
    return moveShape(base, dx, dy)
  }

  /**
   * Edge handles (n/s/e/w) sit on the bbox sides, so a shape with no height — a perfectly
   * horizontal arrow — has them exactly on its stroke. There the stroke wins: an edge
   * handle is grabbed only when the pointer misses the stroke, otherwise grabbing the
   * shaft would resize (the MIN_SHAPE_SIZE clamp shifts the bbox) instead of move.
   * Corner handles, the rotate handle and the endpoint marks keep grab priority: the dots sit
   * on the payload ends and the center square on the shaft, so pressing them must edit or
   * translate, never drag the shape as a stroke.
   */
  function handleGrabbable(shape: Shape, handle: HandleId, world: Point): boolean {
    if (handle === 'n' || handle === 's' || handle === 'e' || handle === 'w') return hitShape(shape, world, SHAPE_HIT_PX / api.view().scale) === null
    return true
  }

  /** Hover cursor for a lone selection: the handle under the pointer paints its own cursor, any other idle point the plain default. */
  function hoverCursor(screen: Point): void {
    const ids = api.selectedIds()
    const only = ids.length === 1 ? ids[0] : undefined
    const selected = only ? shapeOf(api.scene(), only) : undefined
    const handle = selected ? hitHandle(selected, screenToWorld(api.view(), screen), HANDLE_HIT_PX / api.view().scale) : null
    api.setCursor(handle === null ? '' : cursorFor(handle))
  }
}

/**
 * Picking a shape that is not in the selection needs select active or Ctrl/Cmd held. Every other
 * tool paints instead, so a gesture can cross shapes that are already drawn.
 */
function pickingAllowed(tool: EditorTool | null, modifier: boolean): boolean {
  if (tool === 'select') return true
  return modifier
}

/** Selection after a shape press: select replaces it, a Ctrl press with a drawing tool adds the shape. */
function pickedIds(tool: EditorTool | null, selectedIds: readonly string[], hitId: string): readonly string[] {
  if (tool !== 'select') return selectedIds.includes(hitId) ? selectedIds : [...selectedIds, hitId]
  return selectedIds.includes(hitId) ? selectedIds : [hitId]
}
