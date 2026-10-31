import { LEADER_DOT_RADIUS_FACTOR, LEADER_LABEL_GAP, LINE_HEIGHT, leaderShelfSpan, replaceShape, textExtent } from './scene.ts'
import { ROTATE_HANDLE_GAP, handlePoints, localToWorld } from './transform.ts'
import type { Point, Scene, Shape, Transform } from './scene.ts'
import type { View } from './view.ts'

/** Anything `ctx.drawImage` accepts: the loaded `<img>`, an OffscreenCanvas, another canvas. */
export type ImageSource = CanvasImageSource

export const OVERLAY_COLOR = '#5B6268'
export const HANDLE_COLOR = '#1A1A1A'
/** The white ring every bbox handle mark carries, so dark marks stay readable on dark art. */
const HANDLE_OUTLINE = '#FFFFFF'
const HANDLE_SIZE = 4
const ROTATE_SIZE = 5
/** Half-angle spread of a balloon tail, as a tangent: ~19°, wide enough to read at any zoom. */
const TAIL_SPREAD = 0.35

/**
 * Draws the base image and every shape through `view`, plus the selection
 * overlay and — while a rubber band drag is running — the band itself. Every
 * selected shape gets a dashed bbox; resize, center and rotate handles appear only for a
 * lone selection, because handles on several shapes would fight each other.
 * The outline and band are stroked in `selectionColor` so the highlight follows
 * the active tool's color; the handle marks stay in `HANDLE_COLOR` with a white
 * ring for contrast against any outline color.
 * The caller owns the canvas transform: apply the DPR transform before
 * this call (`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`) and the view is composed
 * on top of it in CSS pixels.
 *
 * Returns a new scene when the renderer measures text wider/narrower than the
 * tool's estimate, otherwise null. The caller adopts the returned scene without
 * pushing it to history — measurement is a correction, not an edit.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  image: ImageSource,
  view: View,
  selectedIds: readonly string[] = [],
  marquee?: Transform,
  selectionColor: string = OVERLAY_COLOR,
): Scene | null {
  ctx.save()
  clearCanvas(ctx)
  ctx.translate(view.offsetX, view.offsetY)
  ctx.scale(view.scale, view.scale)
  ctx.drawImage(image, 0, 0)
  // Step digits are scene-order badges, so the numbering is derived here rather than stored.
  const stepIds = scene.shapes.flatMap((shape) => (shape.kind === 'step' ? [shape.id] : []))
  const resized = scene.shapes.flatMap((shape) => {
    const measured = drawShape(ctx, shape, stepIds.indexOf(shape.id) + 1)
    return measured ? [measured] : []
  })
  const selected = scene.shapes.filter((shape) => selectedIds.includes(shape.id))
  const only = selected.length === 1 ? selected[0] : undefined
  // A lone arrow or callout is edited through its endpoint marks, so it draws no dashed bbox;
  // inside a multi-selection every kind — endpoint kinds included — keeps the outline.
  selected.forEach((shape) => {
    if (shape === only && (shape.kind === 'arrow' || shape.kind === 'leader')) return
    drawBbox(ctx, shape, view, selectionColor)
  })
  if (only) drawHandles(ctx, only, view)
  if (marquee) drawMarquee(ctx, marquee, view, selectionColor)
  ctx.restore()
  if (resized.length === 0) return null
  return resized.reduce((acc, update) => replaceShape(acc, update.shape.id, { ...update.shape, transform: update.transform }), scene)
}

/** DPR-aware canvas sizing: backing store in device pixels, layout in CSS pixels. */
export function resizeCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, dpr: number): void {
  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = Math.round(cssHeight * dpr)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
}

function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

