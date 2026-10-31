// Acceptance spot-checks on the pure modules, independent of the shipped unit suites.
import { describe, expect, it } from 'vitest'
import { createHistory } from '../../src/undo.ts'
import { createScene, shapeOf } from '../../src/scene.ts'
import type { Point, RectShape, Scene, Shape, Transform } from '../../src/scene.ts'
import type { HandleId, ResizeHandle } from '../../src/transform.ts'
import { hitShape, hitHandle } from '../../src/hit.ts'
import { ROTATE_HANDLE_GAP, handlePoints, resizeShape, rotateShape } from '../../src/transform.ts'
import { renderPng } from '../../src/export.ts'
import type { ImageSource } from '../../src/render.ts'
import { drawScene } from '../../src/render.ts'

const QUARTER_TURN = Math.PI / 2
const THIRD_TURN = Math.PI / 3

const base = { color: '#E5484D', width: 4, opacity: 1 }

function rect(id: string, transform: Transform): RectShape {
  return { id, kind: 'rect', ...base, transform }
}

function sceneWith(id: string): Scene {
  return createScene([rect(id, { x: 0, y: 0, w: 40, h: 10, rotation: 0 })])
}

describe('undo history over several commits', () => {
  it('walks back through every commit by identity and stops at the first', () => {
    const first = createScene()
    const second = createScene([rect('a', { x: 0, y: 0, w: 40, h: 10, rotation: 0 })])
    const third = createScene([rect('a', { x: 5, y: 0, w: 40, h: 10, rotation: 0 }), rect('b', { x: 0, y: 20, w: 8, h: 8, rotation: 0 })])
    const fourth = createScene([rect('a', { x: 9, y: 3, w: 40, h: 10, rotation: 0 }), rect('b', { x: 0, y: 20, w: 8, h: 8, rotation: 0 })])

    const history = createHistory()
    history.push(first)
    history.push(second)
    history.push(third)
    history.push(fourth)

    expect(history.undo()).toBe(third)
    expect(history.undo()).toBe(second)
    expect(history.undo()).toBe(first)
    expect(history.undo()).toBeNull()
    expect(history.current()).toBe(first)
    expect(history.canUndo()).toBe(false)
    expect(first.shapes).toHaveLength(0)
    expect(second.shapes).toHaveLength(1)
    expect(third.shapes.map((shape) => shape.id)).toEqual(['a', 'b'])
    expect(third.shapes[1]?.transform).toEqual({ x: 0, y: 20, w: 8, h: 8, rotation: 0 })
    expect(shapeOf(third, 'a')?.transform.x).toBe(5)
    expect(shapeOf(fourth, 'a')?.transform.x).toBe(9)
    expect(shapeOf(history.current() ?? first, 'a')).toBeUndefined()
  })
})

describe('resize of a rotated rect', () => {
  /** The handle opposite the grabbed one sits exactly on the resize anchor, in world space. */
  function oppositeAnchor(shape: Shape, handle: ResizeHandle): Point {
    const opposite: Record<ResizeHandle, HandleId> = { se: 'nw', nw: 'se', ne: 'sw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' }
    const point = handlePoints(shape, ROTATE_HANDLE_GAP).find((slot) => slot.id === opposite[handle])?.point
    if (!point) throw new Error('the opposite handle is missing')
    return point
  }

  function closeTo(anchor: Point, world: Point): void {
    expect(world.x).toBeCloseTo(anchor.x, 6)
    expect(world.y).toBeCloseTo(anchor.y, 6)
  }

  it('stretches the shape axis, not the world axis, at a quarter turn', () => {
    const spun = rect('r', { x: 0, y: 0, w: 40, h: 10, rotation: QUARTER_TURN })
    const stretched = resizeShape(spun, 'e', { x: 0, y: 10 })
    expect(stretched.transform.x).toBeCloseTo(-5, 6)
    expect(stretched.transform.y).toBeCloseTo(5, 6)
    expect(stretched.transform).toMatchObject({ w: 50, h: 10, rotation: QUARTER_TURN })
    closeTo(oppositeAnchor(spun, 'e'), oppositeAnchor(stretched, 'e'))

    // A purely horizontal world delta is the rotated shape's vertical axis: the east handle
    // ignores it, while the south handle grows the height.
    const untouched = resizeShape(spun, 'e', { x: 10, y: 0 }).transform
    expect(untouched.x).toBeCloseTo(0, 6)
    expect(untouched.y).toBeCloseTo(0, 6)
    expect(untouched).toMatchObject({ w: 40, h: 10, rotation: QUARTER_TURN })

    const grown = resizeShape(spun, 's', { x: -10, y: 0 })
    expect(grown.transform.x).toBeCloseTo(-5, 6)
    expect(grown.transform.y).toBeCloseTo(-5, 6)
    expect(grown.transform).toMatchObject({ w: 40, h: 20, rotation: QUARTER_TURN })
    closeTo(oppositeAnchor(spun, 's'), oppositeAnchor(grown, 's'))
  })

  it('stretches the dragged axis at a non-orthogonal rotation', () => {
    const tilted = rect('r', { x: 0, y: 0, w: 40, h: 10, rotation: THIRD_TURN })
    // A world delta aligned with the tilted shape's x axis changes w only.
    const alongX = resizeShape(tilted, 'e', { x: Math.cos(THIRD_TURN), y: Math.sin(THIRD_TURN) })
    expect(alongX.transform.w).toBeCloseTo(41, 6)
    expect(alongX.transform.h).toBe(10)
    closeTo(oppositeAnchor(tilted, 'e'), oppositeAnchor(alongX, 'e'))

    const alongY = resizeShape(tilted, 's', { x: -Math.sin(THIRD_TURN), y: Math.cos(THIRD_TURN) })
    expect(alongY.transform.h).toBeCloseTo(11, 6)
    expect(alongY.transform.w).toBe(40)
    closeTo(oppositeAnchor(tilted, 's'), oppositeAnchor(alongY, 's'))
  })
})

