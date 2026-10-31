import { describe, expect, it } from 'vitest'
import { DEFAULT_COLOR, DEFAULT_FONT_SIZE, GLYPH_WIDTH, HIGHLIGHTER_OPACITY, LINE_HEIGHT } from '../../src/scene.ts'
import type { Shape } from '../../src/scene.ts'
import { localToWorld } from '../../src/transform.ts'
import { EDITOR_TOOLS, toolRegistry } from '../../src/tools.ts'

const defaults = { color: DEFAULT_COLOR, width: 4 }

function freehandOf(draft: Shape) {
  if (draft.kind !== 'marker' && draft.kind !== 'highlighter') {
    throw new Error(`expected a freehand shape, got ${draft.kind}`)
  }
  return draft
}

function arrowOf(draft: Shape) {
  if (draft.kind !== 'arrow') throw new Error(`expected an arrow shape, got ${draft.kind}`)
  return draft
}

function rectOf(draft: Shape) {
  if (draft.kind !== 'rect') throw new Error(`expected a rect shape, got ${draft.kind}`)
  return draft
}

function textOf(draft: Shape) {
  if (draft.kind !== 'text') throw new Error(`expected a text shape, got ${draft.kind}`)
  return draft
}

function stepTool() {
  const tool = toolRegistry.step
  if (!tool) throw new Error('tool registry has no step gesture')
  return tool
}

function stepOf(draft: Shape) {
  if (draft.kind !== 'step') throw new Error(`expected a step shape, got ${draft.kind}`)
  return draft
}

function speechTool() {
  const tool = toolRegistry.speech
  if (!tool) throw new Error('tool registry has no speech gesture')
  return tool
}

function speechOf(draft: Shape) {
  if (draft.kind !== 'speech') throw new Error(`expected a speech shape, got ${draft.kind}`)
  return draft
}

function leaderTool() {
  const tool = toolRegistry.leader
  if (!tool) throw new Error('tool registry has no leader gesture')
  return tool
}

function leaderOf(draft: Shape) {
  if (draft.kind !== 'leader') throw new Error(`expected a leader shape, got ${draft.kind}`)
  return draft
}

