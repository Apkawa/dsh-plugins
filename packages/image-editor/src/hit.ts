import { LEADER_DOT_RADIUS_FACTOR, LEADER_LABEL_GAP, leaderShelfSpan, textExtent } from './scene.ts'
import { ROTATE_HANDLE_GAP, handlePoints, localToWorld, worldToLocal } from './transform.ts'
import type { Handle, HandleId } from './transform.ts'
import type { EditorTool, Point, Shape, Transform } from './scene.ts'

export type ShapeHit = { id: string; kind: EditorTool }

/**
 * Hit test in bbox-local space: the world point is inverse-rotated first, so a
 * rotated shape is tested against its own unrotated geometry. `tolerance` is
 * what keeps zero-size shapes selectable.
 */
export function hitShape(shape: Shape, worldPoint: Point, tolerance: number): ShapeHit | null {
  if (!shapeHitInLocal(shape, worldToLocal(shape.transform, worldPoint), tolerance)) return null
  return { id: shape.id, kind: shape.kind }
}

/** Nearest handle within `radius`, so overlapping handles resolve to one hit. */
export function hitHandle(shape: Shape, worldPoint: Point, radius: number): HandleId | null {
  const handles = handlePoints(shape, ROTATE_HANDLE_GAP)
  const nearby = handles.filter((handle) => distance(handle.point, worldPoint) <= radius)
  return nearest(nearby, worldPoint)?.id ?? null
}

/** Topmost = last in the scene array. */
export function topShapeAt(shapes: readonly Shape[], worldPoint: Point, tolerance: number): ShapeHit | null {
  return shapes
    .flatMap((shape) => {
      const hit = hitShape(shape, worldPoint, tolerance)
      return hit ? [hit] : []
    })
    .at(-1) ?? null
}

/**
 * Shapes a rubber band catches: intersection of axis-aligned boxes, touching edges
 * count. A rotated shape contributes the box of its rotated corners, so the rule is
 * conservative for tilted strokes — the band catches the footprint, not the stroke.
 */
export function shapesWithin(shapes: readonly Shape[], rect: Transform): Shape[] {
  const band = boundsOf(rect)
  return shapes.filter((shape) => {
    const box = boundsOf(shape.transform)
    return box.minX <= band.maxX && box.maxX >= band.minX && box.minY <= band.maxY && box.maxY >= band.minY
  })
}

