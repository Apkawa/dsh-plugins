// Acceptance lane for the select tool: pointer picking, rubber-band multi-select, group
// move, group delete, and single-shape handles, driven through the dev page over http.
import { expect, test, type Page } from '@playwright/test'
import { serve, type Lane } from './serve.ts'
import { HIGHLIGHTER_COLOR, ROTATE_HANDLE_GAP, localToWorld } from '../../src/index.ts'
import { OVERLAY_COLOR } from '../../src/render.ts'
import type { EditorDebugState } from '../../src/editor.ts'

declare global {
  interface Window {
    __editorState?: () => EditorDebugState
  }
}

/** Fixture image: a flat solid PNG so ink can be counted against one known background. */
const FIXTURE = { width: 320, height: 200 }
const BACKGROUND: Rgb = [242, 243, 245]

type Local = { x: number; y: number }
type World = { x: number; y: number }
type Stage = { box: { x: number; y: number; width: number; height: number } }
type Rgb = [number, number, number]

/** Two disjoint rects whose bboxes a single rubber band can sweep over in one drag. */
const RECT_A = { from: { x: 20, y: 20 }, to: { x: 120, y: 70 } }
const RECT_B = { from: { x: 180, y: 120 }, to: { x: 280, y: 170 } }

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

/** Runs a mouse action with Control held: Playwright folds held modifiers into pointer events. */
async function withCtrl(page: Page, action: () => Promise<void>): Promise<void> {
  await page.keyboard.down('Control')
  await action()
  await page.keyboard.up('Control')
}

/** Rubber band from `from` to `to`; both endpoints must land on empty canvas. */
async function marquee(page: Page, stage: Stage, from: World, to: World): Promise<void> {
  await drag(page, stage, await toLocal(page, from), await toLocal(page, to))
}

async function drawRect(page: Page, stage: Stage, from: World, to: World): Promise<void> {
  await drag(page, stage, await toLocal(page, from), await toLocal(page, to))
}

/** Draws the two fixture rects and switches to the select tool. */
async function openWithTwoRects(page: Page): Promise<Stage> {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await drawRect(page, stage, RECT_B.from, RECT_B.to)
  await page.getByTestId('editor-tool-select').click()
  return stage
}

/** Canvas-local color of a hex string, for sampling in page.evaluate. */
function hexToRgb(hex: string): Rgb {
  const value = hex.slice(1)
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)]
}

/**
 * Pixels inside a `band`-wide strip around the canvas-local segment `from`→`to` whose color is
 * within `distance` of `expected`. A hairline dashed stroke lands on subpixel positions, so the
 * assertion counts matches in the band rather than demanding one exact pixel.
 */
async function edgePixels(page: Page, from: Local, to: Local, band: number, expected: Rgb, distance: number): Promise<number> {
  return page.evaluate(([x0, y0, x1, y1, b, exp, max]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]')
    if (!canvas) throw new Error('editor canvas missing')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('editor canvas has no 2d context')
    const dpr = canvas.width / canvas.clientWidth
    const data = ctx.getImageData(
      Math.round((x0 - b) * dpr),
      Math.round((y0 - b) * dpr),
      Math.max(1, Math.round((x1 - x0 + 2 * b) * dpr)),
      Math.max(1, Math.round((y1 - y0 + 2 * b) * dpr)),
    ).data
    let hits = 0
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - exp[0]) + Math.abs(data[i + 1] - exp[1]) + Math.abs(data[i + 2] - exp[2]) <= max) hits += 1
    }
    return hits
  }, [from.x, from.y, to.x, to.y, band, expected, distance])
}

/**
 * The dashed bbox of a selected axis-aligned rect as canvas-local top-edge runs. The runs stop
 * short of the corner marks and split around the `n` mark on the edge midpoint: Stage 8 rings
 * every mark in white, and the antialiased edge of a ring reads as mid-grey close to
 * OVERLAY_COLOR — the assertion below is about the outline's color, not about handle pixels.
 */
