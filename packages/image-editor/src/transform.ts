import { textExtent } from './scene.ts'
import type { ArrowShape, LeaderShape, Point, Shape, SpeechShape, TextShape, Transform } from './scene.ts'

/** Selection handles: eight bbox handles, a center square and the rotate handle above the top edge; arrows and callouts carry endpoint marks instead. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'end-start' | 'end-end' | 'center'

export type Handle = { id: HandleId; point: Point }

/** The eight bbox handles a resize gesture can grab; `rotate`, `center` and the endpoint marks are not resize handles. */
export type ResizeHandle = Exclude<HandleId, 'rotate' | 'end-start' | 'end-end' | 'center'>

/** Which payload endpoint an endpoint drag moves: `from` for a start drag, `to` for an end drag. */
export type EndpointEnd = 'start' | 'end'

/** Smallest bbox size; a resized shape must never degenerate to zero. */
export const MIN_SHAPE_SIZE = 4

/** Smallest font size a text drag may reach. */
const MIN_FONT_SIZE = 1

/** Distance from the top edge center to the rotate handle, in bbox-local units. */
export const ROTATE_HANDLE_GAP = 24

/**
 * Maps bbox-local payload coordinates into image space. Rotation is about the
 * bbox center, so the origin offset is folded in before the rotation.
 */
export function localToWorld(transform: Transform, point: Point): Point {
  const cx = transform.x + transform.w / 2
  const cy = transform.y + transform.h / 2
  const dx = point.x + transform.x - cx
  const dy = point.y + transform.y - cy
  return rotateVector(transform.rotation, dx, dy, cx, cy)
}

/** Inverse of `localToWorld`: a world point expressed in bbox-local payload coordinates. */
export function worldToLocal(transform: Transform, point: Point): Point {
  const cx = transform.x + transform.w / 2
  const cy = transform.y + transform.h / 2
  return rotateVector(-transform.rotation, point.x - cx, point.y - cy, transform.w / 2, transform.h / 2)
}

export function moveShape(shape: Shape, dx: number, dy: number): Shape {
  return { ...shape, transform: { ...shape.transform, x: shape.transform.x + dx, y: shape.transform.y + dy } }
}

/**
 * Stretches the bbox along its own axes and keeps the bbox point *opposite* the
 * grabbed handle — the corner or edge center the drag does not touch — at the
 * world position it had before the resize. `worldDelta` is image-space, so it is
 * rotated into local axes first — otherwise dragging a handle of a rotated shape
 * would stretch the wrong axis, and without the pinned opposite point a rotated
 * shape would slide as it resized. The payload stays untouched: the renderer
 * scales it through the transform. Text is the exception — it has no stretched
 * glyphs, so the dragged axis drives the font size instead, and the bbox scaled
 * by that ratio is pinned the same way.
 */
export function resizeShape(shape: Shape, handle: ResizeHandle, worldDelta: Point): Shape {
  const transform = shape.transform
  const dx = Math.cos(transform.rotation) * worldDelta.x + Math.sin(transform.rotation) * worldDelta.y
  const dy = -Math.sin(transform.rotation) * worldDelta.x + Math.cos(transform.rotation) * worldDelta.y
  const anchor = localToWorld(transform, anchorSlot(handle, transform.w, transform.h))
  if (shape.kind === 'text') return pinned(scaledToFont(shape, stretchedFontSize(shape, handle, dx, dy)), handle, anchor)
  return pinned({ ...shape, transform: stretch(transform, handle, dx, dy) }, handle, anchor)
}

/**
 * Text or balloon re-set to a new font size: the bbox follows the new text extent. A label
 * keeps its origin; a balloon keeps its *tip* in image space, so the box grows around the
 * tip instead of sliding. `resizeShape` re-pins the anchor afterwards.
 */
export function withFontSize(shape: TextShape | SpeechShape, fontSize: number): TextShape | SpeechShape {
  const extent = textExtent(shape.text, fontSize)
  if (shape.kind === 'speech') {
    // Anchor at the new bottom-center; the origin is the tip minus where the tip sits
    // in a box of the new size placed at origin, so the tip stays exactly where it was drawn.
    const anchor = { x: extent.w / 2, y: extent.h }
    const originToTip = localToWorld({ x: 0, y: 0, w: extent.w, h: extent.h, rotation: shape.transform.rotation }, anchor)
    const tip = localToWorld(shape.transform, shape.anchor)
    return { ...shape, fontSize, anchor, transform: { ...shape.transform, w: extent.w, h: extent.h, x: tip.x - originToTip.x, y: tip.y - originToTip.y } }
  }
  return { ...shape, fontSize, transform: { ...shape.transform, w: extent.w, h: extent.h } }
}

