// Acceptance lane for applying color and width to the selection (spec item 4): a palette or
// width pick must repaint the selected shapes — single and multi — as ONE undoable commit,
// while still updating the tool defaults; with no selection only the defaults move.
// debugState exposes defaults and selection ids but no per-shape color/width, so shape-level
// evidence is sampled from canvas pixels, the way tools.spec.ts and select.spec.ts do.
import { expect, test, type Page } from '@playwright/test'
import { serve, type Lane } from './serve.ts'
import { DEFAULT_COLOR, DEFAULT_WIDTH, HIGHLIGHTER_COLOR } from '../../src/index.ts'
import type { EditorDebugState } from '../../src/editor.ts'

declare global {
  interface Window {
    __editorState?: () => EditorDebugState
  }
}

/** Fixture image: a flat solid PNG so ink can be counted against one known background. */
const FIXTURE = { width: 320, height: 200 }

/** Rect drawn with the rect tool; its default-width stroke straddles the bbox top edge. */
const RECT = { from: { x: 30, y: 30 }, to: { x: 120, y: 90 } }
/** Two horizontal marker strokes a single rubber band can sweep over in one drag. */
const STROKE_A = { from: { x: 40, y: 50 }, to: { x: 200, y: 50 } }
const STROKE_B = { from: { x: 40, y: 150 }, to: { x: 200, y: 150 } }

const PICKED_COLOR = '#2F80ED'
const PICKED_WIDTH = 14

/** Color match tolerance for pixel sampling: antialiased strokes blend toward the fixture. */
const COLOR_DISTANCE = 60

/** Wider tolerance for counting a stroke's rows: it keeps antialiased edge pixels of the shape's
 * colour while excluding a white halo band and the gray blend of its shadow. */
const SHAPE_INK_DISTANCE = 120

/** Minimum pixel count that proves a wide (default-8 px, view-scaled) stroke is in a color. */
const REPAINTED_PIXELS = 400

type Local = { x: number; y: number }
type World = { x: number; y: number }
type Stage = { box: { x: number; y: number; width: number; height: number } }
type Rgb = [number, number, number]

let server: Lane

test.beforeAll(async () => {
  server = await serve()
})

test.afterAll(async () => {
  await server.close()
})

async function editorState(page: Page): Promise<EditorDebugState> {
  const state = await page.evaluate(() => window.__editorState?.())
  if (!state) throw new Error('window.__editorState is not exposed')
  return state
}

/** Mounts the editor with the synthetic fixture and reports the canvas geometry. */
async function openEditor(page: Page): Promise<Stage> {
  await page.goto('about:blank')
  const src = await page.evaluate(([width, height]) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context in the probe page')
    ctx.fillStyle = '#F2F3F5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }, [FIXTURE.width, FIXTURE.height])
  await page.goto(`${server.url}/?src=${encodeURIComponent(src)}`)
  await expect.poll(() => editorState(page)).toMatchObject({ shapeCount: 0 })
  const box = await page.getByTestId('editor-canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return { box }
}

/** Canvas-local point of a world coordinate under the live view. */
async function toLocal(page: Page, world: World): Promise<Local> {
  const state = await editorState(page)
  return { x: state.offsetX + world.x * state.scale, y: state.offsetY + world.y * state.scale }
}

/** Pointer drag expressed in canvas-local coordinates. */
async function drag(page: Page, stage: Stage, from: Local, to: Local, steps = 8): Promise<void> {
  await page.mouse.move(stage.box.x + from.x, stage.box.y + from.y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      stage.box.x + from.x + ((to.x - from.x) * step) / steps,
      stage.box.y + from.y + ((to.y - from.y) * step) / steps,
    )
  }
  await page.mouse.up()
}

async function click(page: Page, stage: Stage, at: Local): Promise<void> {
  await page.mouse.move(stage.box.x + at.x, stage.box.y + at.y)
  await page.mouse.down()
  await page.mouse.up()
}

/** Ctrl+Z: the editor's undo keybinding, routed through the window keydown handler. */
async function undoOnce(page: Page): Promise<void> {
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
}

async function pickColor(page: Page, hex: string): Promise<void> {
  await page.getByTestId('editor-color-picker').click()
  await page.getByTestId(`editor-color-${hex}`).click()
}

async function pickWidth(page: Page, px: number): Promise<void> {
  await page.getByTestId('editor-width-picker').click()
  await page.getByTestId(`editor-width-${px}`).click()
}

/** Draws the fixture rect with the rect tool and leaves that tool active. */
async function drawFixtureRect(page: Page, stage: Stage): Promise<void> {
  await page.getByTestId('editor-tool-rect').click()
  await drag(page, stage, await toLocal(page, RECT.from), await toLocal(page, RECT.to))
}

/** Draws the two fixture strokes with the marker tool, then switches to select. */
async function openWithTwoStrokes(page: Page): Promise<Stage> {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-marker').click()
  await drag(page, stage, await toLocal(page, STROKE_A.from), await toLocal(page, STROKE_A.to))
  await drag(page, stage, await toLocal(page, STROKE_B.from), await toLocal(page, STROKE_B.to))
  await page.getByTestId('editor-tool-select').click()
  return stage
}

/** Rubber band from `from` to `to`; both endpoints must land on empty canvas. */
async function marquee(page: Page, stage: Stage, from: World, to: World): Promise<void> {
  await drag(page, stage, await toLocal(page, from), await toLocal(page, to))
}

/** Canvas-local color of a hex string, for sampling in page.evaluate. */
function hexToRgb(hex: string): Rgb {
  const value = hex.slice(1)
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)]
}

