import { describe, expect, it } from 'vitest'
import type { ArrowShape, FreehandShape, LeaderShape, Point, RectShape, Shape, SpeechShape, TextShape, Transform } from '../../src/scene.ts'
import { hitHandle, hitShape, shapesWithin, topShapeAt } from '../../src/hit.ts'
import { ROTATE_HANDLE_GAP, handlePoints, localToWorld } from '../../src/transform.ts'

const QUARTER_TURN = Math.PI / 2

const base = { color: '#E5484D', width: 4, opacity: 1 }

function rectShape(id: string, transform: Transform): RectShape {
  return { id, kind: 'rect', ...base, transform }
}

function textShape(id: string, transform: Transform): TextShape {
  return { id, kind: 'text', ...base, transform, text: 'note', fontSize: 18 }
}

function arrowShape(id: string, transform: Transform, from: [number, number], to: [number, number]): ArrowShape {
  return { id, kind: 'arrow', ...base, transform, from, to }
}

function markerShape(id: string, transform: Transform, points: number[], width = 4): FreehandShape {
  return { id, kind: 'marker', ...base, width, opacity: 1, transform, points }
}

function stepShape(id: string, transform: Transform) {
  return { id, kind: 'step', ...base, transform }
}

function speechShape(id: string, transform: Transform, anchor: Point): SpeechShape {
  return { id, kind: 'speech', ...base, transform, anchor, text: 'hi', fontSize: 18 }
}

function leaderShape(id: string, transform: Transform, from: [number, number], to: [number, number], width = 8, text = 'note'): LeaderShape {
  return { id, kind: 'leader', color: '#E5484D', width, opacity: 1, transform, from, to, text, fontSize: 18 }
}

function handleOf(shape: Shape, id: 'rotate'): { x: number; y: number } {
  const handle = handlePoints(shape, ROTATE_HANDLE_GAP).find((candidate) => candidate.id === id)
  if (!handle) throw new Error(`missing handle ${id}`)
  return handle.point
}

