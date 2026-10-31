import { describe, expect, it } from 'vitest'
import {
  COLOR_PRESETS,
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_PRESETS,
  GLYPH_WIDTH,
  LINE_HEIGHT,
  DEFAULT_WIDTH,
  HIGHLIGHTER_COLOR,
  HIGHLIGHTER_WIDTH,
  TOOL_DEFAULT_COLORS,
  TOOL_DEFAULT_WIDTHS,
  WIDTH_PRESETS,
  textExtent,
  addShape,
  counterIds,
  createScene,
  defaultToolColor,
  defaultToolWidth,
  defaultsFor,
  removeShape,
  replaceShape,
  shapeOf,
  shapesOf,
  setDefaults,
} from '../../src/scene.ts'

// The fixed shelf span arrives with the implementation pass. Reading it off the module namespace —
// rather than importing the names — keeps a missing export failing only the span tests below
// instead of breaking this whole file at load.
const sceneExports = await import('../../src/scene.ts')

const rectDraft = {
  kind: 'rect',
  color: '#1A1A1A',
  width: 4,
  opacity: 1,
  transform: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
}

// A step carries no payload: the visible digit is derived at render from scene order.
const stepDraft = {
  kind: 'step',
  color: '#E5484D',
  width: 8,
  opacity: 1,
  transform: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
}

// A balloon carries its tip, text and font size. The tip is bbox-local, like an arrow endpoint.
const speechDraft = {
  kind: 'speech',
  color: '#E5484D',
  width: 8,
  opacity: 1,
  transform: { x: 0, y: 0, w: 40, h: 20, rotation: 0 },
  anchor: { x: 20, y: 26 },
  text: 'hi',
  fontSize: 18,
}

// A leader callout carries its endpoints, text and font size. The endpoints are bbox-local,
// like arrow endpoints: the dot sits at `from`, the shelf and text at `to`.
const leaderDraft = {
  kind: 'leader',
  color: '#E5484D',
  width: 8,
  opacity: 1,
  transform: { x: 20, y: 10, w: 60, h: 30, rotation: 0 },
  from: [0, 30],
  to: [60, 0],
  text: 'hi',
  fontSize: 18,
}

describe('scene defaults', () => {
  it('starts with the documented red color and width 8', () => {
    expect(createScene().defaults).toEqual({ color: '#E5484D', width: 8 })
    expect(DEFAULT_COLOR).toBe('#E5484D')
    expect(DEFAULT_WIDTH).toBe(8)
  })

  it('highlighter keeps the base color and width and overrides only opacity 0.4', () => {
    expect(HIGHLIGHTER_COLOR).toBe('#FFD666')
    expect(defaultsFor('highlighter', { color: DEFAULT_COLOR, width: 2 })).toEqual({
      color: DEFAULT_COLOR,
      width: 2,
      opacity: 0.4,
    })
    expect(defaultsFor('highlighter', { color: '#2F80ED', width: 8 })).toEqual({
      color: '#2F80ED',
      width: 8,
      opacity: 0.4,
    })
  })

  // The thick 14 px default reaches the highlighter through TOOL_DEFAULT_WIDTHS, which the
  // editor applies as the scene default when the tool is picked — not as a defaultsFor override.
  it('highlighter resolves to 14 px from the tool default width', () => {
    expect(defaultsFor('highlighter', { color: DEFAULT_COLOR, width: defaultToolWidth('highlighter') })).toEqual({
      color: DEFAULT_COLOR,
      width: HIGHLIGHTER_WIDTH,
      opacity: 0.4,
    })
  })

  it('keeps marker, arrow, rect, step, text, speech and leader opaque with the scene defaults', () => {
    const sceneDefaults = { color: '#2F80ED', width: 8 }
    expect(defaultsFor('marker', sceneDefaults)).toEqual({ color: '#2F80ED', width: 8, opacity: 1 })
    expect(defaultsFor('arrow', sceneDefaults)).toEqual({ color: '#2F80ED', width: 8, opacity: 1 })
    expect(defaultsFor('rect', sceneDefaults)).toEqual({ color: '#2F80ED', width: 8, opacity: 1 })
    expect(defaultsFor('step', sceneDefaults)).toEqual({ color: '#2F80ED', width: 8, opacity: 1 })
    expect(defaultsFor('text', sceneDefaults)).toEqual({ color: '#2F80ED', width: 8, opacity: 1 })
    expect(defaultsFor('speech', sceneDefaults)).toEqual({ color: '#2F80ED', width: 8, opacity: 1 })
    expect(defaultsFor('leader', sceneDefaults)).toEqual({ color: '#2F80ED', width: 8, opacity: 1 })
  })

  it('lists exactly the documented colors', () => {
    expect(COLOR_PRESETS).toEqual([
      '#E5484D',
      '#FFD666',
      '#F5A623',
      '#2F80ED',
      '#27AE60',
      '#9B51E0',
      '#1A1A1A',
      '#FFFFFF',
    ])
  })

  it('lists exactly the documented width presets', () => {
    expect(WIDTH_PRESETS).toEqual([2, 4, 8, 14])
  })
})