export function rotateShape(shape: Shape, angleDelta: number): Shape {
  const rotation = normalizeAngle(shape.transform.rotation + angleDelta)
  return { ...shape, transform: { ...shape.transform, rotation } }
}

/** The eight bbox handles, a center square and the rotate handle, in world space; arrows and callouts get endpoint marks instead. */
export function handlePoints(shape: Shape, rotateGap: number): Handle[] {
  const transform = shape.transform
  if (shape.kind === 'arrow' || shape.kind === 'leader') return endpointHandles(shape)
  return handleSlots(transform.w, transform.h, rotateGap).map(([id, x, y]) => ({
    id,
    point: localToWorld(transform, { x, y }),
  }))
}

/** Rotate hover glyph: a circular arrow on a dark disc, ~16px — a data URI so the bundle needs no cursor asset. */
const ROTATE_CURSOR_GLYPH = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#1A1A1A"/><path d="M13 8a5 5 0 1 1-1.59-3.66" fill="none" stroke="#E8E8E8" stroke-width="1.5" stroke-linecap="round"/><path d="M12.1 6.7L11.41 4.34L13.85 4.9" fill="none" stroke="#E8E8E8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** Hover cursor for a handle id, fed to the canvas by the input layer: slots grab, axes resize along their own axis, the center moves the shape, rotate an inline SVG grab cursor. */
export function cursorFor(handleId: HandleId): string {
  if (handleId === 'center') return 'move'
  if (handleId === 'e' || handleId === 'w') return 'col-resize'
  if (handleId === 'n' || handleId === 's') return 'row-resize'
  if (handleId === 'rotate') return `url("data:image/svg+xml,${encodeURIComponent(ROTATE_CURSOR_GLYPH)}") 8 8, grab`
  return 'pointer'
}

/**
 * Endpoint marks of an arrow or callout, in world space, in drag order: dots on the two
 * payload ends, then the draggable center at the bbox center. The rotation never moves the
 * center — it is the pivot — so mapping it through the transform is exact even for a spun shape.
 */
function endpointHandles(shape: ArrowShape | LeaderShape): Handle[] {
  const transform = shape.transform
  return [
    { id: 'end-start', point: localToWorld(transform, endpointPoint(shape.from)) },
    { id: 'end-end', point: localToWorld(transform, endpointPoint(shape.to)) },
    { id: 'center', point: localToWorld(transform, { x: transform.w / 2, y: transform.h / 2 }) },
  ]
}

/**
 * Drags one endpoint of an arrow or callout onto `worldPoint`, exactly. The untouched end keeps
 * the world position it had before the drag — read through the current transform, so a rotated
 * shape stays anchored where it was drawn — and the bbox is re-normalized over both ends:
 * axis-aligned, rotation reset to 0, payload locals re-derived from the new origin. Deliberately
 * no MIN_SHAPE_SIZE clamp: dragging an end onto the other end collapses the span to zero, which
 * both kinds draw and hit as a dot.
 */
export function editEndpoint(shape: ArrowShape | LeaderShape, end: EndpointEnd, worldPoint: Point): ArrowShape | LeaderShape {
  const heldWorld = localToWorld(shape.transform, endpointPoint(end === 'start' ? shape.to : shape.from))
  const fromWorld = end === 'start' ? worldPoint : heldWorld
  const toWorld = end === 'start' ? heldWorld : worldPoint
  const x = Math.min(fromWorld.x, toWorld.x)
  const y = Math.min(fromWorld.y, toWorld.y)
  return {
    ...shape,
    transform: { x, y, w: Math.max(fromWorld.x, toWorld.x) - x, h: Math.max(fromWorld.y, toWorld.y) - y, rotation: 0 },
    from: [fromWorld.x - x, fromWorld.y - y],
    to: [toWorld.x - x, toWorld.y - y],
  }
}

function endpointPoint(tuple: readonly [number, number]): Point {
  return { x: tuple[0], y: tuple[1] }
}