describe('tool registry', () => {
  it('lists the toolbar with select first, leader last and registers only the drawing tools', () => {
    expect(EDITOR_TOOLS).toEqual(['select', 'marker', 'highlighter', 'arrow', 'rect', 'text', 'step', 'speech', 'leader'])
    // select is a pointer tool: it has no gesture, so it is absent from the registry.
    expect(Object.keys(toolRegistry)).toEqual(EDITOR_TOOLS.filter((tool) => tool !== 'select'))
  })

  it('marker accumulates gesture points in bbox-local coordinates', () => {
    const gesture = toolRegistry.marker.begin({ x: 10, y: 20 }, defaults)
    gesture.extend({ x: 30, y: 25 })
    gesture.extend({ x: 40, y: 10 })
    const shape = freehandOf(gesture.finish())
    expect(shape.kind).toBe('marker')
    expect(shape.color).toBe(DEFAULT_COLOR)
    expect(shape.width).toBe(4)
    expect(shape.opacity).toBe(1)
    expect(shape.transform).toEqual({ x: 10, y: 10, w: 30, h: 15, rotation: 0 })
    expect(shape.points).toHaveLength(6)
    const xs = shape.points.filter((_, index) => index % 2 === 0)
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(30)
  })

  it('single-point marker gesture yields a zero-size box', () => {
    const shape = freehandOf(toolRegistry.marker.begin({ x: 7, y: 9 }, defaults).finish())
    expect(shape.transform).toEqual({ x: 7, y: 9, w: 0, h: 0, rotation: 0 })
    expect(shape.points).toEqual([0, 0])
  })

  it('highlighter draws with the base color and width at 0.4 opacity', () => {
    const shape = freehandOf(toolRegistry.highlighter.begin({ x: 0, y: 0 }, defaults).finish())
    expect(shape.kind).toBe('highlighter')
    expect(shape.color).toBe(DEFAULT_COLOR)
    expect(shape.width).toBe(4)
    expect(shape.opacity).toBe(HIGHLIGHTER_OPACITY)
  })

  it('highlighter honors a chosen color and thickness instead of forcing its own', () => {
    const shape = freehandOf(toolRegistry.highlighter.begin({ x: 0, y: 0 }, { color: '#2F80ED', width: 2 }).finish())
    expect(shape.color).toBe('#2F80ED')
    expect(shape.width).toBe(2)
    expect(shape.opacity).toBe(HIGHLIGHTER_OPACITY)
  })

  it('arrow keeps its direction inside the bbox', () => {
    const gesture = toolRegistry.arrow.begin({ x: 40, y: 30 }, defaults)
    gesture.extend({ x: 10, y: 10 })
    const shape = arrowOf(gesture.finish())
    expect(shape.kind).toBe('arrow')
    expect(shape.transform).toEqual({ x: 10, y: 10, w: 30, h: 20, rotation: 0 })
    expect(shape.from[0]).toBeGreaterThan(shape.to[0])
    expect(shape.from[1]).toBeGreaterThan(shape.to[1])
  })

  it('arrow gesture with no extend yields a zero-size box at the origin', () => {
    const shape = arrowOf(toolRegistry.arrow.begin({ x: 40, y: 30 }, defaults).finish())
    expect(shape.transform).toEqual({ x: 40, y: 30, w: 0, h: 0, rotation: 0 })
    expect(shape.from).toEqual([0, 0])
    expect(shape.to).toEqual([0, 0])
  })

  it('rect drag from bottom-right to top-left yields a positive min-corner box', () => {
    const gesture = toolRegistry.rect.begin({ x: 50, y: 60 }, defaults)
    gesture.extend({ x: 12, y: 20 })
    const shape = rectOf(gesture.finish())
    expect(shape.kind).toBe('rect')
    expect(shape.transform).toEqual({ x: 12, y: 20, w: 38, h: 40, rotation: 0 })
    expect(shape.fill).toBeUndefined()
  })

  it('rect drag from top-left to bottom-right yields the same normalized box', () => {
    const gesture = toolRegistry.rect.begin({ x: 12, y: 20 }, defaults)
    gesture.extend({ x: 50, y: 60 })
    expect(rectOf(gesture.finish()).transform).toEqual({ x: 12, y: 20, w: 38, h: 40, rotation: 0 })
  })

  it('text stores content in a box anchored at the gesture point', () => {
    const gesture = toolRegistry.text.begin({ x: 5, y: 8 }, defaults)
    gesture.withText('hello')
    const shape = textOf(gesture.finish())
    expect(shape.kind).toBe('text')
    expect(shape.text).toBe('hello')
    expect(shape.fontSize).toBeGreaterThan(0)
    expect(shape.transform).toMatchObject({ x: 5, y: 8, rotation: 0 })
    expect(shape.transform.w).toBeGreaterThan(0)
    expect(shape.transform.h).toBeGreaterThan(0)
  })

  it('text box grows with longer content and a larger font size', () => {
    const small = toolRegistry.text.begin({ x: 0, y: 0 }, defaults)
    small.withText('a')
    const long = toolRegistry.text.begin({ x: 0, y: 0 }, defaults)
    long.withText('aaaa')
    expect(textOf(long.finish()).transform.w).toBeGreaterThan(textOf(small.finish()).transform.w)

    const bigFont = toolRegistry.text.begin({ x: 0, y: 0 }, defaults)
    bigFont.withText('a', 48)
    expect(textOf(bigFont.finish()).transform.h).toBeGreaterThan(textOf(small.finish()).transform.h)
    expect(textOf(bigFont.finish()).transform.w).toBeGreaterThan(textOf(small.finish()).transform.w)
  })

  it('multiline text stacks lines and sizes the box by the longest line', () => {
    const gesture = toolRegistry.text.begin({ x: 4, y: 6 }, defaults)
    gesture.withText('one\ntwo longer line', 24)
    const shape = textOf(gesture.finish())
    expect(shape.text).toBe('one\ntwo longer line')
    expect(shape.fontSize).toBe(24)
    expect(shape.transform.h).toBe(2 * LINE_HEIGHT * 24)
    expect(shape.transform.w).toBe('two longer line'.length * GLYPH_WIDTH * 24)
  })

  it('registers a step drawing tool', () => {
    expect(stepTool().kind).toBe('step')
  })

  it('step drag defines a normalized bbox like the rect gesture', () => {
    const gesture = stepTool().begin({ x: 50, y: 60 }, defaults)
    gesture.extend({ x: 12, y: 20 })
    const shape = stepOf(gesture.finish())
    expect(shape.kind).toBe('step')
    expect(shape.color).toBe(DEFAULT_COLOR)
    expect(shape.width).toBe(4)
    expect(shape.opacity).toBe(1)
    expect(shape.transform).toEqual({ x: 12, y: 20, w: 38, h: 40, rotation: 0 })
  })

  // The digit is derived at render from scene order, so the draft must store no payload.
  // A dragless press is a badge, not an empty box: the minimum diameter is 36 px, centred
  // on the press point (midpoint of origin and the untouched corner).
  it('step dragless press yields a minimum-size badge centred on the click and carries no payload', () => {
    const shape = stepOf(stepTool().begin({ x: 0, y: 0 }, defaults).finish())
    expect(shape).toEqual({ kind: 'step', color: DEFAULT_COLOR, width: 4, opacity: 1, transform: { x: -18, y: -18, w: 36, h: 36, rotation: 0 } })
  })
})