async function bboxTopEdgeRuns(page: Page, transform: { x: number; y: number; w: number }): Promise<Array<{ from: Local; to: Local }>> {
  const mid = transform.x + transform.w / 2
  return [
    { from: await toLocal(page, { x: transform.x + 8, y: transform.y }), to: await toLocal(page, { x: mid - 10, y: transform.y }) },
    { from: await toLocal(page, { x: mid + 10, y: transform.y }), to: await toLocal(page, { x: transform.x + transform.w - 8, y: transform.y }) },
  ]
}
/** Number of pixels inside a canvas-local rect that differ from `background`. */
async function inkPixels(page: Page, origin: Local, width: number, height: number, background: Rgb): Promise<number> {
  return page.evaluate(([x, y, w, h, bg]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]')
    if (!canvas) throw new Error('editor canvas missing')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('editor canvas has no 2d context')
    const dpr = canvas.width / canvas.clientWidth
    const data = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.round(w * dpr), Math.round(h * dpr)).data
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 4) count += 1
    }
    return count
  }, [origin.x, origin.y, width, height, background])
}

test('select is the first toolbar button and its drag selects instead of drawing', async ({ page }) => {
  const stage = await openEditor(page)
  const toolButtons = page.locator('.ie-toolbar .ie-btn[data-testid^="editor-tool-"]')
  await expect(toolButtons.first()).toHaveAttribute('data-testid', 'editor-tool-select')

  const select = page.getByTestId('editor-tool-select')
  await expect(select).toBeVisible()
  expect(await select.getAttribute('aria-label')).toBe('Select')
  expect((await select.innerHTML()).includes('<svg')).toBe(true)

  // Select is a pointer tool, not a drawing default: the default stroke lane stays marker.
  expect((await editorState(page)).tool).toBe('marker')

  await select.click()
  expect(await select.getAttribute('data-active')).toBe('true')
  await marquee(page, stage, { x: 40, y: 30 }, { x: 260, y: 160 })
  expect((await editorState(page)).shapeCount).toBe(0)

  await page.getByTestId('editor-tool-marker').click()
  await drawRect(page, stage, { x: 40, y: 40 }, { x: 120, y: 90 })
  expect((await editorState(page)).shapeCount).toBe(1)
})