function handleSlots(w: number, h: number, rotateGap: number): Array<[HandleId, number, number]> {
  return [
    ['nw', 0, 0],
    ['n', w / 2, 0],
    ['ne', w, 0],
    ['e', w, h / 2],
    ['se', w, h],
    ['s', w / 2, h],
    ['sw', 0, h],
    ['w', 0, h / 2],
    ['center', w / 2, h / 2],
    ['rotate', w / 2, -rotateGap],
  ]
}

/**
 * The bbox point opposite a grabbed handle: corners mirror to the far corner,
 * edges mirror to the far edge center. That point is the resize anchor.
 */
function anchorSlot(handle: ResizeHandle, w: number, h: number): Point {
  const west = handle === 'nw' || handle === 'w' || handle === 'sw'
  const east = handle === 'ne' || handle === 'e' || handle === 'se'
  const north = handle === 'nw' || handle === 'n' || handle === 'ne'
  const south = handle === 'sw' || handle === 's' || handle === 'se'
  return { x: east ? 0 : west ? w : w / 2, y: south ? 0 : north ? h : h / 2 }
}

/** Re-derives x/y so the anchor slot of the resized bbox lands back on `anchor`. */
function pinned(shape: Shape, handle: ResizeHandle, anchor: Point): Shape {
  const slot = anchorSlot(handle, shape.transform.w, shape.transform.h)
  const offset = rotateVector(shape.transform.rotation, slot.x - shape.transform.w / 2, slot.y - shape.transform.h / 2, 0, 0)
  return {
    ...shape,
    transform: {
      ...shape.transform,
      x: anchor.x - offset.x - shape.transform.w / 2,
      y: anchor.y - offset.y - shape.transform.h / 2,
    },
  }
}

/**
 * Text resized by a handle drag: the bbox scales by the font ratio rather than the extent
 * estimate. The renderer re-measures the drawn glyphs on every draw and writes the result
 * back into the scene, so an extent-sized bbox of a rotated label would be rewritten to the
 * measured width and drag the pinned anchor away.
 */
function scaledToFont(shape: TextShape, fontSize: number): TextShape {
  const ratio = fontSize / shape.fontSize
  return { ...shape, fontSize, transform: { ...shape.transform, w: shape.transform.w * ratio, h: shape.transform.h * ratio } }
}

function stretch(transform: Transform, handle: ResizeHandle, dx: number, dy: number): Transform {
  const west = handle === 'nw' || handle === 'w' || handle === 'sw'
  const east = handle === 'ne' || handle === 'e' || handle === 'se'
  const north = handle === 'nw' || handle === 'n' || handle === 'ne'
  const south = handle === 'sw' || handle === 's' || handle === 'se'
  // The clamp keeps a shape from degenerating; `pinned` puts the far edge where the clamp left it.
  return {
    ...transform,
    w: Math.max(transform.w + (east ? dx : west ? -dx : 0), MIN_SHAPE_SIZE),
    h: Math.max(transform.h + (south ? dy : north ? -dy : 0), MIN_SHAPE_SIZE),
  }
}

/**
 * Font size implied by a handle drag: the dragged axis's stretch ratio times the
 * current size. Corner handles follow the horizontal axis, since a label grows
 * sideways with its glyphs rather than row by row.
 */
function stretchedFontSize(shape: TextShape, handle: ResizeHandle, dx: number, dy: number): number {
  const west = handle === 'nw' || handle === 'w' || handle === 'sw'
  const north = handle === 'nw' || handle === 'n' || handle === 'ne'
  const sideways = handle === 'nw' || handle === 'ne' || handle === 'e' || handle === 'w'
  const axis = sideways ? shape.transform.w + (west ? -dx : dx) : shape.transform.h + (north ? -dy : dy)
  const base = Math.max(sideways ? shape.transform.w : shape.transform.h, MIN_SHAPE_SIZE)
  return Math.max((Math.max(axis, MIN_SHAPE_SIZE) / base) * shape.fontSize, MIN_FONT_SIZE)
}

function rotateVector(rotation: number, dx: number, dy: number, ox: number, oy: number): Point {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: ox + cos * dx - sin * dy, y: oy + sin * dx + cos * dy }
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2)
  if (wrapped > Math.PI) return wrapped - Math.PI * 2
  if (wrapped <= -Math.PI) return wrapped + Math.PI * 2
  return wrapped
}