describe('speech balloon tool', () => {
  // Speech is a text tool: the click only places the tip, the content arrives through withText.
  it('registers a speech text tool', () => {
    expect(speechTool().kind).toBe('speech')
  })

  // The tip is the click point, stored in bbox-local coords like an arrow endpoint, so the
  // estimated box has to sit away from it: mapping the anchor back out lands on the click.
  it('speech click pins the balloon tip at the click point inside a box away from it', () => {
    const gesture = speechTool().begin({ x: 5, y: 8 }, defaults)
    gesture.withText('hello')
    const shape = speechOf(gesture.finish())
    expect(shape.kind).toBe('speech')
    expect(shape.text).toBe('hello')
    expect(shape.fontSize).toBeGreaterThan(0)
    expect(shape.transform).toMatchObject({ rotation: 0 })
    expect(shape.transform.w).toBeGreaterThan(0)
    expect(shape.transform.h).toBeGreaterThan(0)
    // The tip is the bottom-center of the box, so the balloon rises above the click.
    expect(shape.anchor).toEqual({ x: shape.transform.w / 2, y: shape.transform.h })
    const tip = localToWorld(shape.transform, shape.anchor)
    expect(tip.x).toBeCloseTo(5, 6)
    expect(tip.y).toBeCloseTo(8, 6)
  })

  it('speech draft starts with empty text and the default font size', () => {
    const shape = speechOf(speechTool().begin({ x: 30, y: 40 }, defaults).finish())
    expect(shape.text).toBe('')
    expect(shape.fontSize).toBe(DEFAULT_FONT_SIZE)
    expect(shape.transform.w).toBe(0)
    expect(shape.transform.h).toBeGreaterThan(0)
    expect(shape.anchor).toEqual({ x: 0, y: shape.transform.h })
  })

  it('speech box grows with longer content and a larger font size', () => {
    const small = speechTool().begin({ x: 0, y: 0 }, defaults)
    small.withText('a')
    const long = speechTool().begin({ x: 0, y: 0 }, defaults)
    long.withText('aaaa')
    expect(speechOf(long.finish()).transform.w).toBeGreaterThan(speechOf(small.finish()).transform.w)

    const bigFont = speechTool().begin({ x: 0, y: 0 }, defaults)
    bigFont.withText('a', 48)
    expect(speechOf(bigFont.finish()).fontSize).toBe(48)
    expect(speechOf(bigFont.finish()).transform.h).toBeGreaterThan(speechOf(small.finish()).transform.h)
  })

  it('multiline speech stacks lines and sizes the box by the longest line', () => {
    const gesture = speechTool().begin({ x: 4, y: 6 }, defaults)
    gesture.withText('one\ntwo longer line', 24)
    const shape = speechOf(gesture.finish())
    expect(shape.text).toBe('one\ntwo longer line')
    expect(shape.fontSize).toBe(24)
    expect(shape.transform.h).toBe(2 * LINE_HEIGHT * 24)
    expect(shape.transform.w).toBe('two longer line'.length * GLYPH_WIDTH * 24)
    const tip = localToWorld(shape.transform, shape.anchor)
    expect(tip.x).toBeCloseTo(4, 6)
    expect(tip.y).toBeCloseTo(6, 6)
  })

  // Dragging places nothing, exactly like the text gesture: the tip stays at the press point.
  it('speech drag leaves the tip at the click and the content empty', () => {
    const gesture = speechTool().begin({ x: 10, y: 12 }, defaults)
    gesture.extend({ x: 40, y: 20 })
    const shape = speechOf(gesture.finish())
    expect(shape.text).toBe('')
    const tip = localToWorld(shape.transform, shape.anchor)
    expect(tip.x).toBeCloseTo(10, 6)
    expect(tip.y).toBeCloseTo(12, 6)
  })

  it('speech honors the chosen color and thickness', () => {
    const shape = speechOf(speechTool().begin({ x: 0, y: 0 }, { color: '#2F80ED', width: 2 }).finish())
    expect(shape.color).toBe('#2F80ED')
    expect(shape.width).toBe(2)
    expect(shape.opacity).toBe(1)
  })
})