test('a rubber band is drawn live and selects every shape it crosses', async ({ page }) => {
  const stage = await openWithTwoRects(page)
  expect((await editorState(page)).selectedIds).toEqual([])

  const from = await toLocal(page, { x: 8, y: 8 })
  const to = await toLocal(page, { x: 300, y: 185 })
  await page.mouse.move(stage.box.x + from.x, stage.box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(stage.box.x + to.x, stage.box.y + to.y, { steps: 8 })

  // The band is on screen before pointerup: its top edge is stroked over bare picture.
  expect(await inkPixels(page, { x: from.x, y: from.y - 2 }, 40, 5, BACKGROUND)).toBeGreaterThan(0)

  await page.mouse.up()

  const state = await editorState(page)
  expect(state.selectedIds).toHaveLength(2)
  expect(state.selectedId).toBe(state.selectedIds[0])
  // Selecting alone changes no transform.
  expect(state.transforms.map((transform) => [transform.x, transform.y])).toEqual([[20, 20], [180, 120]])

  // The band itself is gone once the gesture ends.
  expect(await inkPixels(page, { x: from.x, y: from.y - 2 }, 40, 5, BACKGROUND)).toBe(0)

  await page.screenshot({ path: test.info().outputPath('select-marquee-two.png') })
})

test('dragging one selected shape moves every selected shape together', async ({ page }) => {
  const stage = await openWithTwoRects(page)
  await marquee(page, stage, { x: 8, y: 8 }, { x: 300, y: 185 })
  const before = await editorState(page)
  expect(before.selectedIds).toHaveLength(2)

  // The endpoints are world points 40 apart, so the drag carries the shapes 40 world units.
  await drag(page, stage, await toLocal(page, { x: 70, y: 45 }), await toLocal(page, { x: 110, y: 45 }))

  const after = await editorState(page)
  expect(after.selectedIds).toEqual(before.selectedIds)
  const firstDelta = after.transforms[0].x - before.transforms[0].x
  const secondDelta = after.transforms[1].x - before.transforms[1].x
  // One gesture, one delta: both shapes shift by the same world distance.
  expect(secondDelta).toBeCloseTo(firstDelta, 6)
  expect(firstDelta).toBeGreaterThan(10)
  expect(Math.abs(firstDelta - 40)).toBeLessThan(1)
  expect(after.transforms[0].y - before.transforms[0].y).toBeCloseTo(after.transforms[1].y - before.transforms[1].y, 6)
  expect(Math.abs(after.transforms[0].y - before.transforms[0].y)).toBeLessThan(1)
  // Moving never stretches: sizes and the order stay as they were.
  expect(after.transforms.map((transform) => [transform.w, transform.h])).toEqual(before.transforms.map((transform) => [transform.w, transform.h]))
  expect(after.transforms.map((transform) => transform.rotation)).toEqual(before.transforms.map((transform) => transform.rotation))

  await page.screenshot({ path: test.info().outputPath('select-group-move.png') })
})

test('Delete removes every selected shape and Escape clears the selection', async ({ page }) => {
  const stage = await openWithTwoRects(page)
  await marquee(page, stage, { x: 8, y: 8 }, { x: 300, y: 185 })
  expect((await editorState(page)).selectedIds).toHaveLength(2)

  await page.keyboard.press('Delete')
  const afterDelete = await editorState(page)
  expect(afterDelete.shapeCount).toBe(0)
  expect(afterDelete.selectedIds).toEqual([])
  expect(afterDelete.selectedId).toBeNull()

  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await drawRect(page, stage, RECT_B.from, RECT_B.to)
  await page.getByTestId('editor-tool-select').click()
  await click(page, stage, await toLocal(page, { x: 70, y: 45 }))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)

  await page.keyboard.press('Escape')
  const afterEscape = await editorState(page)
  expect(afterEscape.selectedIds).toEqual([])
  expect(afterEscape.selectedId).toBeNull()
  expect(afterEscape.shapeCount).toBe(2)
})

test('a plain click selects one shape without moving it and its handle resizes it', async ({ page }) => {
  const stage = await openWithTwoRects(page)
  await click(page, stage, await toLocal(page, { x: 70, y: 45 }))

  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  expect(picked.selectedId).toBe(picked.selectedIds[0])
  expect(picked.transforms.map((transform) => [transform.x, transform.y])).toEqual([[20, 20], [180, 120]])

  // The southeast corner handle of the single selection stretches that shape only.
  const corner = await toLocal(page, { x: 120, y: 70 })
  await drag(page, stage, corner, { x: corner.x + 30, y: corner.y + 20 })

  const resized = await editorState(page)
  expect(resized.selectedIds).toEqual(picked.selectedIds)
  expect(resized.transforms[0].x).toBe(20)
  expect(resized.transforms[0].y).toBe(20)
  expect(Math.abs(resized.transforms[0].w - (100 + 30 / resized.scale))).toBeLessThan(1)
  expect(Math.abs(resized.transforms[0].h - (50 + 20 / resized.scale))).toBeLessThan(1)
  expect(resized.transforms[1]).toEqual(picked.transforms[1])

  await page.screenshot({ path: test.info().outputPath('select-single-resize.png') })
})

test('a rubber band that hits nothing clears the selection', async ({ page }) => {
  const stage = await openWithTwoRects(page)
  await click(page, stage, await toLocal(page, { x: 70, y: 45 }))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)

  // An empty patch inside the picture: neither bbox is crossed, so the release deselects.
  await marquee(page, stage, { x: 140, y: 95 }, { x: 170, y: 112 })

  const after = await editorState(page)
  expect(after.selectedIds).toEqual([])
  expect(after.selectedId).toBeNull()
  expect(after.transforms).toEqual(picked.transforms)
  expect(after.shapeCount).toBe(2)

  await page.screenshot({ path: test.info().outputPath('select-empty-marquee.png') })
})