/** Axis-aligned world box of a transform's corners, rotation included. */
function boundsOf(transform: Transform): { minX: number; minY: number; maxX: number; maxY: number } {
  // Corners are bbox-local — payloads are origin-relative — so they are mapped out
  // through localToWorld, exactly like the handle points.
  const corners = [
    { x: 0, y: 0 },
    { x: transform.w, y: 0 },
    { x: transform.w, y: transform.h },
    { x: 0, y: transform.h },
  ].map((corner) => localToWorld(transform, corner))
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function shapeHitInLocal(shape: Shape, local: Point, tolerance: number): boolean {
  if (shape.kind === 'arrow') {
    const from = tupleToPoint(shape.from)
    const to = tupleToPoint(shape.to)
    // The head points at the drag origin: the hittable segment starts at its tip, one width
    // past `from` pointing away from `to`. A degenerate arrow keeps its dot guard: the clamp
    // below keeps u finite, and the collapsed segment hits as a dot in segmentDistance.
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.max(Math.hypot(dx, dy), 1)
    const tip = { x: from.x - dx / length * shape.width, y: from.y - dy / length * shape.width }
    return segmentDistance(tip, to, local) <= shape.width / 2 + tolerance
  }
  if (shape.kind === 'marker' || shape.kind === 'highlighter') {
    return polylineHit(shape.points, local, Math.max(shape.width / 2, tolerance))
  }
  // The step is the inscribed circle, not its bbox: corners the badge does not cover miss.
  if (shape.kind === 'step') {
    const { w, h } = shape.transform
    return distance({ x: w / 2, y: h / 2 }, local) <= Math.min(w, h) / 2 + tolerance
  }
  // The balloon is its ellipse plus the tail to the tip, which may sit outside the bbox.
  if (shape.kind === 'speech') {
    const { w, h } = shape.transform
    const center = { x: w / 2, y: h / 2 }
    if (w <= 0 || h <= 0) return distance(center, local) <= tolerance
    const nx = (local.x - center.x) / (w / 2 + tolerance)
    const ny = (local.y - center.y) / (h / 2 + tolerance)
    if (nx * nx + ny * ny <= 1) return true
    return segmentDistance(tailEdge(center, w / 2, h / 2, shape.anchor), shape.anchor, local) <= shape.width / 2 + tolerance
  }
  // The callout is its dot, shaft and label band — not its bbox: a corner none of them covers misses.
  if (shape.kind === 'leader') {
    const dot = tupleToPoint(shape.from)
    const shelf = tupleToPoint(shape.to)
    if (distance(dot, local) <= shape.width * LEADER_DOT_RADIUS_FACTOR + tolerance) return true
    if (segmentDistance(dot, shelf, local) <= shape.width / 2 + tolerance) return true
    const span = leaderShelfSpan(shape.from, shape.to)
    const extent = textExtent(shape.text, shape.fontSize)
    // The band is the one the renderer paints: the label block is vertically centered on the
    // shelf line; in x it follows the shifted label ink — starting LEADER_LABEL_GAP past the far
    // tip and running the label's width — while the near side keeps the shelf's own end.
    const inkEdge = extent.w + LEADER_LABEL_GAP
    const xMin = span.x1 > shelf.x ? span.x0 : span.x0 - inkEdge
    const xMax = span.x1 > shelf.x ? span.x1 + inkEdge : span.x1
    const yTop = span.y - extent.h / 2
    const yBottom = span.y + extent.h / 2
    return local.x >= xMin - tolerance && local.x <= xMax + tolerance
      && local.y >= yTop - tolerance
      && local.y <= yBottom + tolerance
  }
  const { w, h } = shape.transform
  return local.x >= -tolerance && local.x <= w + tolerance && local.y >= -tolerance && local.y <= h + tolerance
}

/** Where the tail meets the balloon: the ellipse edge on the center→tip ray, in bbox-local space. */
function tailEdge(center: Point, rx: number, ry: number, anchor: Point): Point {
  const dx = anchor.x - center.x
  const dy = anchor.y - center.y
  const length = Math.hypot(dx, dy)
  // A tip at the balloon center has no direction: the tail collapses to the center.
  if (length === 0) return center
  const ux = dx / length
  const uy = dy / length
  const t = 1 / Math.hypot(ux / rx, uy / ry)
  return { x: center.x + ux * t, y: center.y + uy * t }
}

function polylineHit(points: number[], local: Point, limit: number): boolean {
  const segments = segmentsOf(points)
  // A single-point gesture has no segment: hit it as a dot instead.
  if (segments.length === 0) return distance(tupleToPoint(points), local) <= limit
  return segments.some(([from, to]) => segmentDistance(from, to, local) <= limit)
}

function segmentsOf(points: number[]): Array<[Point, Point]> {
  return points
    .map((_, index) => pairAt(points, index))
    .filter((segment): segment is [Point, Point] => segment !== null)
}

function pairAt(points: number[], index: number): [Point, Point] | null {
  const x1 = points[index]
  const y1 = points[index + 1]
  const x2 = points[index + 2]
  const y2 = points[index + 3]
  if (index % 2 !== 0 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null
  return [{ x: x1, y: y1 }, { x: x2, y: y2 }]
}

function segmentDistance(from: Point, to: Point, point: Point): number {
  const vx = to.x - from.x
  const vy = to.y - from.y
  const lengthSq = vx * vx + vy * vy
  // A degenerate segment is a dot, so a zero-size arrow stays hittable by tolerance.
  if (lengthSq === 0) return distance(from, point)
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * vx + (point.y - from.y) * vy) / lengthSq))
  return distance({ x: from.x + t * vx, y: from.y + t * vy }, point)
}

function nearest(handles: Handle[], point: Point): Handle | undefined {
  return handles.sort((a, b) => distance(a.point, point) - distance(b.point, point))[0]
}

function tupleToPoint(tuple: readonly number[]): Point {
  return { x: tuple[0] ?? 0, y: tuple[1] ?? 0 }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