describe('hitShape on a rotated rect', () => {
  it('hits the rotated interior and misses the unrotated footprint', () => {
    const spun = rect('r', { x: 0, y: 0, w: 40, h: 10, rotation: QUARTER_TURN })
    // Rotated 90° about its centre the bbox spans x 15..25, y -15..25, so (20, 15) is inside the
    // rotated rectangle but outside the flat 40x10 footprint it would occupy unrotated.
    expect(hitShape(spun, { x: 20, y: 15 }, 0)?.id).toBe('r')
    expect(hitShape(spun, { x: 20, y: 15 }, 0)?.kind).toBe('rect')
    expect(hitShape(spun, { x: 4, y: 4 }, 0)).toBeNull()
    expect(hitShape(spun, { x: 30, y: 20 }, 0)).toBeNull()
    // Stage 8 puts the center square on the bbox centre, so a 3px radius there hits it — and only it:
    // every other handle sits half a bbox away, outside the radius.
    expect(hitHandle(spun, { x: 20, y: 5 }, 3)).toBe('center')
  })
})

describe('rotateShape', () => {
  it('accumulates rotation and keeps the bbox size', () => {
    const spun = rotateShape(rect('r', { x: 10, y: 20, w: 40, h: 10, rotation: 0 }), QUARTER_TURN)
    expect(spun.transform.rotation).toBeCloseTo(QUARTER_TURN, 6)
    expect(spun.transform).toEqual({ x: 10, y: 20, w: 40, h: 10, rotation: spun.transform.rotation })
    // A full turn wraps back onto the same angle, and a half turn wraps into (-pi, pi].
    expect(rotateShape(spun, Math.PI * 2).transform.rotation).toBeCloseTo(QUARTER_TURN, 6)
    expect(rotateShape(spun, Math.PI).transform.rotation).toBeCloseTo(-QUARTER_TURN, 6)
  })
})

describe('stroke payloads', () => {
  // The payload spans the bbox in both axes: a stroke wider than it is tall must keep
  // its vertical extent, so y comes from slot 1 of each pair, not slot 0.
  it('a stroked payload keeps its vertical extent when the bbox is wider than it is tall', () => {
    const scene = createScene([{ ...base, id: 'm1', kind: 'marker', transform: { x: 100, y: 60, w: 240, h: 60, rotation: 0 }, points: [0, 0, 240, 60] }])
    const lines: Array<[number, number]> = []
    const ctx = {
      canvas: { width: 400, height: 300 },
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      clearRect: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      drawImage: () => {},
      beginPath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: (x: number, y: number) => lines.push([x, y]),
      lineTo: (x: number, y: number) => lines.push([x, y]),
      measureText: () => ({ width: 0 }),
    } as unknown as CanvasRenderingContext2D

    drawScene(ctx, scene, { width: 320, height: 200 } as unknown as ImageSource, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(lines.at(-1)).toEqual([240, 60])
  })
})

describe('renderPng in node', () => {
  it('is exported but needs a DOM, so it rejects in the node environment', async () => {
    expect(renderPng).toBeTypeOf('function')
    const image = { naturalWidth: 320, naturalHeight: 200 } as unknown as HTMLImageElement
    await expect(renderPng(image, createScene())).rejects.toThrow()
  })
})
