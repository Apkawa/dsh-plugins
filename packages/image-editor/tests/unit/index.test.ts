import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_WIDTH,
  EDITOR_TOOLS,
  FONT_SIZE_PRESETS,
  GLYPH_WIDTH,
  HIGHLIGHTER_WIDTH,
  LINE_HEIGHT,
  MAX_SCALE,
  MIN_SCALE,
  ROTATE_HANDLE_GAP,
  MIN_SHAPE_SIZE,
  TOOL_DEFAULT_COLORS,
  TOOL_DEFAULT_WIDTHS,
  WIDTH_PRESETS,
  attachInput,
  clampView,
  clampToWorld,
  createHistory,
  createView,
  defaultToolColor,
  drawScene,
  fitView,
  handlePoints,
  hitHandle,
  hitShape,
  localToWorld,
  mountImageEditor,
  moveShape,
  pan,
  renderPng,
  replaceShape,
  resizeCanvas,
  resizeShape,
  rotateShape,
  screenToWorld,
  shapesWithin,
  textExtent,
  topShapeAt,
  withFontSize,
  worldToLocal,
  worldToScreen,
  zoomAt,
} from '../../src/index.ts'

// The shelf geometry arrives with the implementation pass. Reading the barrel namespace with a
// dynamic import — instead of importing the names — keeps a missing export failing only the
// leader export test below instead of breaking this whole file at load.
const indexExports = await import('../../src/index.ts')

describe('editor placeholder API', () => {
  it('exports the annotation tool set with select first and leader last', () => {
    expect(EDITOR_TOOLS).toEqual(['select', 'marker', 'highlighter', 'arrow', 'rect', 'text', 'step', 'speech', 'leader'])
  })

  it('exports the per-tool default colors and the lookup helper', () => {
    expect(Object.keys(TOOL_DEFAULT_COLORS)).toEqual(EDITOR_TOOLS)
    expect(defaultToolColor).toBeTypeOf('function')
  })
})

describe('default thickness API', () => {
  // Only select, marker, text and speech start at 8 px. The highlighter keeps its own 14 px
  // preset, and the three thin tools — arrow, rect and leader — start at 4 px with the step.
  it('exports the 8 px default width, the highlighter width and the unchanged presets', () => {
    expect(DEFAULT_WIDTH).toBe(8)
    expect(HIGHLIGHTER_WIDTH).toBe(14)
    expect(WIDTH_PRESETS).toEqual([2, 4, 8, 14])
    expect(WIDTH_PRESETS).toContain(DEFAULT_WIDTH)
    expect(Object.keys(TOOL_DEFAULT_WIDTHS)).toEqual(EDITOR_TOOLS)
    // Four tools start at 8 px; arrow, rect, step and leader sit at 4 px, highlighter at 14.
    expect(Object.values(TOOL_DEFAULT_WIDTHS).filter((width) => width === 8)).toHaveLength(4)
  })
})

describe('transform, hit and undo API', () => {
  it('exports every transform, hit and undo function', () => {
    Object.entries({
      handlePoints,
      hitHandle,
      hitShape,
      localToWorld,
      moveShape,
      resizeShape,
      rotateShape,
      shapesWithin,
      topShapeAt,
      worldToLocal,
      createHistory,
    }).forEach(([name, fn]) => expect(fn).toBeTypeOf('function'))
  })

  it('exports the resize clamp and the rotate handle gap', () => {
    expect(MIN_SHAPE_SIZE).toBe(4)
    expect(ROTATE_HANDLE_GAP).toBeGreaterThan(0)
  })
})

describe('text API', () => {
  it('exports the font size presets, the glyph metrics and the text helpers', () => {
    expect(FONT_SIZE_PRESETS).toEqual([12, 14, 18, 24, 32, 48])
    expect(DEFAULT_FONT_SIZE).toBeGreaterThan(0)
    expect(GLYPH_WIDTH).toBeGreaterThan(0)
    expect(LINE_HEIGHT).toBeGreaterThan(1)
    expect(textExtent('a\nb', 18)).toEqual({ w: GLYPH_WIDTH * 18, h: 2 * LINE_HEIGHT * 18 })
    expect(withFontSize).toBeTypeOf('function')
  })

  // The callout shelf is public geometry the renderer and the hit test agree on, so the
  // barrel re-exports the fixed span and the shared span helper like the other scene constants.
  // The label gap past the far tip is public geometry too: the hit band must reach the label
  // ink that starts LEADER_LABEL_GAP px beyond the tip, so the constant lives in the barrel.
  it('exports the leader shelf length, the label gap and the shelf span helper', () => {
    expect(indexExports.LEADER_SHELF_LENGTH).toBe(43)
    expect(indexExports.LEADER_LABEL_GAP).toBe(12)
    expect(indexExports.leaderShelfSpan).toBeTypeOf('function')
  })
})

describe('view, render, export, input and mount API', () => {
  it('exports every view, render, export, input and mount function', () => {
    Object.entries({
      createView,
      clampView,
      clampToWorld,
      zoomAt,
      pan,
      screenToWorld,
      worldToScreen,
      fitView,
      drawScene,
      resizeCanvas,
      renderPng,
      attachInput,
      mountImageEditor,
      replaceShape,
    }).forEach(([name, fn]) => expect(fn).toBeTypeOf('function'))
  })

  it('exports the zoom clamp bounds', () => {
    expect(MIN_SCALE).toBe(0.1)
    expect(MAX_SCALE).toBe(8)
  })
})