describe('font sizes and text extent', () => {
  it('lists the documented font sizes and includes the default', () => {
    expect(FONT_SIZE_PRESETS).toEqual([12, 14, 18, 24, 32, 48])
    expect(FONT_SIZE_PRESETS).toContain(DEFAULT_FONT_SIZE)
  })

  it('stacks one line height per line and takes the width of the longest line', () => {
    const one = textExtent('first', 18)
    const two = textExtent('first\nsecond longer', 18)
    expect(one).toEqual({ w: 5 * GLYPH_WIDTH * 18, h: LINE_HEIGHT * 18 })
    expect(two.h).toBe(one.h + LINE_HEIGHT * 18)
    expect(two.w).toBe('second longer'.length * GLYPH_WIDTH * 18)
  })

  it('empty text has no width but still occupies one line', () => {
    expect(textExtent('', 18)).toEqual({ w: 0, h: LINE_HEIGHT * 18 })
  })

  it('a larger font size scales both axes', () => {
    expect(textExtent('abc', 36)).toEqual({ w: 3 * GLYPH_WIDTH * 36, h: LINE_HEIGHT * 36 })
  })
})

// The callout shelf is a fixed world span, not a label-sized one: the label can be anything,
// the shelf always measures LEADER_SHELF_LENGTH from the shelf end away from the dot.
describe('leader shelf span', () => {
  it('is the documented fixed span of 43 world px, text-independent', () => {
    expect(sceneExports.LEADER_SHELF_LENGTH).toBe(43)
  })

  // Dragging right puts the shelf from the shelf end rightward, at the shelf's own y.
  it('runs rightward from the shelf end on a right drag', () => {
    expect(sceneExports.leaderShelfSpan([0, 0], [50, 30])).toEqual({ x0: 50, x1: 93, y: 30 })
  })

  // Dragging left flips the span: it runs from the shelf end leftward, still at the shelf's y.
  it('runs leftward from the shelf end on a left drag', () => {
    expect(sceneExports.leaderShelfSpan([100, 0], [40, 30])).toEqual({ x0: -3, x1: 40, y: 30 })
  })

  // A vertical drag has no direction to flip on: dx === 0 keeps the right span.
  it('defaults to the right span when dx is zero', () => {
    expect(sceneExports.leaderShelfSpan([40, 0], [40, 30])).toEqual({ x0: 40, x1: 83, y: 30 })
  })
})