test('a drawing gesture on empty canvas clears the selection and draws its shape', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await drawRect(page, stage, RECT_B.from, RECT_B.to)
  // While a drawing tool is active, picking an existing shape requires Ctrl.
  const inA = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, inA))
  expect((await editorState(page)).selectedIds).toHaveLength(1)

  // The next press misses every shape inside the picture: it starts the gesture and deselects.
  await drawRect(page, stage, { x: 140, y: 95 }, { x: 170, y: 112 })

  const after = await editorState(page)
  expect(after.shapeCount).toBe(3)
  expect(after.selectedIds).toEqual([])
  expect(after.selectedId).toBeNull()
})

test('switching the active tool clears the selection', async ({ page }) => {
  const stage = await openWithTwoRects(page)
  await click(page, stage, await toLocal(page, { x: 70, y: 45 }))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)

  await page.getByTestId('editor-tool-marker').click()

  const after = await editorState(page)
  expect(after.tool).toBe('marker')
  expect(after.selectedIds).toEqual([])
  expect(after.selectedId).toBeNull()
  expect(after.shapeCount).toBe(2)
  expect(after.transforms).toEqual(picked.transforms)
})

test('a press outside the picture leaves the selection intact', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  // Picking under a drawing tool needs Ctrl held; the presses below stay plain.
  const inA = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, inA))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)

  // The letterbox strip beside the fitted picture: at the canvas right edge the world x
  // is beyond the image width, so the press draws nothing and must not deselect either.
  const edge = { x: stage.box.width - 12, y: stage.box.height / 2 }
  const state = await editorState(page)
  expect((edge.x - state.offsetX) / state.scale).toBeGreaterThan(FIXTURE.width)
  await click(page, stage, edge)

  const after = await editorState(page)
  expect(after.shapeCount).toBe(1)
  expect(after.selectedIds).toEqual(picked.selectedIds)
  expect(after.selectedId).toBe(picked.selectedId)
  expect(after.transforms).toEqual(picked.transforms)
})

// With a drawing tool active, picking an element needs Ctrl held: a plain press paints over
// what is already drawn, a Ctrl press picks and toggles instead of drawing.
test('a marker drag that crosses an existing shape draws over it and leaves it untouched', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  const drawn = await editorState(page)
  expect(drawn.shapeCount).toBe(1)

  await page.getByTestId('editor-tool-marker').click()
  // The drag starts inside RECT_A's box: with marker active it must draw, never pick or move it.
  await drag(page, stage, await toLocal(page, { x: 35, y: 35 }), await toLocal(page, { x: 200, y: 110 }))

  const after = await editorState(page)
  expect(after.shapeCount).toBe(2)
  expect(after.transforms[0]).toEqual(drawn.transforms[0])
  expect(after.selectedIds).toEqual([])
  const stroke = after.transforms[1]
  if (!stroke) throw new Error('no marker stroke recorded')
  expect(Math.abs(stroke.x - 35)).toBeLessThan(2)
  expect(Math.abs(stroke.w - 165)).toBeLessThan(2)
  // Ink really lands on bare picture along the pointer path, past RECT_A's right edge.
  expect(await inkPixels(page, await toLocal(page, { x: 150, y: 85 }), 30, 20, BACKGROUND)).toBeGreaterThan(0)

  await page.screenshot({ path: test.info().outputPath('draw-over-shape.png') })
})

test('Ctrl+click picks a shape while a drawing tool is active and Ctrl+click again drops it', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  const drawn = await editorState(page)
  await page.getByTestId('editor-tool-marker').click()

  const at = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, at))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  // A Ctrl press picks instead of drawing, so the shape count stays put.
  expect(picked.shapeCount).toBe(1)
  expect(picked.transforms).toEqual(drawn.transforms)

  await withCtrl(page, () => click(page, stage, at))
  const dropped = await editorState(page)
  expect(dropped.selectedIds).toEqual([])
  expect(dropped.selectedId).toBeNull()
  expect(dropped.shapeCount).toBe(1)
  expect(dropped.transforms).toEqual(drawn.transforms)
})