describe('hitShape', () => {
  it('hits the interior of a rotated rect', () => {
    const shape = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN })
    expect(hitShape(shape, { x: 5, y: 5 }, 1)).toEqual({ id: 'r', kind: 'rect' })
    expect(hitShape(shape, { x: 25, y: 5 }, 1)).toBeNull()
    expect(hitShape(shape, { x: 0, y: -20 }, 1)).toBeNull()
  })

  it('hits inside the bbox and up to the tolerance beyond it', () => {
    const shape = rectShape('r', { x: 10, y: 10, w: 20, h: 10, rotation: 0 })
    expect(hitShape(shape, { x: 20, y: 15 }, 0)).toEqual({ id: 'r', kind: 'rect' })
    expect(hitShape(shape, { x: 32, y: 15 }, 1)).toBeNull()
    expect(hitShape(shape, { x: 32, y: 15 }, 2)).toEqual({ id: 'r', kind: 'rect' })
  })

  it('hits text inside its box and misses outside', () => {
    const shape = textShape('t', { x: 10, y: 20, w: 30, h: 18, rotation: 0 })
    expect(hitShape(shape, { x: 12, y: 25 }, 0)).toEqual({ id: 't', kind: 'text' })
    expect(hitShape(shape, { x: 45, y: 25 }, 2)).toBeNull()
  })

  // The step hit is its inscribed circle, not the bbox: corners the circle does not
  // cover must miss, and tolerance extends the circle edge like the rect rule.
  it('hits a step inside its circle and misses the bbox corners outside it', () => {
    const shape = stepShape('s', { x: 0, y: 0, w: 40, h: 20, rotation: 0 })
    expect(hitShape(shape, { x: 20, y: 10 }, 0)).toEqual({ id: 's', kind: 'step' })
    expect(hitShape(shape, { x: 29, y: 10 }, 0)).toEqual({ id: 's', kind: 'step' })
    expect(hitShape(shape, { x: 31, y: 10 }, 0)).toBeNull()
    expect(hitShape(shape, { x: 31, y: 10 }, 2)).toEqual({ id: 's', kind: 'step' })
    expect(hitShape(shape, { x: 34, y: 2 }, 2)).toBeNull()
  })

  it('hits a rotated step by inverse-rotating the world point', () => {
    const shape = stepShape('s', { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN })
    expect(hitShape(shape, { x: 10, y: 5 }, 0)).toEqual({ id: 's', kind: 'step' })
    // The bbox point (19, 1) lands at world (14, 14): inside the bbox, outside the inscribed circle.
    expect(hitShape(shape, { x: 14, y: 14 }, 0)).toBeNull()
  })

  it('hits a zero-size step through tolerance only', () => {
    const dot = stepShape('dot', { x: 5, y: 5, w: 0, h: 0, rotation: 0 })
    expect(hitShape(dot, { x: 6.5, y: 6.5 }, 3)).toEqual({ id: 'dot', kind: 'step' })
    expect(hitShape(dot, { x: 9, y: 9 }, 3)).toBeNull()
  })

  // The balloon is its ellipse, not the bbox: a corner the ellipse does not cover misses.
  it('hits a balloon inside its ellipse and misses the bbox corner outside it', () => {
    const shape = speechShape('sp', { x: 0, y: 0, w: 40, h: 20, rotation: 0 }, { x: 20, y: -14 })
    expect(hitShape(shape, { x: 20, y: 10 }, 0)).toEqual({ id: 'sp', kind: 'speech' })
    expect(hitShape(shape, { x: 39, y: 15 }, 0)).toBeNull()
    // The same corner becomes hittable once tolerance inflates the ellipse.
    expect(hitShape(shape, { x: 39, y: 15 }, 2)).toEqual({ id: 'sp', kind: 'speech' })
    expect(hitShape(shape, { x: 40, y: 20 }, 2)).toBeNull()
  })

  // The tip sits outside the ellipse, below/above the box: the tail between tip and edge hits.
  it('hits the balloon tail between the tip and the ellipse edge', () => {
    const shape = speechShape('sp', { x: 0, y: 0, w: 40, h: 20, rotation: 0 }, { x: 20, y: -14 })
    expect(hitShape(shape, { x: 20, y: -8 }, 2)).toEqual({ id: 'sp', kind: 'speech' })
    expect(hitShape(shape, { x: 26, y: -8 }, 2)).toBeNull()
    // Beyond the tip there is no tail left to hit.
    expect(hitShape(shape, { x: 20, y: -24 }, 2)).toBeNull()
  })

  it('hits a rotated balloon by inverse-rotating the world point', () => {
    const shape = speechShape('sp', { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN }, { x: 10, y: -14 })
    expect(hitShape(shape, { x: 10, y: 5 }, 0)).toEqual({ id: 'sp', kind: 'speech' })
    // The bbox corner (19,1) is outside the inscribed ellipse; it lands at world (14,14).
    expect(hitShape(shape, { x: 14, y: 14 }, 0)).toBeNull()
    // The tip lands at world (29,5); the tail runs from there to the ellipse edge at (20,5).
    expect(hitShape(shape, { x: 22, y: 5 }, 2)).toEqual({ id: 'sp', kind: 'speech' })
    expect(hitShape(shape, { x: 35, y: 5 }, 2)).toBeNull()
    expect(hitShape(shape, { x: 29, y: 12 }, 2)).toBeNull()
  })

  it('hits a zero-size balloon through tolerance only', () => {
    const dot = speechShape('dot', { x: 5, y: 5, w: 0, h: 0, rotation: 0 }, { x: 0, y: 0 })
    expect(hitShape(dot, { x: 6.5, y: 6.5 }, 3)).toEqual({ id: 'dot', kind: 'speech' })
    expect(hitShape(dot, { x: 9, y: 9 }, 1)).toBeNull()
  })

  it('hits an arrow near its segment and misses the bbox corner', () => {
    const shape = arrowShape('a', { x: 0, y: 0, w: 40, h: 20, rotation: 0 }, [0, 0], [40, 20])
    expect(hitShape(shape, { x: 20, y: 10 }, 2)).toEqual({ id: 'a', kind: 'arrow' })
    expect(hitShape(shape, { x: 34, y: 2 }, 2)).toBeNull()
    expect(hitShape(shape, { x: 10, y: 4 }, 2)).toEqual({ id: 'a', kind: 'arrow' })
  })

  it('hits an arrow up to width/2 plus tolerance', () => {
    const shape = arrowShape('a', { x: 0, y: 0, w: 40, h: 0, rotation: 0 }, [0, 0], [40, 0])
    expect(hitShape(shape, { x: 20, y: 3.5 }, 2)).toEqual({ id: 'a', kind: 'arrow' })
    expect(hitShape(shape, { x: 20, y: 5 }, 2)).toBeNull()
  })

  // The head sits at the `from` end, so the hittable segment runs past `from` out to the tip
  // one width away from it: points beyond the tip stay hittable within width/2 + tolerance,
  // and the `to` end keeps its old reach.
  it('hits the arrowhead tip past the from end and misses beyond it', () => {
    const shape = arrowShape('a', { x: 0, y: 0, w: 40, h: 0, rotation: 0 }, [0, 0], [40, 0])
    // Tip at (−4,0): (−7,0) sits 3 px past the tip — inside width/2 + tol (4 px);
    // (−11,0) sits 7 px past the tip — outside it.
    expect(hitShape(shape, { x: -7, y: 0 }, 2)).toEqual({ id: 'a', kind: 'arrow' })
    expect(hitShape(shape, { x: -11, y: 0 }, 2)).toBeNull()
    // Past the `to` end: 7 px beyond (40,0) exceeds the same limit.
    expect(hitShape(shape, { x: 47, y: 0 }, 2)).toBeNull()
  })

  // The callout dot is thicker than the shaft: a point past the shaft tolerance still hits
  // the dot circle, while far away nothing hits.
  it('hits the leader dot beyond the shaft tolerance and misses far away', () => {
    const shape = leaderShape('l', { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])
    // Local dot at (0,30) → world (20,40); 9 px away exceeds shaft tol 4+2 but stays inside the dot.
    expect(hitShape(shape, { x: 20, y: 49 }, 2)).toEqual({ id: 'l', kind: 'leader' })
    expect(hitShape(shape, { x: 200, y: 100 }, 2)).toBeNull()
  })

  it('hits the leader shaft near its middle like an arrow shaft', () => {
    const shape = leaderShape('l', { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])
    expect(hitShape(shape, { x: 50, y: 25 }, 2)).toEqual({ id: 'l', kind: 'leader' })
  })

  // The callout is dot+shaft+text, not the bbox: a corner neither covers must miss.
  it('misses the leader bbox corner outside the dot, shaft and text', () => {
    const shape = leaderShape('l', { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])
    // Local (60,30): 30 px off the shaft, 60 px off the dot, below the shelf.
    expect(hitShape(shape, { x: 80, y: 40 }, 2)).toBeNull()
  })

  // A horizontal shaft: hittable up to width/2 plus tolerance, like the arrow rule.
  it('hits a leader shaft up to width/2 plus tolerance', () => {
    const shape = leaderShape('lh', { x: 0, y: 0, w: 40, h: 0, rotation: 0 }, [0, 0], [40, 0])
    expect(hitShape(shape, { x: 20, y: 5 }, 2)).toEqual({ id: 'lh', kind: 'leader' })
    expect(hitShape(shape, { x: 20, y: 7 }, 2)).toBeNull()
  })

  // The label band is centered on the shelf line for every line count, so it straddles the line
  // and covers the whole fixed shelf span — shelf end to far tip. Tolerance extends the band, but
  // the span itself stays the shelf's, so past either tip there is nothing to hit even though the
  // old label-sized band would have reached further.
  // The band follows the label ink, which now starts 12 px past the far tip: past the tip is
  // only hittable while it is inside the shifted label, not just past the tip.
  it('hits the leader text band centered on the shelf line across the shelf span and misses past its tips', () => {
    const shape = leaderShape('l', { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])
    // Band for one line: 27 px tall centered on shelf.y, so local y ∈ [-13.5-2, 13.5+2].
    // Below the shelf line — local y 10, world 20 — is inside the centered band; the old band
    // ended at the shelf line, so this row is exactly where the old placement was bare.
    expect(hitShape(shape, { x: 101.5, y: 20 }, 2)).toEqual({ id: 'l', kind: 'leader' })
    expect(hitShape(shape, { x: 123, y: 20 }, 2)).toEqual({ id: 'l', kind: 'leader' })
    // Local x 136.6 = far tip 103 + gap 12 + 21.6 px of label ink: inside the shifted label,
    // so the band must reach it. Under the crammed label this point is past the band's end.
    expect(hitShape(shape, { x: 156.6, y: 20 }, 2)).toEqual({ id: 'l', kind: 'leader' })
    // Local x 164 = past the band's new end (103 + 12 + 43.2 + 2 = 160.2), and 3 px past the
    // shelf end (60-3) sits in empty space.
    expect(hitShape(shape, { x: 184, y: 20 }, 2)).toBeNull()
    expect(hitShape(shape, { x: 77, y: 20 }, 2)).toBeNull()
    // Local y -16, world -6: above the centered band's top (shelf.y − band/2 − tol = -15.5) —
    // the old band reached to -29, so this row is where the old placement still hit.
    expect(hitShape(shape, { x: 101.5, y: -6 }, 2)).toBeNull()
  })

  // Two lines center the band on the shelf line the same way, so ink above AND below the shelf is
  // hittable — and a single line is centered like them, not stacked above the line.
  it('hits a multi-line label band centered across the shelf line', () => {
    const shape = leaderShape('m', { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0], 8, 'first\nsecond')
    // Band h = 2·27 = 54 centered on shelf.y: local y ∈ [-27-2, 27+2] at any band x.
    expect(hitShape(shape, { x: 101.5, y: -10 }, 2)).toEqual({ id: 'm', kind: 'leader' })
    expect(hitShape(shape, { x: 101.5, y: 30 }, 2)).toEqual({ id: 'm', kind: 'leader' })
    // Local x 147.4 = far tip 103 + gap 12 + 32.4 px of the shifted label's ink: hittable.
    expect(hitShape(shape, { x: 167.4, y: 30 }, 2)).toEqual({ id: 'm', kind: 'leader' })
    // 3 px past the centered band's bottom (27+2) and past the shifted band's end
    // (103 + 12 + 64.8 + 2 = 181.8, world 201.8) miss.
    expect(hitShape(shape, { x: 101.5, y: 41 }, 2)).toBeNull()
    expect(hitShape(shape, { x: 205, y: 30 }, 2)).toBeNull()
  })

  // A left drag mirrors the band: the label sits right-aligned 12 px past the shelf start, so
  // the band runs from past the label's left ink edge to just past the shelf end.
  it('hits a left-drag leader label band shifted past the shelf start', () => {
    const shape = leaderShape('ld', { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [60, 30], [0, 0])
    // Shelf runs local x ∈ [-43, 0]; 'note' is 43.2 px wide, right-aligned at -43-12 = -55, so
    // its ink spans local x ∈ [-98.2, -55]. Band y centered on shelf.y ± tol, so world y ∈ [-5.5, 25.5].
    // World x -56.6 is local -76.6: inside the shifted label ink. The crammed label's ink
    // started at the shelf start (-43), so this point is bare there today.
    expect(hitShape(shape, { x: -56.6, y: 20 }, 2)).toEqual({ id: 'ld', kind: 'leader' })
    // Local x -102 is past the ink's left edge (-98.2) minus tol: outside the band.
    expect(hitShape(shape, { x: -82, y: 20 }, 2)).toBeNull()
    // The shelf itself stays hittable, and 2 px past the shelf end (tol) misses.
    expect(hitShape(shape, { x: 10, y: 20 }, 2)).toEqual({ id: 'ld', kind: 'leader' })
    expect(hitShape(shape, { x: 24, y: 20 }, 2)).toBeNull()
  })

  // A click without a drag collapses the shaft to the dot, but the label still paints: its band is
  // centered on the shelf line and runs past the collapsed shelf start, so the dot and the centered
  // band together keep the collapsed callout selectable, and a point outside both stays out.
  it('hits a degenerate leader through the dot and the centered label band', () => {
    const pin = leaderShape('pin', { x: 5, y: 5, w: 0, h: 0, rotation: 0 }, [0, 0], [0, 0])
    // Shelf 43 px right of the collapsed tip; 'note' is 43.2 px wide and starts 12 px past the
    // far tip, so its ink spans local x ∈ [55, 98.2]. Band 27 px tall centered on the shelf
    // line, tolerance inflating it to local y ∈ [-13.5-3, 13.5+3] and local x ∈ [-3, 101.2].
    expect(hitShape(pin, { x: 6.5, y: 6.5 }, 3)).toEqual({ id: 'pin', kind: 'leader' })
    // Local (-8,0): past the collapsed shaft (width/2 + tol = 7) and past the band's inflated
    // start (-3), so only the dot radius (1.5 widths + tol = 15) reaches it.
    expect(hitShape(pin, { x: -3, y: 5 }, 3)).toEqual({ id: 'pin', kind: 'leader' })
    // Local (11,11) — 15.6 px off the collapsed dot, past its radius plus tolerance — sits inside
    // the painted label ink, below the shelf line. The old band ended at the shelf line, so this
    // row was bare under the previous placement; the centered band is what catches it now.
    expect(hitShape(pin, { x: 16, y: 16 }, 3)).toEqual({ id: 'pin', kind: 'leader' })
    // Local (11,18): below the band's bottom (13.5 + 3 = 16.5) and 21 px off the dot — outside
    // both regions, so nothing here is hittable.
    expect(hitShape(pin, { x: 16, y: 23 }, 3)).toBeNull()
    // Local (105,0): past the shifted band's end (43 + 12 + 43.2 + 3 = 101.2) and far from the
    // dot — the collapsed callout stays unselectable out there.
    expect(hitShape(pin, { x: 110, y: 5 }, 3)).toBeNull()
  })

  it('hits a marker near any polyline segment', () => {
    const shape = markerShape('m', { x: 0, y: 0, w: 20, h: 5, rotation: 0 }, [0, 0, 10, 0, 20, 5])
    expect(hitShape(shape, { x: 5, y: 1 }, 2)).toEqual({ id: 'm', kind: 'marker' })
    expect(hitShape(shape, { x: 15, y: 3 }, 2)).toEqual({ id: 'm', kind: 'marker' })
    expect(hitShape(shape, { x: 10, y: 10 }, 2)).toBeNull()
  })

  it('hits a wide stroke up to width/2 but does not add tolerance on top', () => {
    const shape = markerShape('h', { x: 0, y: 0, w: 10, h: 0, rotation: 0 }, [0, 0, 10, 0], 14)
    expect(hitShape(shape, { x: 5, y: 6 }, 1)).toEqual({ id: 'h', kind: 'marker' })
    expect(hitShape(shape, { x: 5, y: 8 }, 1)).toBeNull()
  })

  it('hits zero-size shapes through tolerance only', () => {
    const dot = rectShape('dot', { x: 5, y: 5, w: 0, h: 0, rotation: 0 })
    expect(hitShape(dot, { x: 6.5, y: 6.5 }, 2)).toEqual({ id: 'dot', kind: 'rect' })
    expect(hitShape(dot, { x: 7.5, y: 7.5 }, 2)).toBeNull()

    const stroke = markerShape('stub', { x: 5, y: 5, w: 0, h: 0, rotation: 0 }, [0, 0], 4)
    expect(hitShape(stroke, { x: 6.5, y: 6.5 }, 3)).toEqual({ id: 'stub', kind: 'marker' })
    expect(hitShape(stroke, { x: 9, y: 9 }, 3)).toBeNull()

    const pin = arrowShape('pin', { x: 5, y: 5, w: 0, h: 0, rotation: 0 }, [0, 0], [0, 0])
    expect(hitShape(pin, { x: 6.5, y: 6.5 }, 3)).toEqual({ id: 'pin', kind: 'arrow' })
  })

  it('hits a rotated marker by inverse-rotating the world point', () => {
    const shape = markerShape('m', { x: 0, y: 0, w: 20, h: 0, rotation: QUARTER_TURN }, [0, 0, 20, 0])
    // The stroke is vertical in world space at x = 10 once the box is spun 90°.
    expect(hitShape(shape, { x: 11, y: 0 }, 1)).toEqual({ id: 'm', kind: 'marker' })
    expect(hitShape(shape, { x: 14, y: 0 }, 1)).toBeNull()
  })
})