/** Pixels inside a canvas-local rect whose color is within `distance` of `expected`. */
async function colorPixels(page: Page, origin: Local, width: number, height: number, expected: Rgb, distance: number): Promise<number> {
  return page.evaluate(([x, y, w, h, exp, max]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]')
    if (!canvas) throw new Error('editor canvas missing')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('editor canvas has no 2d context')
    const dpr = canvas.width / canvas.clientWidth
    const data = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr))).data
    let hits = 0
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - exp[0]) + Math.abs(data[i + 1] - exp[1]) + Math.abs(data[i + 2] - exp[2]) <= max) hits += 1
    }
    return hits
  }, [origin.x, origin.y, width, height, expected, distance])
}

/** Canvas-local band straddling the fixture rect's stroked top edge, inset from the corners. */
async function rectTopBand(page: Page): Promise<{ origin: Local; width: number; height: number }> {
  const state = await editorState(page)
  return {
    origin: await toLocal(page, { x: RECT.from.x + 6, y: RECT.from.y - 6 }),
    width: (RECT.to.x - RECT.from.x - 12) * state.scale,
    height: 12 * state.scale,
  }
}

/** Rows a horizontal stroke crosses when sampled vertically at `worldX`: pixels that read the
 * shape's own colour. A white halo band (and its gray shadow) around the stroke is not ink, so it
 * must not widen the measured thickness. */
async function strokeRows(page: Page, worldX: number, centerWorldY: number): Promise<number> {
  const state = await editorState(page)
  const origin = await toLocal(page, { x: worldX, y: centerWorldY - 12 })
  return colorPixels(page, origin, 1, 24 * state.scale, hexToRgb(DEFAULT_COLOR), SHAPE_INK_DISTANCE)
}

// Item 4 for a lone selection: the pick must repaint the selected shape, not just the defaults,
// and the repaint must land in exactly one history step so a single Ctrl+Z restores the shape.
test('picking a color while a shape is selected repaints the shape and one Ctrl+Z undoes it', async ({ page }) => {
  const stage = await openEditor(page)
  await drawFixtureRect(page, stage)
  await page.getByTestId('editor-tool-select').click()
  await click(page, stage, await toLocal(page, { x: 75, y: 60 }))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  const drawn = await rectTopBand(page)
  expect(await colorPixels(page, drawn.origin, drawn.width, drawn.height, hexToRgb(DEFAULT_COLOR), COLOR_DISTANCE)).toBeGreaterThanOrEqual(REPAINTED_PIXELS)

  await pickColor(page, PICKED_COLOR)

  const recolored = await editorState(page)
  // Today's behavior stays: the defaults follow the pick.
  expect(recolored.color).toBe(PICKED_COLOR)
  expect(recolored.selectedIds).toHaveLength(1)
  expect(recolored.shapeCount).toBe(1)
  // The demanded behavior: the selected shape itself is repainted.
  const band = await rectTopBand(page)
  expect(await colorPixels(page, band.origin, band.width, band.height, hexToRgb(PICKED_COLOR), COLOR_DISTANCE)).toBeGreaterThanOrEqual(REPAINTED_PIXELS)
  expect(await colorPixels(page, band.origin, band.width, band.height, hexToRgb(DEFAULT_COLOR), COLOR_DISTANCE)).toBe(0)

  await undoOnce(page)

  const restored = await editorState(page)
  expect(restored.shapeCount).toBe(1)
  expect(restored.selectedIds).toHaveLength(0)
  // Undo reapplies the tool defaults (select starts on its highlight color), and the shape
  // is back to the color it was drawn with.
  expect(restored.color).toBe(HIGHLIGHTER_COLOR)
  const back = await rectTopBand(page)
  expect(await colorPixels(page, back.origin, back.width, back.height, hexToRgb(DEFAULT_COLOR), COLOR_DISTANCE)).toBeGreaterThanOrEqual(REPAINTED_PIXELS)
  expect(await colorPixels(page, back.origin, back.width, back.height, hexToRgb(PICKED_COLOR), COLOR_DISTANCE)).toBe(0)
})