test('Ctrl+drag moves the picked shape instead of drawing a new one', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await page.getByTestId('editor-tool-marker').click()

  const at = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, at))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)

  const to = await toLocal(page, { x: 110, y: 45 })
  await withCtrl(page, () => drag(page, stage, at, to))

  const moved = await editorState(page)
  expect(moved.shapeCount).toBe(1)
  expect(moved.selectedIds).toEqual(picked.selectedIds)
  expect(Math.abs(moved.transforms[0].x - (picked.transforms[0].x + 40))).toBeLessThan(1)
  expect(Math.abs(moved.transforms[0].y - picked.transforms[0].y)).toBeLessThan(1)
  expect(moved.transforms.map((transform) => [transform.w, transform.h])).toEqual(picked.transforms.map((transform) => [transform.w, transform.h]))
})

test('Ctrl+clicks gather shapes while drawing and one Ctrl+drag moves the whole set', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await drawRect(page, stage, RECT_B.from, RECT_B.to)
  await page.getByTestId('editor-tool-marker').click()

  const inA = await toLocal(page, { x: 70, y: 45 })
  const inB = await toLocal(page, { x: 230, y: 145 })
  const to = await toLocal(page, { x: 110, y: 45 })
  await withCtrl(page, () => click(page, stage, inA))
  await withCtrl(page, () => click(page, stage, inB))
  const gathered = await editorState(page)
  expect(gathered.selectedIds).toHaveLength(2)
  expect(gathered.shapeCount).toBe(2)

  await withCtrl(page, () => drag(page, stage, inA, to))

  const moved = await editorState(page)
  expect(moved.shapeCount).toBe(2)
  expect(moved.selectedIds).toEqual(gathered.selectedIds)
  expect(Math.abs(moved.transforms[0].x - gathered.transforms[0].x - 40)).toBeLessThan(1)
  expect(Math.abs(moved.transforms[1].x - gathered.transforms[1].x - 40)).toBeLessThan(1)
})

// A live selection is operated on under any tool: the handles of the lone selected shape are
// grabbable with or without Ctrl, so a shape picked by Ctrl stays editable while drawing.
test('a press on a lone selection handle stretches it under any tool, with or without Ctrl', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  // A drawing tool is active from here on, which is the case the rule has to cover.
  await page.getByTestId('editor-tool-marker').click()
  const pickedAt = await toLocal(page, { x: 70, y: 45 })
  const corner = await toLocal(page, { x: 120, y: 70 })

  await withCtrl(page, () => click(page, stage, pickedAt))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  expect(picked.tool).toBe('marker')

  // Plain drag from the lone selection's southeast handle: the shape stretches, no stroke is drawn.
  await drag(page, stage, corner, { x: corner.x + 30, y: corner.y + 20 })
  const plain = await editorState(page)
  expect(plain.shapeCount).toBe(1)
  expect(plain.selectedIds).toEqual(picked.selectedIds)
  expect(plain.transforms[0]?.x).toBe(20)
  expect(plain.transforms[0]?.y).toBe(20)
  expect(Math.abs((plain.transforms[0]?.w ?? 0) - (picked.transforms[0]?.w ?? 0) - 30 / plain.scale)).toBeLessThan(1)
  expect(Math.abs((plain.transforms[0]?.h ?? 0) - (picked.transforms[0]?.h ?? 0) - 20 / plain.scale)).toBeLessThan(1)

  // The same handle with Ctrl held stretches the same way; the corner moved with the bbox.
  const grown = await toLocal(page, {
    x: (plain.transforms[0]?.x ?? 0) + (plain.transforms[0]?.w ?? 0),
    y: (plain.transforms[0]?.y ?? 0) + (plain.transforms[0]?.h ?? 0),
  })
  await withCtrl(page, () => drag(page, stage, grown, { x: grown.x + 30, y: grown.y + 20 }))

  const held = await editorState(page)
  expect(held.shapeCount).toBe(1)
  expect(held.selectedIds).toEqual(picked.selectedIds)
  expect(Math.abs((held.transforms[0]?.w ?? 0) - (plain.transforms[0]?.w ?? 0) - 30 / held.scale)).toBeLessThan(1)
  expect(Math.abs((held.transforms[0]?.h ?? 0) - (plain.transforms[0]?.h ?? 0) - 20 / held.scale)).toBeLessThan(1)

  await page.screenshot({ path: test.info().outputPath('ctrl-handle-resize.png') })
})