describe('topShapeAt', () => {
  it('returns the topmost shape on overlapping shapes', () => {
    const shapes: Shape[] = [
      rectShape('under', { x: 0, y: 0, w: 40, h: 40, rotation: 0 }),
      rectShape('over', { x: 20, y: 20, w: 40, h: 40, rotation: 0 }),
    ]
    expect(topShapeAt(shapes, { x: 30, y: 30 }, 0)).toEqual({ id: 'over', kind: 'rect' })
    expect(topShapeAt(shapes, { x: 10, y: 10 }, 0)).toEqual({ id: 'under', kind: 'rect' })
  })

  it('returns null when nothing is hit', () => {
    const shapes: Shape[] = [rectShape('r', { x: 0, y: 0, w: 10, h: 10, rotation: 0 })]
    expect(topShapeAt(shapes, { x: 50, y: 50 }, 2)).toBeNull()
    expect(topShapeAt([], { x: 0, y: 0 }, 2)).toBeNull()
  })
})

describe('shapesWithin', () => {
  it('keeps the shapes whose bbox overlaps the rect and drops the rest', () => {
    const shapes: Shape[] = [
      rectShape('in', { x: 10, y: 10, w: 20, h: 10, rotation: 0 }),
      rectShape('out', { x: 60, y: 60, w: 20, h: 10, rotation: 0 }),
    ]
    expect(shapesWithin(shapes, { x: 0, y: 0, w: 40, h: 40, rotation: 0 }).map((shape) => shape.id)).toEqual(['in'])
    expect(shapesWithin(shapes, { x: 55, y: 55, w: 30, h: 30, rotation: 0 }).map((shape) => shape.id)).toEqual(['out'])
    expect(shapesWithin(shapes, { x: 200, y: 200, w: 10, h: 10, rotation: 0 })).toEqual([])
    expect(shapesWithin([], { x: 0, y: 0, w: 40, h: 40, rotation: 0 })).toEqual([])
  })

  it('matches a partial overlap and a rect that sits inside the shape', () => {
    const shape = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: 0 })
    expect(shapesWithin([shape], { x: 15, y: 8, w: 30, h: 30, rotation: 0 })).toEqual([shape])
    expect(shapesWithin([shape], { x: 5, y: 4, w: 4, h: 3, rotation: 0 })).toEqual([shape])
    expect(shapesWithin([shape], { x: 20, y: 0, w: 10, h: 10, rotation: 0 })).toEqual([shape])
    expect(shapesWithin([shape], { x: 21, y: 0, w: 10, h: 10, rotation: 0 })).toEqual([])
    expect(shapesWithin([shape], { x: 18, y: 11, w: 10, h: 10, rotation: 0 })).toEqual([])
  })

  it('matches strokes by their bbox, not by the stroke geometry', () => {
    const arrow = arrowShape('a', { x: 0, y: 0, w: 40, h: 20, rotation: 0 }, [0, 0], [40, 20])
    // The bbox corner is far from the shaft, so the stroke itself would miss it.
    expect(hitShape(arrow, { x: 36, y: 2 }, 2)).toBeNull()
    expect(shapesWithin([arrow], { x: 30, y: 0, w: 12, h: 6, rotation: 0 }).map((shape) => shape.id)).toEqual(['a'])

    const marker = markerShape('m', { x: 10, y: 20, w: 30, h: 10, rotation: 0 }, [0, 0, 30, 10])
    expect(shapesWithin([marker], { x: 25, y: 25, w: 8, h: 6, rotation: 0 }).map((shape) => shape.id)).toEqual(['m'])
  })

  it('follows the rotated bbox instead of the unrotated footprint', () => {
    const spun = rectShape('r', { x: 0, y: 0, w: 40, h: 10, rotation: QUARTER_TURN })
    // Spun 90° about its centre the bbox spans x 15..25, y -15..25, so a rect inside the
    // flat 40x10 footprint no longer intersects it and one inside the spun box does.
    expect(shapesWithin([spun], { x: 18, y: 10, w: 6, h: 6, rotation: 0 }).map((shape) => shape.id)).toEqual(['r'])
    expect(shapesWithin([spun], { x: 4, y: 4, w: 4, h: 4, rotation: 0 })).toEqual([])
    expect(shapesWithin([spun], { x: 30, y: 20, w: 10, h: 10, rotation: 0 })).toEqual([])
  })

  it('matches a tilted shape through the AABB of its rotated bbox', () => {
    const tilted = rectShape('r', { x: 0, y: 0, w: 40, h: 10, rotation: Math.PI / 4 })
    // The rule tests the axis-aligned box of the rotated corners, so a marquee clipping
    // that box selects the shape even where the rotated body itself does not reach.
    expect(shapesWithin([tilted], { x: 34, y: 20, w: 12, h: 12, rotation: 0 }).map((shape) => shape.id)).toEqual(['r'])
    expect(shapesWithin([tilted], { x: -30, y: -30, w: 8, h: 8, rotation: 0 })).toEqual([])
  })

  it('keeps a zero-size rect only where it lands on the shape', () => {
    const rect = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: 0 })
    expect(shapesWithin([rect], { x: 12, y: 5, w: 0, h: 0, rotation: 0 }).map((shape) => shape.id)).toEqual(['r'])
    expect(shapesWithin([rect], { x: 25, y: 5, w: 0, h: 0, rotation: 0 })).toEqual([])
  })
})