describe('per-tool default colors', () => {
  it('select defaults to yellow and every drawing tool defaults to red', () => {
    expect(TOOL_DEFAULT_COLORS).toEqual({
      select: '#FFD666',
      marker: '#E5484D',
      highlighter: '#E5484D',
      arrow: '#E5484D',
      rect: '#E5484D',
      text: '#E5484D',
      step: '#E5484D',
      speech: '#E5484D',
      leader: '#E5484D',
    })
  })

  it('defaultToolColor reads the per-tool defaults', () => {
    expect(defaultToolColor('select')).toBe(HIGHLIGHTER_COLOR)
    expect(defaultToolColor('marker')).toBe(DEFAULT_COLOR)
    expect(defaultToolColor('highlighter')).toBe(DEFAULT_COLOR)
    expect(defaultToolColor('arrow')).toBe(DEFAULT_COLOR)
    expect(defaultToolColor('rect')).toBe(DEFAULT_COLOR)
    expect(defaultToolColor('step')).toBe(DEFAULT_COLOR)
    expect(defaultToolColor('text')).toBe(DEFAULT_COLOR)
    expect(defaultToolColor('speech')).toBe(DEFAULT_COLOR)
    expect(defaultToolColor('leader')).toBe(DEFAULT_COLOR)
  })
})

describe('per-tool default widths', () => {
  // Arrow, rect and leader are thin-line tools: they start at 4 px, like the step badge's
  // ring. Only select, marker, text and speech join the 8 px group.
  it('every drawing tool defaults to 8 px except the highlighter at 14 px and arrow, rect, step and leader at 4 px', () => {
    expect(TOOL_DEFAULT_WIDTHS).toEqual({
      select: 8,
      marker: 8,
      highlighter: 14,
      arrow: 4,
      rect: 4,
      text: 8,
      step: 4,
      speech: 8,
      leader: 4,
    })
  })

  it('defaultToolWidth reads the per-tool defaults', () => {
    expect(defaultToolWidth('highlighter')).toBe(14)
    expect(defaultToolWidth('marker')).toBe(8)
    expect(defaultToolWidth('select')).toBe(8)
    expect(defaultToolWidth('arrow')).toBe(4)
    expect(defaultToolWidth('rect')).toBe(4)
    expect(defaultToolWidth('step')).toBe(4)
    expect(defaultToolWidth('text')).toBe(8)
    expect(defaultToolWidth('speech')).toBe(8)
    expect(defaultToolWidth('leader')).toBe(4)
  })

  it('the scene default width is the 8 px drawing tools start from', () => {
    expect(DEFAULT_WIDTH).toBe(8)
    expect(HIGHLIGHTER_WIDTH).toBe(14)
    expect(TOOL_DEFAULT_WIDTHS.highlighter).toBe(HIGHLIGHTER_WIDTH)
  })
})