// Ctrl picks a shape while a drawing tool is active, and the picked shape keeps working with no
// modifier held: a plain press on its handle, its body, or its rotate handle edits it.
test('a Ctrl-picked shape is stretched by its handle with the marker tool active', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await page.getByTestId('editor-tool-marker').click()

  const at = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, at))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  expect(picked.tool).toBe('marker')

  const corner = await toLocal(page, { x: 120, y: 70 })
  await drag(page, stage, corner, { x: corner.x + 30, y: corner.y + 20 })

  const resized = await editorState(page)
  // Stretching edits the selection instead of drawing, so the count and the selection stand.
  expect(resized.shapeCount).toBe(1)
  expect(resized.selectedIds).toEqual(picked.selectedIds)
  expect(resized.transforms[0]?.x).toBe(20)
  expect(resized.transforms[0]?.y).toBe(20)
  expect(Math.abs((resized.transforms[0]?.w ?? 0) - (picked.transforms[0]?.w ?? 0) - 30 / resized.scale)).toBeLessThan(1)
  expect(Math.abs((resized.transforms[0]?.h ?? 0) - (picked.transforms[0]?.h ?? 0) - 20 / resized.scale)).toBeLessThan(1)

  await page.screenshot({ path: test.info().outputPath('marker-handle-resize.png') })
})

test('a Ctrl-picked shape is moved by its body with the marker tool active', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await page.getByTestId('editor-tool-marker').click()

  const at = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, at))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)

  await drag(page, stage, at, await toLocal(page, { x: 110, y: 45 }))

  const moved = await editorState(page)
  // A plain press on the selected body drags it: no new shape, the selection survives.
  expect(moved.shapeCount).toBe(1)
  expect(moved.selectedIds).toEqual(picked.selectedIds)
  expect(Math.abs((moved.transforms[0]?.x ?? 0) - (picked.transforms[0]?.x ?? 0) - 40)).toBeLessThan(1)
  expect(Math.abs((moved.transforms[0]?.y ?? 0) - (picked.transforms[0]?.y ?? 0))).toBeLessThan(1)
  expect(moved.transforms.map((transform) => [transform.w, transform.h])).toEqual(picked.transforms.map((transform) => [transform.w, transform.h]))

  await page.screenshot({ path: test.info().outputPath('marker-body-move.png') })
})

test('a Ctrl-picked shape is rotated by its rotate handle with the marker tool active', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_B.from, RECT_B.to)
  await page.getByTestId('editor-tool-marker').click()

  const at = await toLocal(page, { x: 230, y: 145 })
  await withCtrl(page, () => click(page, stage, at))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  expect(picked.transforms[0]?.rotation).toBe(0)

  const handle = await toLocal(page, { x: 230, y: RECT_B.from.y - ROTATE_HANDLE_GAP })
  await drag(page, stage, handle, { x: handle.x + 120, y: handle.y }, 6)

  const rotated = await editorState(page)
  expect(rotated.shapeCount).toBe(1)
  expect(rotated.selectedIds).toEqual(picked.selectedIds)
  expect(rotated.transforms[0]?.rotation ?? 0).toBeGreaterThan(0.4)
  // Rotation turns the bbox in place: neither size moves.
  expect(rotated.transforms.map((transform) => [transform.w, transform.h])).toEqual(picked.transforms.map((transform) => [transform.w, transform.h]))

  await page.screenshot({ path: test.info().outputPath('marker-rotate.png') })
})

