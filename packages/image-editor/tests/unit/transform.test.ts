import { describe, expect, it } from 'vitest'
import type { ArrowShape, FreehandShape, LeaderShape, RectShape, SpeechShape, TextShape, Transform } from '../../src/scene.ts'
import { GLYPH_WIDTH, LINE_HEIGHT } from '../../src/scene.ts'
import type { Point } from '../../src/transform.ts'
import {
  MIN_SHAPE_SIZE,
  cursorFor,
  editEndpoint,
  handlePoints,
  localToWorld,
  moveShape,
  resizeShape,
  rotateShape,
  withFontSize,
  worldToLocal,
} from '../../src/transform.ts'

const QUARTER_TURN = Math.PI / 2

function rectOf(transform: Transform): RectShape {
  return { id: 'rect-1', kind: 'rect', color: '#1A1A1A', width: 4, opacity: 1, transform }
}

function markerOf(transform: Transform, points: number[]): FreehandShape {
  return { id: 'marker-1', kind: 'marker', color: '#E5484D', width: 4, opacity: 1, transform, points }
}

function textOf(transform: Transform, text: string, fontSize: number): TextShape {
  return { id: 'text-1', kind: 'text', color: '#E5484D', width: 4, opacity: 1, transform, text, fontSize }
}

function speechOf(transform: Transform, anchor: Point, text: string, fontSize: number): SpeechShape {
  return { id: 'speech-1', kind: 'speech', color: '#E5484D', width: 4, opacity: 1, transform, anchor, text, fontSize }
}

function leaderOf(transform: Transform, from: [number, number], to: [number, number]): LeaderShape {
  return { id: 'leader-1', kind: 'leader', color: '#E5484D', width: 4, opacity: 1, transform, from, to, text: 'note', fontSize: 18 }
}

function arrowOf(transform: Transform, from: [number, number], to: [number, number]): ArrowShape {
  return { id: 'arrow-1', kind: 'arrow', color: '#E5484D', width: 4, opacity: 1, transform, from, to }
}

/** Handle ids Stage 7 adds for the endpoint-driven kinds: two endpoint dots plus a center square. */
type EndpointHandleId = 'end-start' | 'end-end' | 'center'
const endpointOrder: EndpointHandleId[] = ['end-start', 'end-end', 'center']

/** Where a payload endpoint of an endpoint shape currently sits in world space. */
function endpointWorld(shape: ArrowShape | LeaderShape, local: [number, number]): Point {
  return localToWorld(shape.transform, { x: local[0], y: local[1] })
}

/** A world point that stayed put is the anchor: it must land in the same bbox slot after the resize. */
function closeTo(anchor: Point, world: Point): void {
  expect(world.x).toBeCloseTo(anchor.x, 6)
  expect(world.y).toBeCloseTo(anchor.y, 6)
}

const flat = { x: 10, y: 20, w: 40, h: 15, rotation: 0 }
const spun = { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN }

describe('world/local mapping', () => {
  it('round-trips a point through the local space of a rotated shape', () => {
    const transform = { x: 10, y: 20, w: 40, h: 15, rotation: Math.PI / 3 }
    for (const point of [{ x: 0, y: 0 }, { x: 30, y: 27.5 }, { x: 50, y: 40 }, { x: -12, y: 61 }]) {
      const back = worldToLocal(transform, localToWorld(transform, point))
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  })

  it('maps bbox-local points into world space around the bbox center', () => {
    expect(localToWorld(flat, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 })
    // Local (0,0) of the spun box lands left-below the center after rotating +90°.
    expect(localToWorld(spun, { x: 0, y: 0 }).x).toBeCloseTo(15, 6)
    expect(localToWorld(spun, { x: 0, y: 0 }).y).toBeCloseTo(-5, 6)
  })

  it('maps a world point into bbox-local coordinates for an unrotated shape', () => {
    expect(worldToLocal(flat, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 })
    expect(worldToLocal(flat, { x: 50, y: 35 })).toEqual({ x: 40, y: 15 })
  })
})

describe('moveShape', () => {
  it('shifts the bbox origin and keeps the payload untouched', () => {
    const shape = markerOf(flat, [0, 0, 10, 5])
    const moved = moveShape(shape, 6, -4)
    expect(moved.transform).toEqual({ x: 16, y: 16, w: 40, h: 15, rotation: 0 })
    expect(moved.points).toBe(shape.points)
    expect(moved.id).toBe(shape.id)
    expect(moved.color).toBe(shape.color)
  })

  it('leaves the original shape untouched', () => {
    const shape = rectOf(flat)
    expect(moveShape(shape, 100, 100).transform).not.toBe(shape.transform)
    expect(shape.transform).toEqual(flat)
  })
})

describe('resizeShape', () => {
  it('east handle stretches the width of an unrotated shape', () => {
    expect(resizeShape(rectOf(flat), 'e', { x: 12, y: 0 }).transform).toEqual({
      x: 10,
      y: 20,
      w: 52,
      h: 15,
      rotation: 0,
    })
  })

  it('west handle drags the origin while the far edge stays put', () => {
    expect(resizeShape(rectOf(flat), 'w', { x: -8, y: 0 }).transform).toEqual({
      x: 2,
      y: 20,
      w: 48,
      h: 15,
      rotation: 0,
    })
  })

  it('north handle drags the origin and corner handles stretch both axes', () => {
    expect(resizeShape(rectOf(flat), 'n', { x: 0, y: -6 }).transform).toEqual({
      x: 10,
      y: 14,
      w: 40,
      h: 21,
      rotation: 0,
    })
    expect(resizeShape(rectOf(flat), 'se', { x: 5, y: 7 }).transform).toEqual({
      x: 10,
      y: 20,
      w: 45,
      h: 22,
      rotation: 0,
    })
  })

  it('east handle of a 90°-rotated shape stretches width along the world y axis', () => {
    // The world-space delta is rotated into local axes before stretching, so a
    // vertical drag on the rotated east handle is the shape's horizontal axis. The
    // anchor is the left edge center, which is why the origin is no longer held.
    const stretched = resizeShape(rectOf(spun), 'e', { x: 0, y: 10 }).transform
    expect(stretched.x).toBeCloseTo(-5, 6)
    expect(stretched.y).toBeCloseTo(5, 6)
    expect(stretched).toMatchObject({ w: 30, h: 10, rotation: QUARTER_TURN })
    // A world delta along the rotated shape's own vertical axis leaves the east handle alone.
    const untouched = resizeShape(rectOf(spun), 'e', { x: 10, y: 0 }).transform
    expect(untouched.x).toBeCloseTo(0, 6)
    expect(untouched.y).toBeCloseTo(0, 6)
    expect(untouched).toMatchObject({ w: 20, h: 10, rotation: QUARTER_TURN })
  })

  it('south handle of a 90°-rotated shape shrinks height along the world x axis', () => {
    const shrunk = resizeShape(rectOf(spun), 's', { x: 10, y: 0 }).transform
    expect(shrunk.x).toBeCloseTo(3, 6)
    expect(shrunk.y).toBeCloseTo(3, 6)
    expect(shrunk).toMatchObject({ w: 20, h: MIN_SHAPE_SIZE, rotation: QUARTER_TURN })
  })

  it('clamps the size so a shape never degenerates and anchors the far edge', () => {
    const grown = resizeShape(rectOf(flat), 'e', { x: -100, y: 0 }).transform
    expect(grown).toEqual({ x: 10, y: 20, w: MIN_SHAPE_SIZE, h: 15, rotation: 0 })

    const squeezed = resizeShape(rectOf(flat), 'w', { x: 100, y: 0 }).transform
    expect(squeezed.w).toBe(MIN_SHAPE_SIZE)
    expect(squeezed.x + squeezed.w).toBe(flat.x + flat.w)

    const north = resizeShape(rectOf(flat), 'n', { x: 0, y: 100 }).transform
    expect(north.h).toBe(MIN_SHAPE_SIZE)
    expect(north.y + north.h).toBe(flat.y + flat.h)
  })

  it('keeps the local payload untouched when resizing', () => {
    const shape = markerOf({ x: 0, y: 0, w: 20, h: 10, rotation: 0 }, [0, 0, 10, 5, 20, 10])
    expect(resizeShape(shape, 'e', { x: 10, y: 0 }).points).toBe(shape.points)
  })
})

// A balloon has no glyphs to scale: resizing stretches the box like a rect, and the tip
// payload survives untouched — unlike text, which resizes through its font size.
describe('resizing a speech balloon stretches the box', () => {
  const tilted = { x: 20, y: 30, w: 60, h: 30, rotation: Math.PI / 4 }

  it('east handle grows the width and leaves the font size alone', () => {
    const balloon = speechOf(flat, { x: 20, y: -14 }, 'note', 18)
    const grown = resizeShape(balloon, 'e', { x: 12, y: 0 })
    if (grown.kind !== 'speech') throw new Error('a speech shape must stay a speech shape')
    expect(grown.fontSize).toBe(18)
    expect(grown.text).toBe('note')
    expect(grown.transform).toEqual({ x: 10, y: 20, w: 52, h: 15, rotation: 0 })
    expect(grown.anchor).toBe(balloon.anchor)
  })

  it('north handle grows the height only', () => {
    const balloon = speechOf(flat, { x: 20, y: -14 }, 'note', 18)
    expect(resizeShape(balloon, 'n', { x: 0, y: -6 }).transform).toEqual({ x: 10, y: 14, w: 40, h: 21, rotation: 0 })
  })

  // The tip is pinned where it was clicked: growing the balloon must not drag it along.
  it('keeps the tip in world space while the bbox grows', () => {
    const balloon = speechOf(flat, { x: 20, y: -14 }, 'note', 18)
    const tip = localToWorld(balloon.transform, balloon.anchor)
    const grown = resizeShape(balloon, 'e', { x: 12, y: 0 })
    closeTo(tip, localToWorld(grown.transform, grown.anchor))
  })

  it('pins the bbox point opposite the grabbed handle on a tilted balloon', () => {
    const balloon = speechOf(tilted, { x: 30, y: -20 }, 'note', 18)
    const corner = localToWorld(balloon.transform, { x: 0, y: 0 })
    const grown = resizeShape(balloon, 'se', { x: 20, y: 0 })
    if (grown.kind !== 'speech') throw new Error('a speech shape must stay a speech shape')
    expect(grown.transform.w).toBeGreaterThan(tilted.w)
    expect(grown.fontSize).toBe(18)
    closeTo(corner, localToWorld(grown.transform, { x: 0, y: 0 }))
  })
})

// A callout has no glyphs to scale and no point to pin: resizing stretches the box like a
// rect and the endpoints survive untouched — unlike text, which resizes through its font size.
describe('resizing a leader stretches the box', () => {
  const tilted = { x: 20, y: 30, w: 60, h: 30, rotation: Math.PI / 4 }

  it('east handle grows the width and leaves the endpoints, font size and text alone', () => {
    const callout = leaderOf(flat, [0, 15], [40, 0])
    const grown = resizeShape(callout, 'e', { x: 12, y: 0 })
    if (grown.kind !== 'leader') throw new Error('a leader shape must stay a leader shape')
    expect(grown.fontSize).toBe(18)
    expect(grown.text).toBe('note')
    expect(grown.transform).toEqual({ x: 10, y: 20, w: 52, h: 15, rotation: 0 })
    expect(grown.from).toBe(callout.from)
    expect(grown.to).toBe(callout.to)
  })

  it('north handle grows the height only', () => {
    const callout = leaderOf(flat, [0, 15], [40, 0])
    expect(resizeShape(callout, 'n', { x: 0, y: -6 }).transform).toEqual({ x: 10, y: 14, w: 40, h: 21, rotation: 0 })
  })

  it('pins the bbox point opposite the grabbed handle on a tilted callout', () => {
    const callout = leaderOf(tilted, [0, 30], [60, 0])
    const corner = localToWorld(callout.transform, { x: 0, y: 0 })
    const grown = resizeShape(callout, 'se', { x: 20, y: 0 })
    if (grown.kind !== 'leader') throw new Error('a leader shape must stay a leader shape')
    expect(grown.transform.w).toBeGreaterThan(tilted.w)
    expect(grown.fontSize).toBe(18)
    closeTo(corner, localToWorld(grown.transform, { x: 0, y: 0 }))
  })
})

/** The resize anchor is the bbox point opposite the grabbed handle; it must not move in world space. */
describe('resizing pins the bbox point opposite the grabbed handle', () => {
  const tilted = { x: 20, y: 30, w: 60, h: 30, rotation: Math.PI / 4 }

  it('holds the northwest corner while the southeast handle is dragged', () => {
    const shape = rectOf(tilted)
    const corner = localToWorld(shape.transform, { x: 0, y: 0 })
    const grown = resizeShape(shape, 'se', { x: 20, y: 0 })
    expect(grown.transform.w).toBeGreaterThan(tilted.w)
    closeTo(corner, localToWorld(grown.transform, { x: 0, y: 0 }))
  })

  it('holds the southeast corner while the northwest handle is dragged', () => {
    const shape = rectOf(tilted)
    const corner = localToWorld(shape.transform, { x: tilted.w, y: tilted.h })
    const grown = resizeShape(shape, 'nw', { x: -20, y: 0 })
    expect(grown.transform.w).toBeGreaterThan(tilted.w)
    closeTo(corner, localToWorld(grown.transform, { x: grown.transform.w, y: grown.transform.h }))
  })

  it('holds the bottom edge center while the north handle is dragged', () => {
    const shape = rectOf(tilted)
    const center = localToWorld(shape.transform, { x: tilted.w / 2, y: tilted.h })
    const grown = resizeShape(shape, 'n', { x: 0, y: -20 })
    expect(grown.transform.h).toBeGreaterThan(tilted.h)
    closeTo(center, localToWorld(grown.transform, { x: grown.transform.w / 2, y: grown.transform.h }))
  })

  it('holds the left edge center while the east handle is dragged', () => {
    const shape = rectOf(tilted)
    const center = localToWorld(shape.transform, { x: 0, y: tilted.h / 2 })
    const grown = resizeShape(shape, 'e', { x: 20, y: 0 })
    expect(grown.transform.w).toBeGreaterThan(tilted.w)
    closeTo(center, localToWorld(grown.transform, { x: 0, y: grown.transform.h / 2 }))
  })

  it('keeps the unrotated outcome: west and north drag the origin, east and south track the pointer', () => {
    expect(resizeShape(rectOf(flat), 'nw', { x: -8, y: -6 }).transform).toEqual({ x: 2, y: 14, w: 48, h: 21, rotation: 0 })
    expect(resizeShape(rectOf(flat), 'se', { x: 5, y: 7 }).transform).toEqual({ x: 10, y: 20, w: 45, h: 22, rotation: 0 })
  })

  it('keeps a rotated label pinned while its font size grows', () => {
    const label = textOf(tilted, 'note', 18)
    const center = localToWorld(label.transform, { x: 0, y: tilted.h / 2 })
    const grown = resizeShape(label, 'e', { x: 20, y: 0 })
    if (grown.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(grown.fontSize).toBeGreaterThan(18)
    closeTo(center, localToWorld(grown.transform, { x: 0, y: grown.transform.h / 2 }))
  })
})

describe('resizing text drives the font size', () => {
  const textBox = { x: 10, y: 20, w: 40, h: 27, rotation: 0 }

  it('stretching the east handle twice as wide doubles the font size', () => {
    const label = textOf(textBox, 'note', 18)
    const grown = resizeShape(label, 'e', { x: 40, y: 0 })
    if (grown.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(grown.fontSize).toBeCloseTo(36, 6)
    // The bbox scales with the font size, so the origin follows the anchor: the opposite
    // edge center (left edge) keeps its world position.
    expect(grown.transform).toEqual({ x: 10, y: 6.5, w: 80, h: 54, rotation: 0 })
    expect(localToWorld(grown.transform, { x: 0, y: grown.transform.h / 2 })).toEqual(
      localToWorld(label.transform, { x: 0, y: textBox.h / 2 }),
    )
    expect(grown.text).toBe('note')
  })

  it('shrinking the west handle halves the font size', () => {
    const label = textOf(textBox, 'note', 18)
    const squeezed = resizeShape(label, 'w', { x: 20, y: 0 })
    if (squeezed.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(squeezed.fontSize).toBeCloseTo(9, 6)
    expect(squeezed.transform.x).toBeCloseTo(30, 6)
    expect(squeezed.transform.y).toBeCloseTo(26.75, 6)
    expect(squeezed.transform.w).toBeCloseTo(20, 6)
    expect(squeezed.transform.h).toBeCloseTo(13.5, 6)
    closeTo(
      localToWorld(label.transform, { x: textBox.w, y: textBox.h / 2 }),
      localToWorld(squeezed.transform, { x: squeezed.transform.w, y: squeezed.transform.h / 2 }),
    )
  })

  it('a vertical-only handle drives the size through the height axis', () => {
    const grown = resizeShape(textOf(textBox, 'note', 18), 's', { x: 0, y: 27 })
    if (grown.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(grown.fontSize).toBeCloseTo(36, 6)

    const raised = resizeShape(textOf(textBox, 'note', 18), 'n', { x: 0, y: -13.5 })
    if (raised.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(raised.fontSize).toBeCloseTo(27, 6)
  })

  it('keeps every line when a multiline label is stretched', () => {
    const multiline = textOf({ x: 10, y: 20, w: 40, h: 2 * LINE_HEIGHT * 18, rotation: 0 }, 'one\ntwo', 18)
    const grown = resizeShape(multiline, 'e', { x: 40, y: 0 })
    if (grown.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(grown.text).toBe('one\ntwo')
    expect(grown.transform.h).toBeCloseTo(2 * LINE_HEIGHT * 36, 6)
  })

  it('never drives the font size below one pixel', () => {
    const collapsed = resizeShape(textOf(textBox, 'note', 18), 'e', { x: -1000, y: 0 })
    if (collapsed.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(collapsed.fontSize).toBeGreaterThanOrEqual(1)
    expect(collapsed.transform.w).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE)
  })

  it('rotated text follows the local axis of the dragged handle', () => {
    const spun = textOf({ x: 0, y: 0, w: 40, h: 27, rotation: QUARTER_TURN }, 'note', 18)
    const grown = resizeShape(spun, 'e', { x: 0, y: 40 })
    if (grown.kind !== 'text') throw new Error('a text shape must stay a text shape')
    expect(grown.fontSize).toBeCloseTo(36, 6)
  })

  it('withFontSize rewrites the box from the new text extent', () => {
    const resized = withFontSize(textOf(textBox, 'note', 18), 32)
    expect(resized.fontSize).toBe(32)
    expect(resized.transform).toEqual({ x: 10, y: 20, w: 4 * GLYPH_WIDTH * 32, h: LINE_HEIGHT * 32, rotation: 0 })
    expect(resized.text).toBe('note')
    expect(resized.id).toBe('text-1')
  })
})

describe('rotateShape', () => {
  it('adds the delta about the bbox center without touching position or size', () => {
    const shape = rectOf(flat)
    expect(rotateShape(shape, 0.4).transform).toEqual({ ...flat, rotation: 0.4 })
    expect(shape.transform).toEqual(flat)
  })

  it('keeps rotation inside (-PI, PI] for a full turn', () => {
    expect(rotateShape(rectOf(spun), Math.PI * 2).transform.rotation).toBeCloseTo(QUARTER_TURN, 6)
  })

  it('wraps an angle past PI into the negative half', () => {
    expect(rotateShape(rectOf({ ...flat, rotation: 3 * Math.PI / 4 }), Math.PI / 2).transform.rotation).toBeCloseTo(
      -3 * Math.PI / 4,
      6,
    )
  })

  it('maps exactly -PI onto PI', () => {
    expect(rotateShape(rectOf({ ...flat, rotation: -Math.PI }), 0).transform.rotation).toBeCloseTo(Math.PI, 6)
  })
})

describe('handlePoints', () => {
  // Stage 8: the bbox kinds gain a center drag square between the resize slots and the rotate circle.
  it('returns the eight resize slots, the center square and the rotate handle', () => {
    expect(handlePoints(rectOf(flat), 24).map((handle) => handle.id)).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
      'center',
      'rotate',
    ])
  })

  it('places the handles on corners, edge centers, the bbox center and above the top edge', () => {
    const points = handlePoints(rectOf({ x: 0, y: 0, w: 20, h: 10, rotation: 0 }), 8)
    expect(points.map((handle) => handle.point)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 5 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: -8 },
    ])
  })

  it('rotates every handle with the shape', () => {
    const points = handlePoints(rectOf(spun), 8)
    const rotate = points.find((handle) => handle.id === 'rotate')?.point
    expect(rotate?.x).toBeCloseTo(23, 6)
    expect(rotate?.y).toBeCloseTo(5, 6)

    const west = points.find((handle) => handle.id === 'w')?.point
    expect(west?.x).toBeCloseTo(10, 6)
    expect(west?.y).toBeCloseTo(-5, 6)
  })

  // The center square is a bbox slot like the corners: it rides the rotation, never the flat box.
  it('puts the center handle on the bbox center of a rotated shape', () => {
    const center = handlePoints(rectOf(spun), 8).find((handle) => handle.id === 'center')
    expect(center?.point).toEqual({ x: 10, y: 5 })
  })
})

// Stage 7: arrow and leader are edited by their endpoints, so their overlay has no bbox handles
// and no rotate handle — two dots on the ends and one draggable square at the bbox center.
describe('handlePoints for arrow and leader', () => {
  it('replaces the bbox handles of an arrow with two endpoint dots and one center square', () => {
    const points = handlePoints(arrowOf({ x: 0, y: 0, w: 40, h: 30, rotation: 0 }, [0, 30], [40, 0]), 8)
    expect(points.map((handle) => handle.id)).toEqual(endpointOrder)
    expect(points.map((handle) => handle.point)).toEqual([{ x: 0, y: 30 }, { x: 40, y: 0 }, { x: 20, y: 15 }])
  })

  it('maps a degenerate horizontal arrow to its two ends and the midpoint between them', () => {
    const points = handlePoints(arrowOf({ x: 0, y: 20, w: 50, h: 0, rotation: 0 }, [0, 0], [50, 0]), 8)
    expect(points.map((handle) => handle.id)).toEqual(endpointOrder)
    expect(points.map((handle) => handle.point)).toEqual([{ x: 0, y: 20 }, { x: 50, y: 20 }, { x: 25, y: 20 }])
  })

  it('maps the endpoint and center marks through the rotated bbox and drops the rotate handle', () => {
    const points = handlePoints(arrowOf({ x: 10, y: 20, w: 40, h: 30, rotation: QUARTER_TURN }, [0, 30], [40, 0]), 8)
    expect(points.map((handle) => handle.id)).toEqual(endpointOrder)
    expect(points[0]?.point.x).toBeCloseTo(15, 6)
    expect(points[0]?.point.y).toBeCloseTo(15, 6)
    expect(points[1]?.point.x).toBeCloseTo(45, 6)
    expect(points[1]?.point.y).toBeCloseTo(55, 6)
    expect(points[2]?.point).toEqual({ x: 30, y: 35 })
    expect(points.some((handle) => handle.id === 'rotate')).toBe(false)
  })

  it('marks a leader at its dot, its shelf and the bbox center, ignoring the label', () => {
    const points = handlePoints(leaderOf({ x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0]), 8)
    expect(points.map((handle) => handle.id)).toEqual(endpointOrder)
    expect(points.map((handle) => handle.point)).toEqual([{ x: 20, y: 40 }, { x: 80, y: 10 }, { x: 50, y: 25 }])
  })

  it('keeps the eight bbox slots plus center and rotate for every other kind', () => {
    for (const shape of [rectOf(flat), markerOf(flat, [0, 0, 40, 15]), textOf(flat, 'note', 18), speechOf(flat, [0, 15], 'hi', 18)]) {
      const ids = handlePoints(shape, 24).map((handle) => handle.id)
      expect(ids).toHaveLength(10)
      expect(ids).not.toContain('end-start')
      expect(ids).not.toContain('end-end')
      expect(ids).toContain('center')
      expect(ids).toContain('rotate')
    }
  })
})

// Stage 8: every handle id carries its own hover cursor. `cursorFor` is the pure id→CSS-cursor
// mapping the input layer feeds into the canvas — the SVG grab cursor for rotate is a data URL so
// it needs no asset.
describe('cursorFor', () => {
  it('maps every handle id to its hover cursor', () => {
    expect(cursorFor('center')).toBe('move')
    expect(cursorFor('nw')).toBe('pointer')
    expect(cursorFor('ne')).toBe('pointer')
    expect(cursorFor('se')).toBe('pointer')
    expect(cursorFor('sw')).toBe('pointer')
    expect(cursorFor('e')).toBe('col-resize')
    expect(cursorFor('w')).toBe('col-resize')
    expect(cursorFor('n')).toBe('row-resize')
    expect(cursorFor('s')).toBe('row-resize')
    expect(cursorFor('end-start')).toBe('pointer')
    expect(cursorFor('end-end')).toBe('pointer')

    // The rotate cursor is an inline SVG grab cursor with an 8 8 hotspot and the `grab` fallback.
    const rotate = cursorFor('rotate')
    expect(rotate).toContain('url(')
    expect(rotate).toContain('data:image/svg+xml')
    expect(rotate).toContain('8 8')
    expect(rotate.endsWith('grab')).toBe(true)
  })
})

describe('editEndpoint', () => {
  it('moves only the dragged end of an arrow and re-normalizes the bbox over both ends', async () => {
    const shape = arrowOf({ x: 0, y: 0, w: 40, h: 30, rotation: 0 }, [0, 30], [40, 0])
    const edited = editEndpoint(shape, 'end', { x: 90, y: 8 })
    closeTo({ x: 90, y: 8 }, endpointWorld(edited, edited.to))
    closeTo({ x: 0, y: 30 }, endpointWorld(edited, edited.from))
    expect(edited.transform).toEqual({ x: 0, y: 8, w: 90, h: 22, rotation: 0 })
    expect(edited.from).toEqual([0, 22])
    expect(edited.to).toEqual([90, 0])
    expect(edited.id).toBe('arrow-1')
    expect(edited.color).toBe('#E5484D')
    expect(edited.width).toBe(4)
    expect(edited.opacity).toBe(1)
    expect(shape.transform).toEqual({ x: 0, y: 0, w: 40, h: 30, rotation: 0 })
  })

  it('moves the start endpoint while the untouched end keeps its world position', async () => {
    const shape = arrowOf({ x: 0, y: 0, w: 40, h: 30, rotation: 0 }, [0, 30], [40, 0])
    const edited = editEndpoint(shape, 'start', { x: -12, y: 44 })
    closeTo({ x: -12, y: 44 }, endpointWorld(edited, edited.from))
    closeTo({ x: 40, y: 0 }, endpointWorld(edited, edited.to))
    expect(edited.transform).toEqual({ x: -12, y: 0, w: 52, h: 44, rotation: 0 })
    expect(edited.from).toEqual([0, 44])
    expect(edited.to).toEqual([52, 0])
  })

  it('keeps the untouched end in world space when a rotated arrow is dragged flat', async () => {
    const shape = arrowOf({ x: 10, y: 20, w: 40, h: 30, rotation: QUARTER_TURN }, [0, 30], [40, 0])
    const untouched = endpointWorld(shape, [0, 30])
    const edited = editEndpoint(shape, 'end', { x: 100, y: 20 })
    closeTo(untouched, endpointWorld(edited, edited.from))
    closeTo({ x: 100, y: 20 }, endpointWorld(edited, edited.to))
    expect(edited.transform.x).toBeCloseTo(15, 6)
    expect(edited.transform.y).toBeCloseTo(15, 6)
    expect(edited.transform.w).toBeCloseTo(85, 6)
    expect(edited.transform.h).toBeCloseTo(5, 6)
    expect(edited.transform.rotation).toBe(0)
  })

  it('collapses an arrow onto its untouched end as a zero-span bbox', async () => {
    const shape = arrowOf({ x: 0, y: 0, w: 40, h: 30, rotation: 0 }, [0, 30], [40, 0])
    const edited = editEndpoint(shape, 'end', { x: 0, y: 30 })
    expect(edited.transform).toEqual({ x: 0, y: 30, w: 0, h: 0, rotation: 0 })
    expect(edited.from).toEqual([0, 0])
    expect(edited.to).toEqual([0, 0])
    closeTo({ x: 0, y: 30 }, endpointWorld(edited, edited.from))
    closeTo({ x: 0, y: 30 }, endpointWorld(edited, edited.to))
  })

  it('moves the leader dot and leaves the shelf exactly where it was', async () => {
    const shape = leaderOf({ x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])
    const edited = editEndpoint(shape, 'start', { x: 30, y: 60 })
    closeTo({ x: 30, y: 60 }, endpointWorld(edited, edited.from))
    closeTo({ x: 80, y: 10 }, endpointWorld(edited, edited.to))
    expect(edited.transform).toEqual({ x: 30, y: 10, w: 50, h: 50, rotation: 0 })
    expect(edited.from).toEqual([0, 50])
    expect(edited.to).toEqual([50, 0])
    expect(edited.text).toBe('note')
    expect(edited.fontSize).toBe(18)
  })

  it('moves the leader shelf and keeps the dot and the label', async () => {
    const shape = leaderOf({ x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])
    const edited = editEndpoint(shape, 'end', { x: 120, y: 26 })
    closeTo({ x: 20, y: 40 }, endpointWorld(edited, edited.from))
    closeTo({ x: 120, y: 26 }, endpointWorld(edited, edited.to))
    expect(edited.transform).toEqual({ x: 20, y: 26, w: 100, h: 14, rotation: 0 })
    expect(edited.from).toEqual([0, 14])
    expect(edited.to).toEqual([100, 0])
    expect(edited.text).toBe('note')
    expect(edited.fontSize).toBe(18)
  })

  it('collapses a leader onto its dot without clamping the span', async () => {
    const shape = leaderOf({ x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])
    const edited = editEndpoint(shape, 'end', { x: 20, y: 40 })
    expect(edited.transform).toEqual({ x: 20, y: 40, w: 0, h: 0, rotation: 0 })
    expect(edited.from).toEqual([0, 0])
    expect(edited.to).toEqual([0, 0])
    expect(edited.text).toBe('note')
  })
})
