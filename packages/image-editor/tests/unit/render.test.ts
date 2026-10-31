import { describe, expect, it } from 'vitest'
import { LINE_HEIGHT, createScene, removeShape } from '../../src/scene.ts'
import type { ImageSource } from '../../src/render.ts'
import { HANDLE_COLOR, OVERLAY_COLOR, drawScene, resizeCanvas } from '../../src/render.ts'

// The shelf geometry is pinned to the fixed length 43 rather than read off the module namespace,
// so a shelf still stroked at the old length fails these tests as geometry diffs. The scene and
// barrel tests pin the constant itself to 43.
const shelfLength = 43

/** Paint ops carry the props read at op time — `restore` is a no-op in the fake, so a
 * final property value cannot tell which pass carried which shadow or thickness. */
type Op = { method: string; args: unknown[]; lineWidth?: number; strokeStyle?: string; fillStyle?: string; shadowBlur?: number; shadowColor?: string; textAlign?: string }

type FakeContext = CanvasRenderingContext2D & { ops: Op[]; strokes: string[]; strokeWidths: number[]; fills: string[]; filled: string[]; fillTexts: string[] }

function makeContext(measuredWidth?: number): FakeContext {
  const ops: Op[] = []
  /** Styles read at stroke/fill time: the overlay is stroked after the shapes, so a final
   * property value cannot tell which color a given op was painted with. */
  const strokes: string[] = []
  /** Line widths read at stroke time, same reason as the stroke colors: which stroke carried
   * which thickness is only recoverable per op, e.g. the step badge's white ring width. */
  const strokeWidths: number[] = []
  const fills: string[] = []
  /** `fill` and `fillText` colors captured at paint time, same reason as strokes/fills. */
  const filled: string[] = []
  const fillTexts: string[] = []
  const record = (method: string) => (...args: unknown[]) => ops.push({ method, args })
  /** Paint ops snapshot lineWidth, colors and shadow at op time, so a halo pass can be
   * told apart from the color pass it precedes even though the fake never restores. */
  const paint = (method: string) => (...args: unknown[]) => ops.push({ method, args, lineWidth: ctx.lineWidth, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle, shadowBlur: ctx.shadowBlur, shadowColor: ctx.shadowColor, textAlign: ctx.textAlign })
  const ctx = {
    ops,
    strokes,
    strokeWidths,
    fills,
    filled,
    fillTexts,
    canvas: { width: 200, height: 100 },
    strokeStyle: '',
    fillStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    lineCap: 'butt',
    lineJoin: 'miter',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    drawImage: record('drawImage'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    stroke: () => {
      strokes.push(ctx.strokeStyle)
      strokeWidths.push(ctx.lineWidth)
      paint('stroke')()
    },
    fill: (...args: unknown[]) => {
      filled.push(ctx.fillStyle)
      paint('fill')(...args)
    },
    fillRect: (...args: unknown[]) => {
      fills.push(ctx.fillStyle)
      paint('fillRect')(...args)
    },
    strokeRect: (...args: unknown[]) => {
      strokes.push(ctx.strokeStyle)
      paint('strokeRect')(...args)
    },
    fillText: (...args: unknown[]) => {
      fillTexts.push(ctx.fillStyle)
      paint('fillText')(...args)
    },
    setLineDash: record('setLineDash'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    measureText: () => ({ width: measuredWidth ?? 0 }),
  }
  return ctx as unknown as FakeContext
}

const image = { width: 240, height: 160 } as unknown as ImageSource
const base = { color: '#E5484D', width: 4, opacity: 1 }
/** The white ring Stage 8 gives every handle mark, the same edge color a step badge carries. */
const WHITE = '#FFFFFF'
/** Case- and spacing-insensitive reads of the Step-style outline props: drawStep spells
 * the white `#FFFFFF` and the shadow with spaces, the halo recipe spells them lowercase
 * without, so comparisons normalize instead of pinning one spelling. */
const isHaloWhite = (style: string | undefined) => (style ?? '').toUpperCase() === '#FFFFFF'
const isHaloShadow = (color: string | undefined) => (color ?? '').replace(/\s+/g, '') === 'rgba(26,26,26,0.35)'
/** Step digit ink, read case-insensitively: the badge fill's luminance decides dark vs white,
 * not which case the renderer spells, so only the ink itself is pinned. */
const inkOf = (ctx: FakeContext) => (digitOp(ctx).fillStyle ?? '').toUpperCase()
/** Paint ops of a method, with the props the fake captured at paint time. */
const paintOps = (ctx: FakeContext, method: string): Op[] => ctx.ops.filter((op) => op.method === method)

/** The single step digit's paint op: its fillStyle is the digit ink, separate from the badge fill op. */
function digitOp(ctx: FakeContext): Op {
  const digit = paintOps(ctx, 'fillText')[0]
  if (!digit) throw new Error('the step badge painted no digit')
  return digit
}

function markerScene() {
  return createScene([
    {
      id: 'm1',
      kind: 'marker',
      ...base,
      transform: { x: 10, y: 10, w: 40, h: 10, rotation: 0 },
      points: [0, 0, 40, 10],
    },
  ])
}

function highlighterScene() {
  return createScene([
    {
      id: 'h1',
      kind: 'highlighter',
      color: '#FFD666',
      width: 14,
      opacity: 0.4,
      transform: { x: 5, y: 40, w: 60, h: 8, rotation: 0 },
      points: [0, 0, 60, 0],
    },
  ])
}

function arrowScene() {
  return createScene([
    { id: 'a1', kind: 'arrow', ...base, transform: { x: 0, y: 20, w: 50, h: 0, rotation: 0 }, from: [0, 0], to: [50, 0] },
  ])
}

function arrowSceneDown() {
  return createScene([
    { id: 'a2', kind: 'arrow', ...base, transform: { x: 20, y: 0, w: 0, h: 50, rotation: 0 }, from: [0, 0], to: [0, 50] },
  ])
}

function rectScene(fill?: string) {
  return createScene([
    { id: 'r1', kind: 'rect', ...base, transform: { x: 20, y: 30, w: 60, h: 40, rotation: 0 }, fill },
  ])
}

function textScene() {
  return createScene([
    { id: 't1', kind: 'text', ...base, transform: { x: 12, y: 55, w: 43.2, h: 27, rotation: 0 }, text: 'note', fontSize: 18 },
  ])
}

/** Two lines inside a box that was measured for one line: the renderer must stack them. */
function twoLineTextScene() {
  return createScene([
    { id: 't2', kind: 'text', ...base, transform: { x: 12, y: 55, w: 43.2, h: 27, rotation: 0 }, text: 'first\nsecond', fontSize: 18 },
  ])
}

/** Steps store no digit: the visible number is derived from scene order at draw time. */
function stepScene(ids: readonly string[]) {
  return createScene(
    ids.map((id, index) => ({ id, kind: 'step', ...base, transform: { x: 10 + index * 50, y: 10, w: 40, h: 30, rotation: 0 } })),
  )
}

/** One badge whose fill is a chosen color, for checking the digit ink against that fill's luminance. */
function tintedStepScene(color: string) {
  return createScene([
    { id: 's1', kind: 'step', ...base, color, transform: { x: 10, y: 10, w: 40, h: 30, rotation: 0 } },
  ])
}

/** Balloon bbox 60x30 at (20,30); the tip is bbox-local and sits below the box, like a tail. */
function speechScene(text = 'hi', fontSize = 18) {
  return createScene([
    { id: 'sp1', kind: 'speech', ...base, transform: { x: 20, y: 30, w: 60, h: 30, rotation: 0 }, anchor: { x: 30, y: 44 }, text, fontSize },
  ])
}

/** Callout bbox 60x30 at (20,10): dot at bbox-local (0,30), shaft to (60,0), shelf at that y, text centered on it. */
function leaderScene(text = 'note', fontSize = 18) {
  return createScene([
    { id: 'l1', kind: 'leader', ...base, transform: { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, from: [0, 30], to: [60, 0], text, fontSize },
  ])
}

/** Same bbox mirrored: dot at bbox-local (60,30), shaft to (0,0) — a left drag, so the shelf runs leftward. */
function leaderLeftScene(text = 'note', fontSize = 18) {
  return createScene([
    { id: 'l2', kind: 'leader', ...base, transform: { x: 20, y: 10, w: 60, h: 30, rotation: 0 }, from: [60, 30], to: [0, 0], text, fontSize },
  ])
}

/** Horizontal path points recorded at the shelf's y; the shaft's end point sits on the shelf too. */
function shelfPoints(ctx: FakeContext): Array<[number, number]> {
  return ctx.ops
    .filter((op) => op.method === 'moveTo' || op.method === 'lineTo')
    .map((op) => pointOf(op))
    .filter(([, y]) => y === 0)
}

const methods = (ctx: FakeContext) => ctx.ops.map((op) => op.method)

/** Coordinate args of one recorded op, narrowed from the untyped op payload. */
function pointOf(op: Op | undefined): [number, number] {
  const x = op?.args[0]
  const y = op?.args[1]
  if (typeof x !== 'number' || typeof y !== 'number') throw new Error('op has no coordinate args')
  return [x, y]
}

/** Centers of every recorded `arc`, in paint order — the slot circles then the rotate circle. */
function arcCenters(ctx: FakeContext): Array<[number, number]> {
  return ctx.ops.filter((op) => op.method === 'arc').map((op) => pointOf(op))
}

/** `fillText` takes (text, x, y), so its point lives in slots 1 and 2. */
function textPointOf(op: Op): [number, number] {
  const x = op.args[1]
  const y = op.args[2]
  if (typeof x !== 'number' || typeof y !== 'number') throw new Error('op has no coordinate args')
  return [x, y]
}

/** The colored shaft stroke (the halo strokes come before it), its last point, and the ops after it. */
function shaftAndHead(ctx: FakeContext): { shaftEnd: [number, number]; head: Op[] } {
  const strokeIndex = ctx.ops.findIndex((op) => op.method === 'stroke' && op.strokeStyle === base.color)
  return { shaftEnd: pointOf(ctx.ops[strokeIndex - 1]), head: ctx.ops.slice(strokeIndex + 1) }
}

describe('drawScene', () => {
  it('clears the canvas, then draws the base image through the view transform', () => {
    const ctx = makeContext()
    drawScene(ctx, createScene(), image, { scale: 2, offsetX: 30, offsetY: 20 })
    const order = methods(ctx)
    expect(order[0]).toBe('save')
    expect(order.indexOf('clearRect')).toBeLessThan(order.indexOf('drawImage'))
    expect(ctx.ops.find((op) => op.method === 'translate')?.args).toEqual([30, 20])
    expect(ctx.ops.find((op) => op.method === 'scale')?.args).toEqual([2, 2])
    expect(ctx.ops.find((op) => op.method === 'drawImage')?.args[0]).toBe(image)
    expect(order.at(-1)).toBe('restore')
  })

  it('strokes freehand payloads as round-cap polylines', () => {
    const ctx = makeContext()
    drawScene(ctx, markerScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(ctx)).toEqual(expect.arrayContaining(['moveTo', 'lineTo', 'stroke']))
    expect(ctx.lineCap).toBe('round')
    expect(ctx.lineJoin).toBe('round')
    expect(ctx.lineWidth).toBe(4)
    expect(ctx.strokeStyle).toBe('#E5484D')
  })

  it('draws the highlighter with its own opacity', () => {
    const ctx = makeContext()
    drawScene(ctx, highlighterScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.globalAlpha).toBe(0.4)
    expect(ctx.strokeStyle).toBe('#FFD666')
  })

  it('fills the rect body only when a fill color is set', () => {
    const filled = makeContext()
    drawScene(filled, rectScene('#FFD666'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(filled)).toContain('fillRect')
    expect(methods(filled)).toContain('strokeRect')
    // The body fill lands between the white halo strokeRect and the colored strokeRect.
    const rectStrokes = paintOps(filled, 'strokeRect')
    expect(rectStrokes).toHaveLength(2)
    const fillIndex = filled.ops.findIndex((op) => op.method === 'fillRect')
    expect(fillIndex).toBeGreaterThan(filled.ops.indexOf(rectStrokes[0]))
    expect(fillIndex).toBeLessThan(filled.ops.indexOf(rectStrokes[1]))

    const stroked = makeContext()
    drawScene(stroked, rectScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(stroked)).not.toContain('fillRect')
    expect(methods(stroked)).toContain('strokeRect')
  })

  // The Step-style outline: strokeRect at width+4 in white with the badge shadow, then the
  // normal colored strokeRect at the shape width.
  it('strokes a white shadowed halo around the rect outline', () => {
    const ctx = makeContext()
    drawScene(ctx, rectScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const strokeRects = paintOps(ctx, 'strokeRect')
    expect(strokeRects).toHaveLength(2)
    expect(isHaloWhite(strokeRects[0]?.strokeStyle)).toBe(true)
    expect(strokeRects[0]?.lineWidth).toBe(base.width + 4)
    expect((strokeRects[0]?.shadowBlur ?? 0)).toBeGreaterThan(0)
    expect(isHaloShadow(strokeRects[0]?.shadowColor)).toBe(true)
    expect(strokeRects[1]?.strokeStyle).toBe(base.color)
    expect(strokeRects[1]?.lineWidth).toBe(base.width)
    expect(strokeRects[1]?.shadowBlur).toBe(0)
  })

  it('draws an arrow line plus a triangular head', () => {
    const ctx = makeContext()
    drawScene(ctx, arrowScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const order = methods(ctx)
    expect(order).toContain('stroke')
    expect(order).toContain('fill')
    expect(order).toContain('closePath')
  })

  // The Step-style outline: a white halo band carrying the badge's dark shadow is stroked
  // over the shaft and head paths before the colored pass, so the arrow reads like a step badge.
  it('strokes a white shadowed halo before the arrow color pass', () => {
    const ctx = makeContext()
    drawScene(ctx, arrowScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const strokes = paintOps(ctx, 'stroke')
    expect(strokes.map((op) => op.strokeStyle)).toEqual(['#ffffff', '#ffffff', base.color])
    expect(strokes.map((op) => op.lineWidth)).toEqual([base.width + 4, base.width + 4, base.width])
    expect(strokes.slice(0, 2).every((op) => isHaloWhite(op.strokeStyle) && isHaloShadow(op.shadowColor))).toBe(true)
    expect(strokes.slice(0, 2).every((op) => (op.shadowBlur ?? 0) > 0)).toBe(true)
    // The colored pass paints with the shadow cleared: the halo must not bleed into it.
    expect(strokes[2]?.shadowBlur).toBe(0)
    const fills = paintOps(ctx, 'fill')
    expect(fills).toHaveLength(1)
    expect(fills[0]?.fillStyle).toBe(base.color)
    expect(fills[0]?.shadowBlur).toBe(0)
    // Head order preserved: the head's white halo stroke precedes the colored head fill.
    expect(ctx.ops.indexOf(strokes[1])).toBeLessThan(ctx.ops.indexOf(fills[0]))
  })

  // The head points at the drag origin: the tip is one width past `from`, away from `to`, and
  // the base sits two widths past `from` toward `to` — covering the shaft's round cap there.
  // The shaft itself is unchanged, so its last point stays at `to`.
  it('places the arrow head tip past the from end pointing away from to', () => {
    const ctx = makeContext()
    drawScene(ctx, arrowScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const { shaftEnd, head } = shaftAndHead(ctx)
    expect(head.slice(0, 6).map((op) => op.method)).toEqual(['beginPath', 'moveTo', 'lineTo', 'lineTo', 'closePath', 'fill'])
    expect(ctx.ops.findIndex((op) => op.method === 'fill')).toBeGreaterThan(ctx.ops.findIndex((op) => op.method === 'stroke'))
    expect(shaftEnd).toEqual([50, 0])

    const tip = pointOf(head[1])
    const base = pointOf(head[2])
    // Horizontal arrow (0,0) → (50,0): head tip at x=−4, past `from` and away from `to`.
    expect(tip[0]).toBeLessThan(shaftEnd[0])
    expect(tip[0]).toBeLessThan(0)
    expect(tip[0]).toBeCloseTo(-4)
    expect(tip[1]).toBeCloseTo(0)
    // The triangle's base is the first wing's x: two widths past `from`, toward `to`.
    expect(base[0]).toBeGreaterThan(tip[0])
    expect(base[0]).toBeCloseTo(8)
    // The head keeps its size: wings stay 2 widths off the shaft axis, symmetric about it.
    expect(Math.abs(pointOf(head[2])[1])).toBeCloseTo(8)
    expect(Math.abs(pointOf(head[3])[1])).toBeCloseTo(8)
  })

  // The flip follows the shaft direction, so a vertical arrow's tip extends along −y past
  // `from`, and stretch keeps the wings circular.
  it('places the head past the from end for a vertical arrow', () => {
    const ctx = makeContext()
    drawScene(ctx, arrowSceneDown(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const { shaftEnd, head } = shaftAndHead(ctx)
    const tip = pointOf(head[1])
    const base = pointOf(head[2])
    expect(tip[1]).toBeLessThan(shaftEnd[1])
    expect(tip[1]).toBeLessThan(0)
    expect(tip[1]).toBeCloseTo(-4)
    // On a vertical shaft the base coordinate is the wing's y: two widths past `from`, toward `to`.
    expect(base[1]).toBeGreaterThan(tip[1])
    expect(base[1]).toBeCloseTo(8)
    expect(tip[0]).toBeCloseTo(0)
    expect(Math.abs(pointOf(head[2])[0])).toBeCloseTo(8)
    expect(Math.abs(pointOf(head[3])[0])).toBeCloseTo(8)
  })

  // Both head paths carry the same flip: the halo's white head stroke precedes the colored
  // shaft pass, and the colored head fill follows — every head-path moveTo lands on the tip.
  it('halo head stroke shares the flipped tip past the from end', () => {
    const ctx = makeContext()
    drawScene(ctx, arrowScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const headTips = ctx.ops.filter((op) => op.method === 'moveTo' && (op.args[0] as number) < 0)
    expect(headTips).toHaveLength(2)
    expect(pointOf(headTips[0])).toEqual([-4, 0])
    expect(pointOf(headTips[1])).toEqual([-4, 0])
  })

  it('writes the measured text width back into the shape transform', () => {
    const ctx = makeContext(55)
    const scene = textScene()
    const updated = drawScene(ctx, scene, image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.ops.find((op) => op.method === 'fillText')?.args[0]).toBe('note')
    expect(updated?.shapes[0]?.transform.w).toBe(55)
    expect(scene.shapes[0]?.transform.w).toBe(43.2)
    expect(updated).not.toBe(scene)
  })

  it('returns null when the measured width already matches the estimate', () => {
    const ctx = makeContext(43.2)
    expect(drawScene(ctx, textScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })).toBeNull()
  })

  it('writes one line per fillText, stacked by the line height', () => {
    const ctx = makeContext(43.2)
    drawScene(ctx, twoLineTextScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const fills = ctx.ops.filter((op) => op.method === 'fillText')
    expect(fills.map((op) => op.args[0])).toEqual(['first', 'second'])
    // fillText takes (text, x, y): the line index drives the stacked y offset.
    expect(fills.map((op) => op.args[2])).toEqual([0, LINE_HEIGHT * 18])
  })

  it('corrects the height when the shape holds more lines than its box', () => {
    const ctx = makeContext(43.2)
    const updated = drawScene(ctx, twoLineTextScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(updated?.shapes[0]?.transform.w).toBe(43.2)
    expect(updated?.shapes[0]?.transform.h).toBe(2 * LINE_HEIGHT * 18)
  })

  // A label paints glyphs only: no halo band, no shadow, no stroke at all — the outline
  // change must not reach text rendering.
  it('paints text glyphs without any halo stroke or shadow', () => {
    const ctx = makeContext(43.2)
    drawScene(ctx, textScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(ctx)).not.toContain('stroke')
    expect(methods(ctx)).not.toContain('strokeRect')
    expect(methods(ctx)).not.toContain('fillRect')
    expect(ctx.shadowBlur).toBe(0)
    const glyphs = paintOps(ctx, 'fillText')
    expect(glyphs.every((op) => op.fillStyle === base.color && (op.shadowBlur ?? 0) === 0)).toBe(true)
  })

  // The circle is inscribed in the bbox: radius min(w,h)/2 at the bbox center.
  it('fills a step circle inscribed in the bbox in the shape color with a white border', () => {
    const ctx = makeContext()
    drawScene(ctx, stepScene(['s1']), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(ctx)).toContain('arc')
    expect(methods(ctx)).toContain('fill')
    expect(methods(ctx)).toContain('stroke')
    const arc = ctx.ops.find((op) => op.method === 'arc')
    expect(pointOf(arc)).toEqual([20, 15])
    expect(arc?.args[2]).toBeCloseTo(15)
    expect(ctx.filled).toContain('#E5484D')
    expect(ctx.strokes).toContain('#FFFFFF')
  })

  // The white ring is stroked with the shape width, so halving the step's default thickness
  // halves the border: the ring's lineWidth comes from the shape, never a fixed constant.
  it('strokes the step badge ring with the shape width as the border thickness', () => {
    const ctx = makeContext()
    drawScene(ctx, stepScene(['s1']), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.strokes).toEqual([WHITE])
    expect(ctx.strokeWidths).toEqual([4])
  })

  it('casts a drop shadow for the step circle', () => {
    const ctx = makeContext()
    drawScene(ctx, stepScene(['s1']), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.shadowBlur).toBeGreaterThan(0)
  })

  // Default badge fills are dark (#E5484D), so these digits stay white: the auto-contrast rule
  // only flips the ink for light fills, and the scene-order numbering is unchanged either way.
  it('numbers step digits by their scene order, painted white on dark badge fills', () => {
    const ctx = makeContext()
    drawScene(ctx, stepScene(['s1', 's2']), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const digits = ctx.ops.filter((op) => op.method === 'fillText')
    expect(digits.map((op) => op.args[0])).toEqual(['1', '2'])
    expect(ctx.fillTexts).toEqual(['#FFFFFF', '#FFFFFF'])
    const arcCenters = ctx.ops.filter((op) => op.method === 'arc').map((op) => pointOf(op))
    expect(digits.map((op) => textPointOf(op))).toEqual(arcCenters)
  })

  it('renumbers the remaining step after an earlier one is removed', () => {
    const ctx = makeContext()
    drawScene(ctx, removeShape(stepScene(['s1', 's2']), 's1'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.ops.filter((op) => op.method === 'fillText').map((op) => op.args[0])).toEqual(['1'])
  })

  // min(w,h) is 30 here, so the digit font scales with the circle, roughly half of it.
  it('sizes the step digit proportionally to the bbox', () => {
    const ctx = makeContext()
    drawScene(ctx, stepScene(['s1']), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const fontSize = Number.parseFloat(ctx.font)
    expect(fontSize).toBeGreaterThanOrEqual(0.35 * 30)
    expect(fontSize).toBeLessThanOrEqual(0.6 * 30)
  })

  // Auto-contrast: the digit ink follows the badge fill's relative luminance (sRGB linearized,
  // threshold 0.55), so a white badge — white-on-white otherwise — carries dark ink. The badge
  // fill op must stay the shape color: only the digit's fillStyle changes.
  it('paints the step digit in dark ink when the badge fill is white', () => {
    const ctx = makeContext()
    drawScene(ctx, tintedStepScene('#ffffff'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.filled).toContain('#ffffff')
    expect(inkOf(ctx)).toBe('#1A1A1A')
  })

  // A black badge is the far dark end: the digit stays white.
  it('paints the step digit in white when the badge fill is black', () => {
    const ctx = makeContext()
    drawScene(ctx, tintedStepScene('#000000'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.filled).toContain('#000000')
    expect(inkOf(ctx)).toBe('#FFFFFF')
  })

  // The default badge red is a mid tone (L ≈ 0.22): existing dark badges keep their white digit.
  it('keeps the step digit white for the mid-tone default badge fill', () => {
    const ctx = makeContext()
    drawScene(ctx, tintedStepScene('#e5484d'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.filled).toContain('#e5484d')
    expect(inkOf(ctx)).toBe('#FFFFFF')
  })

  // Yellow is well above the threshold (L ≈ 0.69), so it reads as light.
  it('paints the step digit in dark ink for a yellow badge fill', () => {
    const ctx = makeContext()
    drawScene(ctx, tintedStepScene('#f5d90a'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.filled).toContain('#f5d90a')
    expect(inkOf(ctx)).toBe('#1A1A1A')
  })

  // Mid grey sits below the threshold (linearized L ≈ 0.22), so it stays a dark badge.
  it('keeps the step digit white for a mid-grey badge fill below the threshold', () => {
    const ctx = makeContext()
    drawScene(ctx, tintedStepScene('#808080'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(ctx.filled).toContain('#808080')
    expect(inkOf(ctx)).toBe('#FFFFFF')
  })

  // The balloon is the ellipse inscribed in the bbox: center (30,15), radii 30 and 15.
  it('fills the speech balloon ellipse inscribed in the bbox in the shape color', () => {
    const ctx = makeContext()
    drawScene(ctx, speechScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(ctx)).toContain('ellipse')
    expect(methods(ctx)).toContain('fill')
    expect(methods(ctx)).toContain('stroke')
    const ellipse = ctx.ops.find((op) => op.method === 'ellipse')
    expect(pointOf(ellipse)).toEqual([30, 15])
    expect(ellipse?.args[2]).toBeCloseTo(30)
    expect(ellipse?.args[3]).toBeCloseTo(15)
    expect(ctx.filled).toContain('#E5484D')
    // The balloon keeps its own white border and no shadow: the halo band is only for arrow,
    // rect and leader, so speech strokes must stay shadow-free exactly as before.
    const balloon = paintOps(ctx, 'stroke')
    expect(balloon.map((op) => (op.shadowBlur ?? 0))).toEqual([0, 0])
    expect(balloon[0]?.strokeStyle).toBe('#FFFFFF')
  })

  // The tail is two lines that meet at the tip in bbox-local coords (30,44); their far ends
  // sit on the ellipse, so they stay inside the bbox.
  it('strokes a speech tail of two lines converging on the balloon tip', () => {
    const ctx = makeContext()
    drawScene(ctx, speechScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const path = ctx.ops.filter((op) => op.method === 'moveTo' || op.method === 'lineTo')
    const atTip = path.filter((op) => pointOf(op)[0] === 30 && pointOf(op)[1] === 44)
    expect(atTip.length).toBeGreaterThanOrEqual(2)
    const farEnds = path.map((op) => pointOf(op)).filter(([x, y]) => x !== 30 || y !== 44)
    expect(farEnds.length).toBeGreaterThanOrEqual(2)
    farEnds.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(60)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(30)
    })
  })

  // Balloon text is a label, not ink: white at the shape font size, centered in the bbox.
  it('paints the balloon text in white at the shape font size, centered in the bbox', () => {
    const ctx = makeContext()
    drawScene(ctx, speechScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const label = ctx.ops.find((op) => op.method === 'fillText')
    expect(label?.args[0]).toBe('hi')
    expect(ctx.fillTexts).toEqual(['#FFFFFF'])
    expect(textPointOf(label)).toEqual([30, 15])
    expect(ctx.textAlign).toBe('center')
    expect(Number.parseFloat(ctx.font)).toBeCloseTo(18)
  })

  // Multi-line labels stack around the bbox center, staying inside the balloon.
  it('stacks multiline balloon text around the bbox center', () => {
    const ctx = makeContext()
    drawScene(ctx, speechScene('first\nsecond'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const labels = ctx.ops.filter((op) => op.method === 'fillText')
    expect(labels.map((op) => op.args[0])).toEqual(['first', 'second'])
    const ys = labels.map((op) => textPointOf(op)[1])
    expect(labels.every((op) => textPointOf(op)[0] === 30)).toBe(true)
    expect(ys[1]).toBeGreaterThan(ys[0])
    expect((ys[0] + ys[1]) / 2).toBeCloseTo(15, 1)
    ys.forEach((y) => {
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(30)
    })
  })

  // The balloon IS its bbox: unlike text, measured glyphs must not rewrite the ellipse.
  it('leaves the balloon bbox untouched when the measured text is narrower', () => {
    const ctx = makeContext(4)
    const scene = speechScene()
    const updated = drawScene(ctx, scene, image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(updated).toBeNull()
    expect(scene.shapes[0]?.transform).toEqual({ x: 20, y: 30, w: 60, h: 30, rotation: 0 })
  })

  // The dot is thicker than the stroke: its fill radius must exceed the shape width.
  it('fills a thick dot at the leader start in the shape color', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(ctx)).toContain('arc')
    expect(methods(ctx)).toContain('fill')
    const dot = ctx.ops.find((op) => op.method === 'arc')
    expect(pointOf(dot)).toEqual([0, 30])
    expect(dot?.args[2]).toBeGreaterThan(base.width)
    expect(ctx.filled).toContain('#E5484D')
  })

  // A callout shaft is stroked like an arrow's but has no triangular head.
  it('strokes the leader shaft from dot to shelf end without an arrowhead', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(ctx)).toContain('stroke')
    expect(ctx.strokes).toContain('#E5484D')
    expect(methods(ctx)).not.toContain('closePath')
    const path = ctx.ops.filter((op) => op.method === 'moveTo' || op.method === 'lineTo').map((op) => pointOf(op))
    expect(path).toEqual(expect.arrayContaining([[0, 30], [60, 0]]))
  })

  // The dot sits left of the shelf end, so the shelf runs rightward past it, at the shaft's end y.
  // Its span is the fixed shelf length, not a function of the label.
  it('strokes a horizontal shelf of the fixed length from the leader end away from the dot', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(shelfPoints(ctx).length).toBeGreaterThanOrEqual(2)
    const xs = shelfPoints(ctx).map(([x]) => x)
    expect(Math.min(...xs)).toBe(60)
    expect(Math.max(...xs)).toBe(60 + shelfLength)
    expect(Math.max(...xs) - Math.min(...xs)).toBe(shelfLength)
  })

  // A left drag flips the shelf: it starts at the shelf end and runs leftward, same length.
  it('strokes a left-drag shelf running leftward from the leader end', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderLeftScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const xs = shelfPoints(ctx).map(([x]) => x)
    expect(Math.min(...xs)).toBe(-shelfLength)
    expect(Math.max(...xs)).toBe(0)
  })

  // Unlike the balloon, the callout text is ink: shape color, centered on the shelf line exactly
  // like a multi-line block (topY = span.y − band/2), anchored at the far shelf tip so it never
  // hangs past the end. A right drag right-aligns at x1.
  // The label no longer sits crammed on the shelf: it starts LEADER_LABEL_GAP px past the far
  // tip, aligned outward, so the gap strip between tip and label stays bare.
  it('paints the single-line leader label centered on the shelf line, shifted past the far tip', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const label = ctx.ops.find((op) => op.method === 'fillText')
    expect(label?.args[0]).toBe('note')
    expect(ctx.fillTexts).toEqual(['#E5484D'])
    const [textX, textY] = textPointOf(label)
    expect(textX).toBe(60 + shelfLength + 12)
    expect(label?.textAlign).toBe('left')
    // One line is band 27 (LINE_HEIGHT × 18) centered on shelf y 0: its top sits half a band above.
    expect(textY).toBe(-(LINE_HEIGHT * 18) / 2)
    expect(Number.parseFloat(ctx.font)).toBeCloseTo(18)
  })

  // A left drag mirrors it: the block starts 12 px past the left tip, right-aligned against it,
  // so the label clears the shelf on the far side instead of overlapping it.
  it('anchors a left-drag label past the left shelf tip with textAlign right', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderLeftScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const label = ctx.ops.find((op) => op.method === 'fillText')
    expect(textPointOf(label)[0]).toBe(-shelfLength - 12)
    expect(label?.textAlign).toBe('right')
    expect(textPointOf(label)[1]).toBe(-(LINE_HEIGHT * 18) / 2)
  })

  // Two lines straddle the shelf: the block is vertically centered on it, so the first line's
  // top sits half a band above and the second line's top sits at the shelf's own y.
  it('centers a multi-line label block across the shelf line', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderScene('first\nsecond'), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const labels = ctx.ops.filter((op) => op.method === 'fillText')
    expect(labels.map((op) => op.args[0])).toEqual(['first', 'second'])
    expect(labels.every((op) => textPointOf(op)[0] === 60 + shelfLength + 12)).toBe(true)
    expect(labels.every((op) => op.textAlign === 'left')).toBe(true)
    expect(labels.map((op) => textPointOf(op)[1])).toEqual([-LINE_HEIGHT * 18, 0])
  })

  // The Step-style outline on a callout: white halo strokes over the dot arc, shaft and shelf
  // carry the badge's shadow before any colored pass; the label stays plain ink, halo-free.
  it('strokes a white shadowed halo for the leader dot shaft and shelf before the color passes', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    const strokes = paintOps(ctx, 'stroke')
    expect(strokes).toHaveLength(5)
    expect(strokes.slice(0, 3).every((op) => isHaloWhite(op.strokeStyle) && isHaloShadow(op.shadowColor) && (op.shadowBlur ?? 0) > 0)).toBe(true)
    expect(strokes.slice(0, 3).every((op) => op.lineWidth === base.width + 4)).toBe(true)
    expect(strokes.slice(3).every((op) => op.strokeStyle === base.color && op.lineWidth === base.width && op.shadowBlur === 0)).toBe(true)
    const dotFill = paintOps(ctx, 'fill')[0]
    if (!dotFill) throw new Error('the leader dot must be filled')
    expect(dotFill.fillStyle).toBe(base.color)
    expect(dotFill.shadowBlur).toBe(0)
    // The dot's white halo arc is stroked before the colored dot fill.
    expect(ctx.ops.indexOf(strokes[0])).toBeLessThan(ctx.ops.indexOf(dotFill))
    // The label is ink, not a badge: fillText carries no halo band and no shadow.
    const label = paintOps(ctx, 'fillText')[0]
    expect(label?.fillStyle).toBe(base.color)
    expect(label?.shadowBlur).toBe(0)
  })

  // The callout IS its shaft geometry: unlike text, measured glyphs must not rewrite the bbox.
  it('leaves the leader bbox untouched when the measured text is wider', () => {
    const ctx = makeContext(200)
    const scene = leaderScene()
    expect(drawScene(ctx, scene, image, { scale: 1, offsetX: 0, offsetY: 0 })).toBeNull()
    expect(scene.shapes[0]?.transform).toEqual({ x: 20, y: 10, w: 60, h: 30, rotation: 0 })
  })

  // A click without a drag collapses dot and shelf to one point: drawing must not degenerate.
  it('draws a degenerate leader without crashing', () => {
    const ctx = makeContext()
    const scene = createScene([
      { id: 'l0', kind: 'leader', ...base, transform: { x: 5, y: 5, w: 0, h: 0, rotation: 0 }, from: [0, 0], to: [0, 0], text: '', fontSize: 18 },
    ])
    expect(() => drawScene(ctx, scene, image, { scale: 1, offsetX: 0, offsetY: 0 })).not.toThrow()
    expect(methods(ctx)).toContain('arc')
  })

  // A degenerate arrow (from == to) keeps the same crash guard after the head flip: the head
  // path clamps its own length, so tip and wings stay finite and the head fill still paints.
  it('draws a degenerate arrow without crashing', () => {
    const ctx = makeContext()
    const scene = createScene([
      { id: 'pin', kind: 'arrow', ...base, transform: { x: 5, y: 5, w: 0, h: 0, rotation: 0 }, from: [0, 0], to: [0, 0] },
    ])
    expect(() => drawScene(ctx, scene, image, { scale: 1, offsetX: 0, offsetY: 0 })).not.toThrow()
    const headPaths = ctx.ops.filter((op) => op.method === 'moveTo')
    expect(headPaths.every((op) => op.args.every((arg) => Number.isFinite(arg)))).toBe(true)
    expect(ctx.ops.filter((op) => op.method === 'fill')).toHaveLength(1)
  })

  it('draws the selection overlay only for the selected shape', () => {
    const selected = makeContext()
    drawScene(selected, markerScene(), image, { scale: 2, offsetX: 0, offsetY: 0 }, ['m1'])
    const order = methods(selected)
    expect(order).toContain('setLineDash')
    expect(order).toContain('arc')
    // Stage 8: the eight resize slots are circles, the center drag square is the only fillRect,
    // the rotate circle stays the last arc, and every mark carries a white outline.
    expect(selected.ops.filter((op) => op.method === 'fillRect')).toHaveLength(1)
    expect(arcCenters(selected)).toHaveLength(9)
    expect(arcCenters(selected)[0]).toEqual([10, 10])
    expect(arcCenters(selected)[8]).toEqual([30, -14])
    expect(selected.ops.filter((op) => op.method === 'arc')[0]?.args[2]).toBeCloseTo(2, 6)
    expect(selected.strokes.filter((style) => style === WHITE)).toHaveLength(10)
    expect(selected.filled.every((fill) => fill === HANDLE_COLOR)).toBe(true)
    expect(selected.fills).toEqual([HANDLE_COLOR])
    const square = selected.ops.find((op) => op.method === 'fillRect')
    if (!square) throw new Error('the center square must be painted')
    expect([Number(square.args[0]) + Number(square.args[2]) / 2, Number(square.args[1]) + Number(square.args[3]) / 2]).toEqual([30, 15])

    const plain = makeContext()
    drawScene(plain, markerScene(), image, { scale: 1, offsetX: 0, offsetY: 0 })
    expect(methods(plain)).not.toContain('setLineDash')

    const missing = makeContext()
    drawScene(missing, markerScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, ['ghost'])
    expect(methods(missing)).not.toContain('setLineDash')
  })

  it('draws a dashed bbox for every selected shape and handles only for one', () => {
    const scene = createScene([
      { id: 'm1', kind: 'marker', ...base, transform: { x: 10, y: 10, w: 40, h: 10, rotation: 0 }, points: [0, 0, 40, 10] },
      { id: 'm2', kind: 'marker', ...base, transform: { x: 100, y: 100, w: 20, h: 20, rotation: 0 }, points: [0, 0, 20, 20] },
    ])
    const multi = makeContext()
    drawScene(multi, scene, image, { scale: 2, offsetX: 0, offsetY: 0 }, ['m1', 'm2'])
    const dashes = multi.ops.filter((op) => op.method === 'setLineDash')
    expect(dashes).toHaveLength(2)
    expect(dashes.map((op) => op.args[0])).toEqual([[3, 2], [3, 2]])
    // Both bboxes are stroked, and a multi-selection has no resize or rotate handles.
    expect(multi.ops.filter((op) => op.method === 'stroke')).toHaveLength(4)
    expect(multi.ops.filter((op) => op.method === 'fillRect')).toHaveLength(0)
    expect(methods(multi)).not.toContain('arc')
    const corners = multi.ops.filter((op) => op.method === 'moveTo' || op.method === 'lineTo').map((op) => [op.args[0], op.args[1]])
    expect(corners).toEqual(expect.arrayContaining([[10, 10], [50, 20], [100, 100], [120, 120]]))
  })

  it('draws the live rubber band as a dashed rect in world space', () => {
    const ctx = makeContext()
    drawScene(ctx, markerScene(), image, { scale: 2, offsetX: 0, offsetY: 0 }, [], { x: 20, y: 30, w: 50, h: 40, rotation: 0 })
    expect(methods(ctx)).toContain('setLineDash')
    expect(ctx.ops.find((op) => op.method === 'strokeRect')?.args).toEqual([20, 30, 50, 40])
    expect(methods(ctx)).not.toContain('fillRect')
  })

  it('fills handles dark, outlines them white and strokes the bbox in the passed selection color', () => {
    const ctx = makeContext()
    drawScene(ctx, markerScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, ['m1'], undefined, '#FFD666')
    // Shapes first, then the dashed bbox, then the white outlines of the ten handle marks.
    expect(ctx.strokes).toEqual(['#E5484D', '#FFD666', ...Array.from({ length: 10 }, () => WHITE)])
    expect(ctx.fills).toHaveLength(1)
    expect(ctx.filled).toHaveLength(9)
    expect(ctx.filled.every((fill) => fill === HANDLE_COLOR)).toBe(true)
    expect(ctx.fills.every((fill) => fill === HANDLE_COLOR)).toBe(true)
  })

  it('falls back to OVERLAY_COLOR when no selection color is passed', () => {
    const ctx = makeContext()
    drawScene(ctx, markerScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, ['m1'])
    // The bbox outline is no longer the last stroke: the handle outlines paint after it.
    expect(ctx.strokes).toContain(OVERLAY_COLOR)
    expect(ctx.strokes.at(-1)).toBe(WHITE)
  })

  it('strokes the rubber band in the passed selection color', () => {
    const ctx = makeContext()
    drawScene(ctx, markerScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, [], { x: 20, y: 30, w: 50, h: 40, rotation: 0 }, '#2F80ED')
    expect(ctx.strokes.at(-1)).toBe('#2F80ED')
  })

  // Stage 7: an arrow or a leader is selected by endpoints, so its overlay is two endpoint dots
  // plus one draggable center square — no dashed bbox outline and no rotate circle.
  it('draws endpoint dots and a center square for a lone selected arrow, with no bbox outline', () => {
    const ctx = makeContext()
    drawScene(ctx, arrowScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, ['a1'])
    expect(methods(ctx)).not.toContain('setLineDash')
    // The shaft stroke stays the last stroke: the overlay paints no outline of its own.
    expect(ctx.strokes.at(-1)).toBe('#E5484D')
    expect(ctx.ops.filter((op) => op.method === 'arc').map((op) => pointOf(op))).toEqual([[0, 20], [50, 20]])
    const squares = ctx.ops.filter((op) => op.method === 'fillRect')
    expect(squares).toHaveLength(1)
    expect(ctx.fills).toEqual([HANDLE_COLOR])
    const square = squares[0]
    if (!square) throw new Error('the center square must be painted')
    expect([Number(square.args[0]) + Number(square.args[2]) / 2, Number(square.args[1]) + Number(square.args[3]) / 2]).toEqual([25, 20])
  })

  it('draws dot, shelf dots and a center square for a lone selected leader, with no bbox outline', () => {
    const ctx = makeContext()
    drawScene(ctx, leaderScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, ['l1'])
    expect(methods(ctx)).not.toContain('setLineDash')
    expect(ctx.strokes.at(-1)).toBe('#E5484D')
    // The leader paints its own dot first at its bbox-local slot; the overlay adds the two marks
    // in world space and nothing at the rotate slot. The haloed dot may stroke through its own
    // arc or a second one, so only the count's lower bound is pinned.
    const arcs = ctx.ops.filter((op) => op.method === 'arc').map((op) => pointOf(op))
    expect(arcs.length).toBeGreaterThanOrEqual(3)
    expect(arcs).toEqual(expect.arrayContaining([[20, 40], [80, 10]]))
    const squares = ctx.ops.filter((op) => op.method === 'fillRect')
    expect(squares).toHaveLength(1)
    expect(ctx.fills).toEqual([HANDLE_COLOR])
    const square = squares[0]
    if (!square) throw new Error('the center square must be painted')
    expect([Number(square.args[0]) + Number(square.args[2]) / 2, Number(square.args[1]) + Number(square.args[3]) / 2]).toEqual([50, 25])
  })

  it('keeps the dashed outline, slot circles, a center square and a white-outlined rotate for a lone selected rect', () => {
    const ctx = makeContext()
    drawScene(ctx, rectScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, ['r1'])
    expect(methods(ctx)).toContain('setLineDash')
    expect(arcCenters(ctx)).toEqual([[20, 30], [50, 30], [80, 30], [80, 50], [80, 70], [50, 70], [20, 70], [20, 50], [50, 6]])
    expect(ctx.ops.filter((op) => op.method === 'fillRect')).toHaveLength(1)
    // The rect's white halo strokeRect comes first, then its colored strokeRect, then the
    // dashed bbox, then ten white handle outlines. Case-insensitive: the halo spelling is the
    // recipe's lowercase, the handle rings the renderer's uppercase.
    expect(ctx.strokes.map((style) => style.toUpperCase())).toEqual(['#FFFFFF', '#E5484D', OVERLAY_COLOR, ...Array.from({ length: 10 }, () => WHITE)])
    expect(ctx.filled.every((fill) => fill === HANDLE_COLOR)).toBe(true)
  })

  it('keeps the dashed outline, slot circles, a center square and a white-outlined rotate for a lone selected label', () => {
    const ctx = makeContext()
    drawScene(ctx, textScene(), image, { scale: 1, offsetX: 0, offsetY: 0 }, ['t1'])
    expect(methods(ctx)).toContain('setLineDash')
    expect(arcCenters(ctx)).toHaveLength(9)
    expect(ctx.ops.filter((op) => op.method === 'fillRect')).toHaveLength(1)
    // A label paints its glyphs, never a stroke: the bbox outline is the first stroke here.
    expect(ctx.strokes).toEqual([OVERLAY_COLOR, ...Array.from({ length: 10 }, () => WHITE)])
  })

  it('keeps the dashed bbox outline and no endpoint marks for an arrow inside a multi-selection', () => {
    const scene = createScene([
      { id: 'a1', kind: 'arrow', ...base, transform: { x: 0, y: 20, w: 50, h: 0, rotation: 0 }, from: [0, 0], to: [50, 0] },
      { id: 'r1', kind: 'rect', ...base, transform: { x: 20, y: 30, w: 60, h: 40, rotation: 0 } },
    ])
    const ctx = makeContext()
    drawScene(ctx, scene, image, { scale: 1, offsetX: 0, offsetY: 0 }, ['a1', 'r1'])
    expect(ctx.ops.filter((op) => op.method === 'setLineDash')).toHaveLength(2)
    expect(ctx.ops.filter((op) => op.method === 'fillRect')).toHaveLength(0)
    expect(methods(ctx)).not.toContain('arc')
  })
})

describe('resizeCanvas', () => {
  it('sizes the backing store by the DPR and keeps CSS pixel styles', () => {
    const canvas = { width: 0, height: 0, style: {} as CSSStyleDeclaration }
    resizeCanvas(canvas as unknown as HTMLCanvasElement, 300, 200, 2)
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(400)
    expect(canvas.style.width).toBe('300px')
    expect(canvas.style.height).toBe('200px')
  })

  it('rounds fractional DPR sizes', () => {
    const canvas = { width: 0, height: 0, style: {} as CSSStyleDeclaration }
    resizeCanvas(canvas as unknown as HTMLCanvasElement, 201, 100, 1.5)
    expect(canvas.width).toBe(302)
    expect(canvas.height).toBe(150)
  })
})