// Item 5 stays as shipped: picking a shape that is NOT in the selection still needs the select
// tool or Ctrl/Cmd, so a plain press with a drawing tool paints over that shape and deselects.
test('a plain press on an unselected shape with the marker tool active draws over it and clears the selection', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await drawRect(page, stage, RECT_B.from, RECT_B.to)
  await page.getByTestId('editor-tool-marker').click()

  const inA = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, inA))
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)

  // RECT_B is outside the selection: with marker active and no modifier the press paints over it.
  await drag(page, stage, await toLocal(page, { x: 230, y: 145 }), await toLocal(page, { x: 290, y: 175 }))

  const after = await editorState(page)
  expect(after.shapeCount).toBe(3)
  expect(after.selectedIds).toEqual([])
  expect(after.selectedId).toBeNull()
  expect(after.transforms[0]).toEqual(picked.transforms[0])
  expect(after.transforms[1]).toEqual(picked.transforms[1])
  const stroke = after.transforms[2]
  if (!stroke) throw new Error('no marker stroke recorded')
  expect(Math.abs(stroke.x - 230)).toBeLessThan(2)
  expect(Math.abs(stroke.w - 60)).toBeLessThan(2)

  await page.screenshot({ path: test.info().outputPath('marker-over-unselected.png') })
})

test('a plain press on empty picture with the marker tool active draws and clears the selection', async ({ page }) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  await drawRect(page, stage, RECT_A.from, RECT_A.to)
  await page.getByTestId('editor-tool-marker').click()

  const inA = await toLocal(page, { x: 70, y: 45 })
  await withCtrl(page, () => click(page, stage, inA))
  expect((await editorState(page)).selectedIds).toHaveLength(1)

  await drag(page, stage, await toLocal(page, { x: 140, y: 95 }), await toLocal(page, { x: 170, y: 112 }))

  const after = await editorState(page)
  expect(after.shapeCount).toBe(2)
  expect(after.selectedIds).toEqual([])
  expect(after.selectedId).toBeNull()
  expect(after.transforms[0]).toEqual({ x: 20, y: 20, w: 100, h: 50, rotation: 0 })
})

test('with select active a plain click still picks and Ctrl keeps the select behavior', async ({ page }) => {
  const stage = await openWithTwoRects(page)
  const inA = await toLocal(page, { x: 70, y: 45 })
  const inB = await toLocal(page, { x: 230, y: 145 })
  await click(page, stage, inA)
  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  expect(picked.transforms.map((transform) => [transform.x, transform.y])).toEqual([[20, 20], [180, 120]])

  await withCtrl(page, () => click(page, stage, inB))

  const ctrlPicked = await editorState(page)
  expect(ctrlPicked.selectedIds).toHaveLength(1)
  expect(ctrlPicked.selectedId).not.toBe(picked.selectedId)
  expect(ctrlPicked.transforms).toEqual(picked.transforms)
})

