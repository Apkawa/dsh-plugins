import type { Point } from './scene.ts'

/** View state mapping world (image) coordinates to screen pixels: screen = world * scale + offset. */
export type View = { scale: number; offsetX: number; offsetY: number }

export type Viewport = { width: number; height: number }

/** A pixel box used for both the viewport and the image's natural size. */
export type ViewBounds = { viewport: Viewport; image: Viewport }

export const MIN_SCALE = 0.1
export const MAX_SCALE = 8

/** Identity view for a viewport: the viewport's top-left maps onto the world origin at scale 1. */
export function createView(_viewport: Viewport): View {
  return { scale: 1, offsetX: 0, offsetY: 0 }
}

/** Zoom around a screen point so the world point under it stays pinned, clamped to the image. */
export function zoomAt(view: View, screenPoint: Point, factor: number, bounds: ViewBounds): View {
  const scale = clamp(view.scale * factor)
  const world = screenToWorld(view, screenPoint)
  return clampView({ scale, offsetX: screenPoint.x - world.x * scale, offsetY: screenPoint.y - world.y * scale }, bounds.viewport, bounds.image)
}

/** Shift the view by screen-space deltas, clamped to the image. */
export function pan(view: View, dx: number, dy: number, bounds: ViewBounds): View {
  return clampView({ ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy }, bounds.viewport, bounds.image)
}

/**
 * Offsets that keep the scaled image inside the viewport, so no drag or zoom can push the
 * picture out of view. An image with no size is left unclamped.
 */
export function clampView(view: View, viewport: Viewport, image: Viewport): View {
  if (image.width <= 0 || image.height <= 0) return view
  return { scale: view.scale, offsetX: clampAxis(view.offsetX, viewport.width, image.width * view.scale), offsetY: clampAxis(view.offsetY, viewport.height, image.height * view.scale) }
}

/**
 * One axis: the offset window is `[viewport - image, 0]` when the scaled image is larger
 * than the viewport (it must still cover the viewport) and `[0, viewport - image]` when it
 * is smaller (it must stay inside). Non-finite input collapses to 0 so no NaN offset can
 * leak into rendering.
 */
function clampAxis(offset: number, viewportSize: number, scaledSize: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(viewportSize) || !Number.isFinite(scaledSize)) return 0
  const edge = viewportSize - scaledSize
  return Math.max(Math.min(edge, 0), Math.min(Math.max(edge, 0), offset))
}

export function screenToWorld(view: View, screenPoint: Point): Point {
  return { x: (screenPoint.x - view.offsetX) / view.scale, y: (screenPoint.y - view.offsetY) / view.scale }
}

export function worldToScreen(view: View, point: Point): Point {
  return { x: point.x * view.scale + view.offsetX, y: point.y * view.scale + view.offsetY }
}

/**
 * Pins a world point to the image rectangle `[0, image.width] x [0, image.height]` (the image
 * is drawn at the world origin). Non-finite input collapses to 0 so no NaN can leak into a
 * gesture, and an image with no size pins every point to the origin.
 */
export function clampToWorld(point: Point, image: Viewport): Point {
  return { x: clampInsideImage(point.x, image.width), y: clampInsideImage(point.y, image.height) }
}

/** One axis of the image rectangle; a degenerate (non-finite or non-positive) size pins to 0. */
function clampInsideImage(value: number, size: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) return 0
  return Math.max(0, Math.min(size, value))
}

/** Largest scale that still fits a world box inside the viewport, centered. */
export function fitView(viewport: Viewport, worldWidth: number, worldHeight: number): View {
  if (worldWidth <= 0 || worldHeight <= 0) return createView(viewport)
  const scale = clamp(Math.min(viewport.width / worldWidth, viewport.height / worldHeight))
  return {
    scale,
    offsetX: (viewport.width - worldWidth * scale) / 2,
    offsetY: (viewport.height - worldHeight * scale) / 2,
  }
}

function clamp(scale: number): number {
  // A NaN factor must not leak through the bounds math.
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}