describe('scene operations', () => {
  it('mints ids from the injected counter', () => {
    let n = 0
    const scene = addShape(createScene([], { nextId: () => `id-${n++}` }), rectDraft)
    expect(shapesOf(scene).map((shape) => shape.id)).toEqual(['id-0'])
  })

  it('keeps an explicit caller-provided id', () => {
    expect(shapeOf(addShape(createScene(), { ...rectDraft, id: 'fixed' }), 'fixed')?.id).toBe('fixed')
  })

  it('mints distinct ids with the default counter', () => {
    const scene = addShape(addShape(createScene(), rectDraft), rectDraft)
    expect(new Set(shapesOf(scene).map((shape) => shape.id)).size).toBe(2)
  })

  it('counter ids are sequential and unique', () => {
    const ids = counterIds(7)
    expect(new Set([ids.nextId(), ids.nextId(), ids.nextId()]).size).toBe(3)
  })

  it('adds without mutating the original scene', () => {
    const scene = createScene()
    expect(shapesOf(scene)).toEqual([])
    expect(shapesOf(addShape(scene, rectDraft))).toHaveLength(1)
  })

  it('freezes the shapes array', () => {
    expect(Object.isFrozen(shapesOf(addShape(createScene(), rectDraft)))).toBe(true)
  })

  it('removes a shape by id', () => {
    const scene = addShape(createScene(), { ...rectDraft, id: 'a' })
    expect(shapesOf(removeShape(scene, 'a'))).toEqual([])
    expect(shapesOf(scene)).toHaveLength(1)
  })

  it('replaces a shape in place, keeping the stacking order', () => {
    const scene = addShape(addShape(createScene(), { ...rectDraft, id: 'a' }), { ...rectDraft, id: 'b' })
    const moved = { ...rectDraft, id: 'a', transform: { ...rectDraft.transform, x: 99 } }
    const after = replaceShape(scene, 'a', moved)
    expect(shapesOf(after).map((shape) => shape.id)).toEqual(['a', 'b'])
    expect(shapeOf(after, 'a')?.transform.x).toBe(99)
    expect(shapesOf(scene)).toHaveLength(2)
  })

  it('replacing an unknown id leaves the shapes untouched', () => {
    const scene = addShape(createScene(), { ...rectDraft, id: 'a' })
    expect(shapesOf(replaceShape(scene, 'missing', { ...rectDraft, id: 'missing' }))).toEqual(shapesOf(scene))
  })

  it('removing an unknown id leaves the shapes untouched', () => {
    const scene = addShape(createScene(), { ...rectDraft, id: 'a' })
    expect(shapesOf(removeShape(scene, 'missing'))).toEqual(shapesOf(scene))
  })

  it('ids survive other scene operations', () => {
    const scene = addShape(addShape(createScene(), { ...rectDraft, id: 'a' }), {
      ...rectDraft,
      id: 'b',
    })
    const after = setDefaults(scene, { width: 8 })
    expect(shapesOf(removeShape(after, 'a')).map((shape) => shape.id)).toEqual(['b'])
  })

  it('shapeOf returns undefined for an unknown id', () => {
    expect(shapeOf(createScene(), 'missing')).toBeUndefined()
  })

  it('copies initial shapes instead of sharing the caller array', () => {
    const initial = [{ ...rectDraft, id: 'a' }]
    const scene = createScene(initial)
    expect(shapesOf(scene)).toEqual(initial)
    expect(shapesOf(scene)).not.toBe(initial)
  })

  // The step model stores nothing beyond the bbox: the digit is derived at render,
  // so removal renumbers the rest for free.
  it('adds a step shape carrying no extra payload', () => {
    const scene = addShape(createScene(), stepDraft)
    expect(shapeOf(scene, 'shape-1')).toEqual({ ...stepDraft, id: 'shape-1' })
    expect(shapesOf(removeShape(scene, 'shape-1'))).toEqual([])
  })

  // The balloon travels as one shape: its tip stays bbox-local, like an arrow endpoint.
  it('adds a speech shape carrying its tip, text and font size', () => {
    const scene = addShape(createScene(), speechDraft)
    expect(shapeOf(scene, 'shape-1')).toEqual({ ...speechDraft, id: 'shape-1' })
    expect(shapesOf(removeShape(scene, 'shape-1'))).toEqual([])
  })

  // The callout travels as one shape: its endpoints stay bbox-local, like arrow endpoints.
  it('adds a leader shape carrying its endpoints, text and font size', () => {
    const scene = addShape(createScene(), leaderDraft)
    expect(shapeOf(scene, 'shape-1')).toEqual({ ...leaderDraft, id: 'shape-1' })
    expect(shapesOf(removeShape(scene, 'shape-1'))).toEqual([])
  })

  it('setDefaults merges a partial patch without mutating the scene', () => {
    const scene = createScene()
    expect(setDefaults(scene, { color: '#2F80ED' }).defaults).toEqual({
      color: '#2F80ED',
      width: DEFAULT_WIDTH,
    })
    expect(scene.defaults).toEqual({ color: DEFAULT_COLOR, width: DEFAULT_WIDTH })
  })
})