// The selection outline follows the active tool's color: select starts on its yellow default,
// and a palette pick repaints the dashed bbox instead of leaving a hardcoded grey outline.
// A 2× DPR is what makes the hairline sampleable: the overlay stroke is 1 CSS pixel, so at
// DPR 1 every pixel on the edge is only half covered and antialiased toward whatever is under it.
test('the selection outline follows the active tool color and a palette pick repaints it', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 2 })
  const page = await context.newPage()
  const stage = await openWithTwoRects(page)
  await click(page, stage, await toLocal(page, { x: 70, y: 45 }))
  const picked = await editorState(page)
  expect(picked.tool).toBe('select')
  expect(picked.color).toBe(HIGHLIGHTER_COLOR)
  expect(picked.selectedIds).toHaveLength(1)

  const runs = await bboxTopEdgeRuns(page, picked.transforms[0])
  // Matches are summed over the two dash runs so both halves of the edge are still checked.
  const runMatches = async (expected: Rgb): Promise<number> =>
    (await Promise.all(runs.map((run) => edgePixels(page, run.from, run.to, 2, expected, 60)))).reduce((total, hits) => total + hits, 0)
  expect(await runMatches(hexToRgb(HIGHLIGHTER_COLOR))).toBeGreaterThanOrEqual(3)
  expect(await runMatches(hexToRgb(OVERLAY_COLOR))).toBe(0)

  await page.getByTestId('editor-color-picker').click()
  await page.getByTestId('editor-color-#2F80ED').click()

  const recolored = await editorState(page)
  expect(recolored.color).toBe('#2F80ED')
  expect(recolored.selectedIds).toHaveLength(1)
  expect(recolored.transforms).toEqual(picked.transforms)

  expect(await runMatches(hexToRgb('#2F80ED'))).toBeGreaterThanOrEqual(3)
  expect(await runMatches(hexToRgb(HIGHLIGHTER_COLOR))).toBe(0)

  await page.screenshot({ path: test.info().outputPath('select-outline-color.png') })
  await context.close()
})

// A rotated shape is stretched along its own axes, measured against the bbox point opposite the
// grabbed handle, so the corner the drag never touches keeps its image-space position.
test('a rotated rect keeps its opposite corner pinned while its southeast handle is dragged', async ({ page }, testInfo) => {
  const stage = await openEditor(page)
  await page.getByTestId('editor-tool-rect').click()
  // Centered on the fixture so every rotated corner stays inside the picture and on the canvas.
  await drawRect(page, stage, { x: 110, y: 70 }, { x: 210, y: 130 })
  await page.getByTestId('editor-tool-select').click()
  await click(page, stage, await toLocal(page, { x: 160, y: 100 }))

  const picked = await editorState(page)
  expect(picked.selectedIds).toHaveLength(1)
  const box = picked.transforms[0]
  if (!box) throw new Error('rect lost its transform')

  const center = await toLocal(page, { x: box.x + box.w / 2, y: box.y + box.h / 2 })
  // The rotate handle hangs ROTATE_HANDLE_GAP above the bbox TOP, so its screen distance from
  // the center is (h/2 + gap) * scale — that distance also sets the drag radius.
  const radius = (box.h / 2 + ROTATE_HANDLE_GAP) * picked.scale
  await drag(page, stage, { x: center.x, y: center.y - radius }, { x: center.x + radius * Math.SQRT1_2, y: center.y - radius * Math.SQRT1_2 }, 6)

  const rotated = await editorState(page)
  const tilted = rotated.transforms[0]
  if (!tilted) throw new Error('rect lost its transform after rotating')
  expect(Math.abs(tilted.rotation - Math.PI / 4)).toBeLessThan(0.05)

  const corner = localToWorld(tilted, { x: 0, y: 0 })
  const handle = await toLocal(page, localToWorld(tilted, { x: tilted.w, y: tilted.h }))
  await drag(page, stage, handle, { x: handle.x + 30, y: handle.y + 20 })

  const grown = await editorState(page)
  const stretched = grown.transforms[0]
  if (!stretched) throw new Error('rect lost its transform after the resize')
  expect(stretched.rotation).toBeCloseTo(tilted.rotation, 6)
  expect(stretched.w).toBeGreaterThan(tilted.w)
  expect(localToWorld(stretched, { x: 0, y: 0 }).x).toBeCloseTo(corner.x, 1)
  expect(localToWorld(stretched, { x: 0, y: 0 }).y).toBeCloseTo(corner.y, 1)
  // The grabbed handle lands on the pointer: the drag moves it by exactly the pointer delta.
  const resting = await toLocal(page, localToWorld(stretched, { x: stretched.w, y: stretched.h }))
  expect(Math.abs(resting.x - (handle.x + 30))).toBeLessThan(1.5)
  expect(Math.abs(resting.y - (handle.y + 20))).toBeLessThan(1.5)

  await page.screenshot({ path: testInfo.outputPath('select-rotated-resize.png') })
})