/** Draws one shape in bbox-local space; text measurement returns a corrected transform. */
function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, stepDigit: number): { shape: Shape; transform: Transform } | null {
  const transform = shape.transform
  ctx.save()
  ctx.globalAlpha = shape.opacity
  ctx.strokeStyle = shape.color
  ctx.fillStyle = shape.color
  ctx.lineWidth = shape.width
  ctx.translate(transform.x + transform.w / 2, transform.y + transform.h / 2)
  ctx.rotate(transform.rotation)
  ctx.translate(-transform.w / 2, -transform.h / 2)
  if (shape.kind === 'rect') drawRect(ctx, shape)
  else if (shape.kind === 'step') drawStep(ctx, shape, stepDigit)
  else if (shape.kind === 'speech') drawSpeech(ctx, shape)
  else if (shape.kind === 'leader') drawLeader(ctx, shape)
  else if (shape.kind === 'text') return drawText(ctx, shape)
  else drawStroke(ctx, shape)
  ctx.restore()
  return null
}

/**
 * Step-style outline for rect, arrow and leader: the shape's geometry stroked white at
 * width + 4 carrying the badge's dark shadow, before its colored pass. `ctx.restore` is a
 * no-op in the unit fake ctx, so the reset below — not a restore — is what keeps the colored
 * pass shadowless; a real ctx lands on the same state either way.
 */
function haloPass(ctx: CanvasRenderingContext2D, shape: Shape, paint: () => void): void {
  ctx.shadowColor = 'rgba(26,26,26,0.35)'
  ctx.shadowBlur = Math.max(4, shape.width)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = shape.width + 4
  paint()
  ctx.shadowBlur = 0
  ctx.strokeStyle = shape.color
  ctx.lineWidth = shape.width
}

function drawRect(ctx: CanvasRenderingContext2D, shape: Shape & { kind: 'rect' }): void {
  // The white halo precedes the body: fill lands between the halo strokeRect and the colored one.
  haloPass(ctx, shape, () => ctx.strokeRect(0, 0, shape.transform.w, shape.transform.h))
  if (shape.fill) {
    ctx.fillStyle = shape.fill
    ctx.fillRect(0, 0, shape.transform.w, shape.transform.h)
    ctx.fillStyle = shape.color
  }
  ctx.strokeRect(0, 0, shape.transform.w, shape.transform.h)
}

/**
 * Step badge: the circle inscribed in the bbox, filled in the shape color, edged in
 * white and shadowed. `ctx.save`/`restore` scopes the shadow, so the digit paints
 * without one. `digit` is the shape's position among the scene's steps. The digit ink
 * follows the badge fill's luminance: dark ink on a light fill, white otherwise, so a
 * white badge no longer carries white-on-white digits.
 */
