import { describe, expect, it } from 'vitest'
import { MAX_SCALE, MIN_SCALE, clampView, clampToWorld, createView, fitView, pan, screenToWorld, worldToScreen, zoomAt } from '../../src/view.ts'

const viewport = { width: 400, height: 300 }

/** Image larger than the viewport on both axes: offsets are pinned to ≤ 0 and ≥ viewport - image. */
const oversized = { viewport, image: { width: 800, height: 600 } }
/** Image smaller than the viewport on both axes: offsets are pinned to ≥ 0 and ≤ viewport - image. */
const undersized = { viewport, image: { width: 200, height: 150 } }
/** Wider than the viewport but taller than it: the two clamp directions in one view. */
const straddling = { viewport, image: { width: 200, height: 600 } }

describe('createView', () => {
  it('starts at scale 1 with the viewport origin aligned to the world origin', () => {
    expect(createView(viewport)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })
  })
})

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const before = createView(viewport)
    const cursor = { x: 120, y: 80 }
    const after = zoomAt(before, cursor, 2, oversized)
    expect(after.scale).toBe(2)
    expect(screenToWorld(after, cursor)).toEqual(screenToWorld(before, cursor))
  })

  it('keeps the cursor fixed when zooming out from a panned view', () => {
    const before = pan(createView(viewport), 30, 20, undersized)
    const cursor = { x: 55, y: 45 }
    const after = zoomAt(before, cursor, 0.5, undersized)
    expect(after.scale).toBeCloseTo(0.5, 9)
    expect(screenToWorld(after, cursor)).toEqual(screenToWorld(before, cursor))
  })

  it('clamps the scale to the documented bounds', () => {
    expect(zoomAt(createView(viewport), { x: 0, y: 0 }, 50, oversized).scale).toBe(MAX_SCALE)
    expect(zoomAt(createView(viewport), { x: 0, y: 0 }, 0.001, oversized).scale).toBe(MIN_SCALE)
    expect(MAX_SCALE).toBe(8)
    expect(MIN_SCALE).toBe(0.1)
  })

  it('pins the offset to the viewport edge instead of overshooting the image', () => {
    const after = zoomAt(createView(viewport), { x: 400, y: 300 }, 50, undersized)
    expect(after.offsetX).toBe(viewport.width - 200 * after.scale)
    expect(after.offsetY).toBe(viewport.height - 150 * after.scale)
    expect(worldToScreen(after, { x: 200, y: 150 })).toEqual({ x: 400, y: 300 })
  })

  it('keeps a zoomed-out image inside the viewport', () => {
    const after = zoomAt(fitView(viewport, 800, 600), { x: 200, y: 150 }, 0.01, oversized)
    expect(after.scale).toBe(MIN_SCALE)
    expect(worldToScreen(after, { x: 0, y: 0 }).x).toBeGreaterThanOrEqual(0)
    expect(worldToScreen(after, { x: 800, y: 600 }).x).toBeLessThanOrEqual(viewport.width)
    expect(worldToScreen(after, { x: 0, y: 0 }).y).toBeGreaterThanOrEqual(0)
    expect(worldToScreen(after, { x: 800, y: 600 }).y).toBeLessThanOrEqual(viewport.height)
  })

  it('survives a non-finite zoom factor without leaking NaN offsets', () => {
    const after = zoomAt(createView(viewport), { x: 100, y: 100 }, Number.NaN, oversized)
    expect(after.scale).toBe(MIN_SCALE)
    expect(Number.isFinite(after.offsetX)).toBe(true)
    expect(Number.isFinite(after.offsetY)).toBe(true)
  })
})

describe('pan', () => {
  it('shifts the view by screen pixels', () => {
    const after = pan(createView(viewport), 30, -20, straddling)
    expect(worldToScreen(after, { x: 0, y: 0 })).toEqual({ x: 30, y: -20 })
  })

  it('composes two pans additively', () => {
    expect(pan(pan(createView(viewport), 10, -5, straddling), -4, -8, straddling)).toEqual({ scale: 1, offsetX: 6, offsetY: -13 })
  })

  it('stops at the image bounds when dragged past them', () => {
    const draggedOut = pan(createView(viewport), 1000, -1000, oversized)
    expect(draggedOut.offsetX).toBe(0)
    expect(draggedOut.offsetY).toBe(viewport.height - 600)
    expect(worldToScreen(draggedOut, { x: 0, y: 0 })).toEqual({ x: 0, y: -300 })
    expect(worldToScreen(draggedOut, { x: 0, y: 600 })).toEqual({ x: 0, y: viewport.height })

    const draggedBack = pan(draggedOut, -1000, 1000, oversized)
    expect(draggedBack.offsetX).toBe(viewport.width - 800)
    expect(draggedBack.offsetY).toBe(0)
    expect(worldToScreen(draggedBack, { x: 800, y: 0 })).toEqual({ x: viewport.width, y: 0 })
  })

  it('keeps a panned tiny image inside the viewport', () => {
    const after = pan(createView(viewport), -1000, 1000, undersized)
    expect(after.offsetX).toBe(0)
    expect(after.offsetY).toBe(viewport.height - 150)
    expect(worldToScreen(after, { x: 0, y: 0 })).toEqual({ x: 0, y: 150 })
    expect(worldToScreen(after, { x: 200, y: 150 })).toEqual({ x: 200, y: viewport.height })
  })
})