// Item 4 for a multi-selection: one pick must repaint every selected shape and a single
// Ctrl+Z must restore all of them — one commit, not one per shape.
test('picking a width with a multi-selection repaints every selected shape and one Ctrl+Z undoes it', async ({ page }) => {
  const stage = await openWithTwoStrokes(page)
  await marquee(page, stage, { x: 10, y: 20 }, { x: 230, y: 180 })
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(2)
  const thinLimit = DEFAULT_WIDTH * picked.scale + 6
  expect(await strokeRows(page, 120, STROKE_A.from.y)).toBeLessThanOrEqual(thinLimit)

  await pickWidth(page, PICKED_WIDTH)

  const repainted = await editorState(page)
  // Today's behavior stays: the defaults follow the pick.
  expect(repainted.width).toBe(PICKED_WIDTH)
  expect(repainted.selectedIds).toHaveLength(2)
  expect(repainted.shapeCount).toBe(2)
  // The demanded behavior: every selected stroke is drawn at the picked width.
  const thickFloor = PICKED_WIDTH * repainted.scale * 0.8
  expect(await strokeRows(page, 120, STROKE_A.from.y)).toBeGreaterThanOrEqual(thickFloor)
  expect(await strokeRows(page, 120, STROKE_B.from.y)).toBeGreaterThanOrEqual(thickFloor)

  await undoOnce(page)

  const restored = await editorState(page)
  expect(restored.shapeCount).toBe(2)
  expect(restored.selectedIds).toHaveLength(0)
  expect(restored.width).toBe(DEFAULT_WIDTH)
  expect(await strokeRows(page, 120, STROKE_A.from.y)).toBeLessThanOrEqual(thinLimit)
  expect(await strokeRows(page, 120, STROKE_B.from.y)).toBeLessThanOrEqual(thinLimit)
})

// Regression guard for today's behavior: with nothing selected a pick moves only the tool
// defaults — shapes drawn earlier keep their own color and thickness.
test('picking a color or width with no selection changes only the tool defaults', async ({ page }) => {
  const stage = await openEditor(page)
  await drawFixtureRect(page, stage)
  const before = await editorState(page)
  const thinLimit = DEFAULT_WIDTH * before.scale + 6
  expect(before.selectedIds).toHaveLength(0)

  await pickColor(page, PICKED_COLOR)
  const recolored = await editorState(page)
  expect(recolored.color).toBe(PICKED_COLOR)

  const band = await rectTopBand(page)
  expect(await colorPixels(page, band.origin, band.width, band.height, hexToRgb(DEFAULT_COLOR), COLOR_DISTANCE)).toBeGreaterThanOrEqual(REPAINTED_PIXELS)
  expect(await colorPixels(page, band.origin, band.width, band.height, hexToRgb(PICKED_COLOR), COLOR_DISTANCE)).toBe(0)
  expect(await strokeRows(page, 75, RECT.from.y)).toBeLessThanOrEqual(thinLimit)

  await pickWidth(page, PICKED_WIDTH)
  const widened = await editorState(page)
  expect(widened.width).toBe(PICKED_WIDTH)

  const after = await rectTopBand(page)
  expect(await colorPixels(page, after.origin, after.width, after.height, hexToRgb(DEFAULT_COLOR), COLOR_DISTANCE)).toBeGreaterThanOrEqual(REPAINTED_PIXELS)
  expect(await colorPixels(page, after.origin, after.width, after.height, hexToRgb(PICKED_COLOR), COLOR_DISTANCE)).toBe(0)
  expect(await strokeRows(page, 75, RECT.from.y)).toBeLessThanOrEqual(thinLimit)
})