describe('leader callout tool', () => {
  it('registers a leader drawing tool', () => {
    expect(leaderTool().kind).toBe('leader')
  })

  // Like the arrow gesture: the press pins the dot, the release pins the shelf end.
  it('leader drag normalizes the bbox and stores both endpoints bbox-local', () => {
    const gesture = leaderTool().begin({ x: 40, y: 30 }, defaults)
    gesture.extend({ x: 10, y: 10 })
    const shape = leaderOf(gesture.finish())
    expect(shape.kind).toBe('leader')
    expect(shape.color).toBe(DEFAULT_COLOR)
    expect(shape.width).toBe(4)
    expect(shape.opacity).toBe(1)
    expect(shape.transform).toEqual({ x: 10, y: 10, w: 30, h: 20, rotation: 0 })
    expect(shape.from).toEqual([30, 20])
    expect(shape.to).toEqual([0, 0])
  })

  it('leader drag from top-left to bottom-right yields the same normalized box with mirrored endpoints', () => {
    const gesture = leaderTool().begin({ x: 10, y: 10 }, defaults)
    gesture.extend({ x: 40, y: 30 })
    const shape = leaderOf(gesture.finish())
    expect(shape.transform).toEqual({ x: 10, y: 10, w: 30, h: 20, rotation: 0 })
    expect(shape.from).toEqual([0, 0])
    expect(shape.to).toEqual([30, 20])
  })

  it('leader gesture with no extend yields a zero-size box with both endpoints at the press point', () => {
    const shape = leaderOf(leaderTool().begin({ x: 40, y: 30 }, defaults).finish())
    expect(shape.transform).toEqual({ x: 40, y: 30, w: 0, h: 0, rotation: 0 })
    expect(shape.from).toEqual([0, 0])
    expect(shape.to).toEqual([0, 0])
  })

  // The callout is drag-based, unlike text: finish() before any UI commit carries empty content.
  it('leader draft starts with empty text and the default font size', () => {
    const shape = leaderOf(leaderTool().begin({ x: 0, y: 0 }, defaults).finish())
    expect(shape.text).toBe('')
    expect(shape.fontSize).toBe(DEFAULT_FONT_SIZE)
  })

  // extend drags the shelf end, not the content; a plain Gesture, not a TextGesture.
  it('leader gesture is drag-based: extend moves the shelf end, content stays empty', () => {
    const gesture = leaderTool().begin({ x: 0, y: 0 }, defaults)
    expect((gesture as { withText?: unknown }).withText).toBeUndefined()
    gesture.extend({ x: 20, y: 5 })
    const shape = leaderOf(gesture.finish())
    expect(shape.text).toBe('')
    expect(shape.to).toEqual([20, 5])
  })

  it('leader honors the chosen color and thickness', () => {
    const shape = leaderOf(leaderTool().begin({ x: 0, y: 0 }, { color: '#2F80ED', width: 2 }).finish())
    expect(shape.color).toBe('#2F80ED')
    expect(shape.width).toBe(2)
    expect(shape.opacity).toBe(1)
  })
})