describe('hitHandle', () => {
  it('hits the rotate handle of a rotated shape', () => {
    const shape = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN })
    const rotate = handleOf(shape, 'rotate')
    expect(hitHandle(shape, rotate, 6)).toBe('rotate')
    expect(hitHandle(shape, { x: rotate.x + 30, y: rotate.y }, 6)).toBeNull()
  })

  it('hits a corner handle and reports the nearest one', () => {
    const shape = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN })
    expect(hitHandle(shape, { x: 15, y: -5 }, 5)).toBe('nw')
    expect(hitHandle(shape, { x: 5, y: 5 }, 9)).toBe('s')
  })

  // Stage 8: a bbox kind now carries a center drag square, so the bbox center is a handle — the
  // far points stay misses.
  it('hits the center handle at the bbox center and misses points past every handle', () => {
    const shape = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: 0 })
    expect(hitHandle(shape, { x: 10, y: 5 }, 4)).toBe('center')
    expect(hitHandle(shape, { x: -20, y: -20 }, 4)).toBeNull()
    expect(hitHandle(shape, { x: 40, y: 30 }, 4)).toBeNull()
  })

  it('hits the center handle of a rotated rect on its rotated bbox center', () => {
    const shape = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN })
    expect(hitHandle(shape, { x: 10, y: 5 }, 6)).toBe('center')
  })
})