function drawStep(ctx: CanvasRenderingContext2D, shape: Shape & { kind: 'step' }, digit: number): void {
  const { w, h } = shape.transform
  const radius = Math.min(w, h) / 2
  const center = { x: w / 2, y: h / 2 }
  ctx.save()
  ctx.shadowColor = 'rgba(26, 26, 26, 0.35)'
  ctx.shadowBlur = Math.max(4, radius / 2)
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
  ctx.fillStyle = shape.color
  ctx.fill()
  ctx.strokeStyle = '#FFFFFF'
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = isLightHex(shape.color) ? '#1a1a1a' : '#FFFFFF'
  ctx.font = `${Math.min(w, h) * 0.5}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(digit), center.x, center.y)
}

/**
 * Relative luminance of a `#rrggbb` fill, sRGB-linearized per channel: light enough
 * (L > 0.55) that white digit ink would vanish against it. A color that is not a
 * 6-digit hex lands on NaN and stays dark, keeping the white digit.
 */
function isLightHex(hex: string): boolean {
  const channel = (offset: number) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > 0.55
}

/**
 * Speech balloon: the ellipse filling the bbox, painted in the shape color and edged in
 * white like a step badge, plus a two-line tail converging on the tip — the tip may sit
 * outside the bbox, so the tail is stroked from the ellipse edge to it. The label is
 * painted white around the bbox center. The balloon is never measured: its bbox is the
 * shape, so `drawShape` reports no correction for it.
 */
function drawSpeech(ctx: CanvasRenderingContext2D, shape: Shape & { kind: 'speech' }): void {
  const { w, h } = shape.transform
  const center = { x: w / 2, y: h / 2 }
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, w / 2, h / 2, 0, 0, Math.PI * 2)
  ctx.fillStyle = shape.color
  ctx.fill()
  ctx.strokeStyle = '#FFFFFF'
  ctx.stroke()
  ctx.strokeStyle = shape.color
  ctx.beginPath()
  tailEdges(center, w / 2, h / 2, shape.anchor).forEach((edge) => {
    ctx.moveTo(edge.x, edge.y)
    ctx.lineTo(shape.anchor.x, shape.anchor.y)
  })
  ctx.stroke()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `${shape.fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = shape.text.split('\n')
  lines.forEach((line, index) => {
    ctx.fillText(line, center.x, center.y + (index - (lines.length - 1) / 2) * shape.fontSize * LINE_HEIGHT)
  })
}

/**
 * Callout: a filled dot at `from` (thicker than the shaft), a shaft stroked to `to`, a fixed-length
 * horizontal shelf running from `to` away from the shaft and the label in the shape's own color
 * past the shelf's far tip — starting `LEADER_LABEL_GAP` beyond it, aligned outward, vertically
 * centered on the shelf line, so the label never overlaps the shelf's ink — ink, not a badge,
 * so unlike the balloon nothing is painted
 * white. Endpoints are drawn as authored: the bbox transform stretches the whole callout on resize,
 * so hit and render keep agreeing on the same dot, shaft and shelf. Never measured — the box is the
 * shaft geometry, so `drawShape` reports no correction.
 */
function drawLeader(ctx: CanvasRenderingContext2D, shape: Shape & { kind: 'leader' }): void {
  const from = { x: shape.from[0], y: shape.from[1] }
  const to = { x: shape.to[0], y: shape.to[1] }
  const span = leaderShelfSpan(shape.from, shape.to)
  // Halo first: dot arc, shaft and shelf stroked white and shadowed, each ahead of its colored
  // counterpart. The label stays plain ink — the outline never reaches the text.
  haloPass(ctx, shape, () => {
    ctx.beginPath()
    ctx.arc(from.x, from.y, shape.width * LEADER_DOT_RADIUS_FACTOR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(span.x0, span.y)
    ctx.lineTo(span.x1, span.y)
    ctx.stroke()
  })
  ctx.beginPath()
  ctx.arc(from.x, from.y, shape.width * LEADER_DOT_RADIUS_FACTOR, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(span.x0, span.y)
  ctx.lineTo(span.x1, span.y)
  ctx.stroke()
  ctx.font = `${shape.fontSize}px sans-serif`
  ctx.textBaseline = 'top'
  // The label sits past the far tip with a gap and aligns outward against it, so the gap strip
  // stays bare and the ink never overlaps the shelf: a right drag starts at x1 + gap left-aligned,
  // a left drag starts at x0 - gap right-aligned.
  const anchor = span.x1 > to.x
    ? { x: span.x1 + LEADER_LABEL_GAP, textAlign: 'left' as const }
    : { x: span.x0 - LEADER_LABEL_GAP, textAlign: 'right' as const }
  ctx.textAlign = anchor.textAlign
  const lines = shape.text.split('\n')
  const band = textExtent(shape.text, shape.fontSize).h
  // The label block is vertically centered on the shelf line for any line count.
  const topY = span.y - band / 2
  lines.forEach((line, index) => ctx.fillText(line, anchor.x, topY + index * shape.fontSize * LINE_HEIGHT))
}

/**
 * The two ellipse-edge points the tail runs to, spread symmetrically around the
 * center→tip ray. A degenerate balloon or a tip at the center has no tail.
 */
function tailEdges(center: Point, rx: number, ry: number, anchor: Point): Point[] {
  if (rx <= 0 || ry <= 0) return []
  const dx = anchor.x - center.x
  const dy = anchor.y - center.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return []
  const ux = dx / length
  const uy = dy / length
  return [1, -1].flatMap((side) => {
    // Scaling absorbs the direction length: `k` puts the point exactly on the ellipse.
    const sx = ux - side * uy * TAIL_SPREAD
    const sy = uy + side * ux * TAIL_SPREAD
    const k = 1 / Math.hypot(sx / rx, sy / ry)
    return [{ x: center.x + sx * k, y: center.y + sy * k }]
  })
}

/**
 * One fillText per line, stacked by the line height. A label's bbox is fully
 * determined by its drawn text, so both axes are corrected: width from the
 * widest measured line, height from the line count.
 */
function drawText(ctx: CanvasRenderingContext2D, shape: Shape & { kind: 'text' }): { shape: Shape; transform: Transform } | null {
  ctx.font = `${shape.fontSize}px sans-serif`
  ctx.textBaseline = 'top'
  const lines = shape.text.split('\n')
  lines.forEach((line, index) => ctx.fillText(line, 0, index * shape.fontSize * LINE_HEIGHT))
  const width = lines.reduce((widest, current) => Math.max(widest, ctx.measureText(current).width), 0)
  const height = lines.length * shape.fontSize * LINE_HEIGHT
  ctx.restore()
  if (width === shape.transform.w && height === shape.transform.h) return null
  return { shape, transform: { ...shape.transform, w: width, h: height } }
}

/**
 * Marker/highlighter polylines and arrows stretch their payload through the
 * current bbox: payloads were authored at the bbox's original size, so the
 * payload extent is normalized into the bbox before stroking.
 */
function drawStroke(ctx: CanvasRenderingContext2D, shape: FreehandOrArrow): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const coords = stretch(shape.kind === 'arrow' ? [shape.from, shape.to] : pairsOf(shape.points), shape.transform)
  if (shape.kind === 'arrow') {
    // Halo before the color pass: shaft and head stroked white and shadowed. The head's white
    // stroke must precede the colored head fill, so the halo runs over both paths first.
    // Both head paths are built with the shaft's end first and the drag origin second, so the
    // head points at the pointerdown origin: its tip lands one width past `coords[0]`.
    haloPass(ctx, shape, () => {
      strokePolyline(ctx, coords)
      arrowHeadPath(ctx, coords.at(-1) ?? [0, 0], coords[0] ?? [0, 0], shape.width)
      ctx.stroke()
    })
  }
  strokePolyline(ctx, coords)
  if (shape.kind === 'arrow') {
    arrowHeadPath(ctx, coords.at(-1) ?? [0, 0], coords[0] ?? [0, 0], shape.width)
    ctx.fill()
  }
}

/** Round-cap polyline through the stretched coordinates, stroked as it stands. */
function strokePolyline(ctx: CanvasRenderingContext2D, coords: Array<[number, number]>): void {
  ctx.beginPath()
  coords.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.stroke()
}

/**
 * The head triangle as a path only — stroked white for the halo, filled in color afterwards.
 * The caller passes the drag origin as `to`, so the head points at the pointerdown end.
 */
function arrowHeadPath(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], width: number): void {
  // The shaft's round cap sticks width/2 past its end point, so the head is shifted one
  // width forward along the shaft: its base lands at to - 2*width and its tip at to + width,
  // which covers the cap. Same head size as before — only the placement moves.
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.max(Math.hypot(dx, dy), 1)
  const ux = dx / length
  const uy = dy / length
  const tipX = to[0] + ux * width
  const tipY = to[1] + uy * width
  const baseX = tipX - ux * width * 3
  const baseY = tipY - uy * width * 3
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(baseX - uy * width * 2, baseY + ux * width * 2)
  ctx.lineTo(baseX + uy * width * 2, baseY - ux * width * 2)
  ctx.closePath()
}

function stretch(coords: Array<readonly [number, number]>, transform: Transform): Array<[number, number]> {
  // Slot 0 is x and slot 1 is y: reading y from slot 0 would scale the vertical
  // extent by h/w and squash any stroke whose bbox is wider than it is tall.
  const xs = coords.map(([x]) => x)
  const ys = coords.map(([, y]) => y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  const sx = spanX > 0 ? transform.w / spanX : 1
  const sy = spanY > 0 ? transform.h / spanY : 1
  return coords.map(([x, y]) => [x * sx, y * sy])
}

/** Flat x,y payload slots → coordinate pairs; a dangling odd slot pairs with 0. */
function pairsOf(points: number[]): Array<[number, number]> {
  const xs = points.filter((_, index) => index % 2 === 0)
  const ys = points.filter((_, index) => index % 2 === 1)
  return xs.map((x, index) => [x, ys[index] ?? 0])
}

/** Dashed bbox of a selected shape, following its rotation and the selection color. */
function drawBbox(ctx: CanvasRenderingContext2D, shape: Shape, view: View, color: string): void {
  // Corners come straight from the transform, not from `handlePoints`: endpoint kinds have no
  // bbox handles, yet a multi-selection still outlines them.
  const corners = [
    { x: 0, y: 0 },
    { x: shape.transform.w, y: 0 },
    { x: shape.transform.w, y: shape.transform.h },
    { x: 0, y: shape.transform.h },
  ].map((corner) => localToWorld(shape.transform, corner))
  ctx.save()
  overlayStyle(ctx, view, color)
  ctx.beginPath()
  corners.forEach((corner, index) => (index === 0 ? ctx.moveTo(corner.x, corner.y) : ctx.lineTo(corner.x, corner.y)))
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/** Handles for a lone selection: outlined slot circles, an outlined center square and an outlined rotate circle, or bare endpoint marks for an arrow or callout. */
function drawHandles(ctx: CanvasRenderingContext2D, shape: Shape, view: View): void {
  ctx.save()
  ctx.fillStyle = HANDLE_COLOR
  const radius = HANDLE_SIZE / view.scale
  if (shape.kind === 'arrow' || shape.kind === 'leader') {
    // Endpoint marks, never an outline or a rotate circle: the shape's own stroke stays the last stroke.
    handlePoints(shape, ROTATE_HANDLE_GAP).forEach((handle) => {
      if (handle.id === 'center') {
        ctx.fillRect(handle.point.x - radius, handle.point.y - radius, radius * 2, radius * 2)
        return
      }
      ctx.beginPath()
      ctx.arc(handle.point.x, handle.point.y, radius, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.restore()
    return
  }
  // Slot circles keep the squares' radius, so the grab footprint is unchanged; outlines are
  // solid hairlines stroked right after each mark, so the whites end the stroke order.
  ctx.strokeStyle = HANDLE_OUTLINE
  ctx.lineWidth = 1 / view.scale
  handlePoints(shape, ROTATE_HANDLE_GAP).forEach((handle) => {
    if (handle.id === 'center') {
      ctx.fillRect(handle.point.x - radius, handle.point.y - radius, radius * 2, radius * 2)
      ctx.strokeRect(handle.point.x - radius, handle.point.y - radius, radius * 2, radius * 2)
      return
    }
    ctx.beginPath()
    ctx.arc(handle.point.x, handle.point.y, (handle.id === 'rotate' ? ROTATE_SIZE : HANDLE_SIZE) / view.scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  })
  ctx.restore()
}

/** The live rubber band, in world space, dashed like the selection bbox. */
function drawMarquee(ctx: CanvasRenderingContext2D, rect: Transform, view: View, color: string): void {
  ctx.save()
  overlayStyle(ctx, view, color)
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
  ctx.restore()
}

/** Thin dashed overlay stroke, sized in world units so it stays hairline at any zoom. */
function overlayStyle(ctx: CanvasRenderingContext2D, view: View, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1 / view.scale
  ctx.setLineDash([6 / view.scale, 4 / view.scale])
}

type FreehandOrArrow = Extract<Shape, { kind: 'marker' | 'highlighter' | 'arrow' }>