describe('screen/world round trip', () => {
  it('maps a point through a zoomed and panned view back onto itself', () => {
    const view = zoomAt(pan(createView(viewport), 12, -7, straddling), { x: 55, y: 45 }, 1.7, straddling)
    for (const point of [{ x: 0, y: 0 }, { x: 80, y: 20 }, { x: -40, y: 110 }]) {
      const back = worldToScreen(view, screenToWorld(view, point))
      expect(back.x).toBeCloseTo(point.x, 9)
      expect(back.y).toBeCloseTo(point.y, 9)
    }
  })
})

describe('fitView', () => {
  it('fits a world box inside the viewport and centers it', () => {
    const view = fitView(viewport, 800, 600)
    expect(view.scale).toBe(0.5)
    expect(worldToScreen(view, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(worldToScreen(view, { x: 800, y: 600 })).toEqual({ x: 400, y: 300 })
  })

  it('clamps a tiny world box to the maximum scale', () => {
    const view = fitView(viewport, 10, 10)
    expect(view.scale).toBe(MAX_SCALE)
    expect(worldToScreen(view, { x: 5, y: 5 })).toEqual({ x: 200, y: 150 })
  })
})

describe('clampView', () => {
  it('pins a bigger-than-viewport image so it still covers the viewport', () => {
    expect(clampView({ scale: 2, offsetX: 500, offsetY: 500 }, viewport, { width: 800, height: 600 })).toEqual({ scale: 2, offsetX: 0, offsetY: 0 })
    expect(clampView({ scale: 2, offsetX: -5000, offsetY: -5000 }, viewport, { width: 800, height: 600 })).toEqual({ scale: 2, offsetX: -1200, offsetY: -900 })
  })

  it('pins a smaller-than-viewport image so it stays inside the viewport', () => {
    expect(clampView({ scale: 0.5, offsetX: -100, offsetY: -100 }, viewport, { width: 200, height: 150 })).toEqual({ scale: 0.5, offsetX: 0, offsetY: 0 })
    expect(clampView({ scale: 0.5, offsetX: 900, offsetY: 900 }, viewport, { width: 200, height: 150 })).toEqual({ scale: 0.5, offsetX: 300, offsetY: 225 })
  })

  it('clamps each axis on its own side of the bound', () => {
    expect(clampView({ scale: 1, offsetX: 500, offsetY: -500 }, viewport, { width: 200, height: 600 })).toEqual({ scale: 1, offsetX: 200, offsetY: -300 })
  })

  it('leaves the fitted view untouched', () => {
    const fitted = fitView(viewport, 800, 600)
    expect(clampView(fitted, viewport, { width: 800, height: 600 })).toEqual(fitted)
  })

  it('does not clamp an image with no size', () => {
    expect(clampView({ scale: 1, offsetX: 1e6, offsetY: -1e6 }, viewport, { width: 0, height: 0 })).toEqual({ scale: 1, offsetX: 1e6, offsetY: -1e6 })
    expect(clampView({ scale: 1, offsetX: 1e6, offsetY: -1e6 }, viewport, { width: -40, height: 600 })).toEqual({ scale: 1, offsetX: 1e6, offsetY: -1e6 })
  })

  it('keeps the scale and drops non-finite offsets to zero', () => {
    const clamped = clampView({ scale: 3, offsetX: Number.NaN, offsetY: Number.POSITIVE_INFINITY }, viewport, { width: 800, height: 600 })
    expect(clamped.scale).toBe(3)
    expect(clamped).toEqual({ scale: 3, offsetX: 0, offsetY: 0 })
    expect(clampView({ scale: Number.NaN, offsetX: 40, offsetY: 40 }, viewport, { width: 800, height: 600 })).toEqual({ scale: Number.NaN, offsetX: 0, offsetY: 0 })
  })
})

describe('clampToWorld', () => {
  const image = { width: 240, height: 160 }

  it('leaves a point inside the image untouched', () => {
    expect(clampToWorld({ x: 120, y: 80 }, image)).toEqual({ x: 120, y: 80 })
    expect(clampToWorld({ x: 0, y: 0 }, image)).toEqual({ x: 0, y: 0 })
    expect(clampToWorld({ x: 240, y: 160 }, image)).toEqual({ x: 240, y: 160 })
  })

  it('pins each edge of the image rectangle', () => {
    expect(clampToWorld({ x: -500, y: 80 }, image)).toEqual({ x: 0, y: 80 })
    expect(clampToWorld({ x: 500, y: 80 }, image)).toEqual({ x: 240, y: 80 })
    expect(clampToWorld({ x: 120, y: -500 }, image)).toEqual({ x: 120, y: 0 })
    expect(clampToWorld({ x: 120, y: 500 }, image)).toEqual({ x: 120, y: 160 })
    expect(clampToWorld({ x: -500, y: 500 }, image)).toEqual({ x: 0, y: 160 })
  })

  it('pins every point to the origin when the image has no size', () => {
    expect(clampToWorld({ x: 40, y: 20 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
    expect(clampToWorld({ x: 40, y: 20 }, { width: -30, height: 160 })).toEqual({ x: 0, y: 20 })
  })

  it('drops non-finite coordinates to zero instead of inventing NaN', () => {
    const clamped = clampToWorld({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, image)
    expect(clamped).toEqual({ x: 0, y: 0 })
    expect(Number.isFinite(clamped.x)).toBe(true)
    expect(Number.isFinite(clamped.y)).toBe(true)
    expect(clampToWorld({ x: 10, y: 10 }, { width: Number.NaN, height: Number.NaN })).toEqual({ x: 0, y: 0 })
  })
})