// Stage 7: arrow and leader expose endpoint dots and a center square instead of bbox handles, so
// hitting must report those ids and must not report a bbox corner or a rotate handle.
describe('hitHandle for arrow and leader', () => {
  const diagonal = arrowShape('a', { x: 0, y: 0, w: 40, h: 30, rotation: 0 }, [0, 30], [40, 0])
  const flatArrow = arrowShape('a', { x: 0, y: 20, w: 50, h: 0, rotation: 0 }, [0, 0], [50, 0])
  const leader = leaderShape('l', { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, [0, 30], [60, 0])

  function rotateSlot(shape: Shape): Point {
    return localToWorld(shape.transform, { x: shape.transform.w / 2, y: -ROTATE_HANDLE_GAP })
  }

  it('hits the start endpoint dot of an arrow', () => {
    expect(hitHandle(diagonal, { x: 0, y: 30 }, 6)).toBe('end-start')
    expect(hitHandle(diagonal, { x: 3, y: 27 }, 6)).toBe('end-start')
  })

  it('hits the end endpoint dot of an arrow', () => {
    expect(hitHandle(diagonal, { x: 40, y: 0 }, 6)).toBe('end-end')
  })

  it('hits the center square of an arrow at the bbox center', () => {
    expect(hitHandle(diagonal, { x: 20, y: 15 }, 6)).toBe('center')
  })

  it('reports endpoint dots and the center for a degenerate horizontal arrow', () => {
    expect(hitHandle(flatArrow, { x: 0, y: 20 }, 6)).toBe('end-start')
    expect(hitHandle(flatArrow, { x: 50, y: 20 }, 6)).toBe('end-end')
    expect(hitHandle(flatArrow, { x: 25, y: 20 }, 6)).toBe('center')
  })

  it('misses the bbox corners that are not endpoints', () => {
    expect(hitHandle(diagonal, { x: 0, y: 0 }, 6)).toBeNull()
    expect(hitHandle(diagonal, { x: 40, y: 30 }, 6)).toBeNull()
  })

  it('misses beyond the dot radius', () => {
    expect(hitHandle(diagonal, { x: 0, y: 37 }, 6)).toBeNull()
    expect(hitHandle(diagonal, { x: 20, y: 22 }, 6)).toBeNull()
  })

  it('has no rotate handle on an arrow', () => {
    expect(hitHandle(diagonal, rotateSlot(diagonal), 6)).toBeNull()
    const spun = arrowShape('a', { x: 0, y: 0, w: 20, h: 10, rotation: QUARTER_TURN }, [0, 10], [20, 0])
    expect(hitHandle(spun, rotateSlot(spun), 6)).toBeNull()
  })

  it('hits the leader dot, its shelf end and the center square', () => {
    expect(hitHandle(leader, { x: 20, y: 40 }, 6)).toBe('end-start')
    expect(hitHandle(leader, { x: 80, y: 10 }, 6)).toBe('end-end')
    expect(hitHandle(leader, { x: 50, y: 25 }, 6)).toBe('center')
  })

  it('misses the leader corners outside dot and shelf and has no rotate handle', () => {
    expect(hitHandle(leader, { x: 20, y: 10 }, 6)).toBeNull()
    expect(hitHandle(leader, { x: 80, y: 40 }, 6)).toBeNull()
    expect(hitHandle(leader, rotateSlot(leader), 6)).toBeNull()
  })

  it('keeps bbox and rotate handles hittable for other kinds', () => {
    const rect = rectShape('r', { x: 0, y: 0, w: 20, h: 10, rotation: 0 })
    expect(hitHandle(rect, { x: 0, y: 0 }, 6)).toBe('nw')
    expect(hitHandle(textShape('t', { x: 0, y: 0, w: 30, h: 18, rotation: 0 }), rotateSlot(textShape('t', { x: 0, y: 0, w: 30, h: 18, rotation: 0 })), 6)).toBe('rotate')
  })
})
