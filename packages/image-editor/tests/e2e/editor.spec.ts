import { expect, test, type Page } from '@playwright/test'
import { serve } from './serve.ts'
import type { EditorDebugState } from '../../src/editor.ts'

declare global {
  interface Window {
    __editorState?: () => EditorDebugState
    __lastExport?: { size: number; type: string } | null
  }
}

/** Middle-button drag from `from` to `to` — the editor's pan gesture. */
async function panWithMiddleButton(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 1): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up({ button: 'middle' })
}

type Box = { x: number; y: number; width: number; height: number }
type Rect = { left: number; top: number; width: number; height: number }
type Spot = { x: number; y: number }

/**
 * Client-space rect of the visible part of the picture — the area where a draw gesture is
 * accepted. Zoom re-clamps the offsets, so this is derived from the live view.
 */
function visibleImageRect(view: EditorDebugState, box: Box): Rect {
  const left = Math.max(box.x, box.x + view.offsetX)
  const top = Math.max(box.y, box.y + view.offsetY)
  const right = Math.min(box.x + box.width, box.x + view.offsetX + 240 * view.scale)
  const bottom = Math.min(box.y + box.height, box.y + view.offsetY + 160 * view.scale)
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * A drag that stays entirely in the letterboxed band around the fitted picture: the widest
 * band is picked, and both endpoints sit inside the canvas but outside the image rect.
 */
function letterboxedDrag(box: Box, rect: Rect): { from: Spot; to: Spot } {
  const midX = rect.left + rect.width / 2
  const midY = rect.top + rect.height / 2
  const right = rect.left + rect.width
  const bottom = rect.top + rect.height
  const bands = [
    { size: rect.left - box.x, from: { x: (box.x + rect.left) / 2, y: midY }, to: { x: box.x + 8, y: midY } },
    { size: box.x + box.width - right, from: { x: (right + box.x + box.width) / 2, y: midY }, to: { x: box.x + box.width - 8, y: midY } },
    { size: rect.top - box.y, from: { x: midX, y: (box.y + rect.top) / 2 }, to: { x: midX, y: box.y + 8 } },
    { size: box.y + box.height - bottom, from: { x: midX, y: (bottom + box.y + box.height) / 2 }, to: { x: midX, y: box.y + box.height - 8 } },
  ]
  const widest = bands.reduce((best, band) => (band.size > best.size ? band : best))
  expect(widest.size).toBeGreaterThan(16)
  return { from: widest.from, to: widest.to }
}

/**
 * Absolute points of an SVG path, tracking the current point through relative commands.
 * Arc radii, rotation and flags are parameters rather than coordinates, so only arc
 * endpoints count; horizontal and vertical commands keep the other axis unchanged.
 */
function pathPoints(d: string): Array<Spot> {
  let current = { x: 0, y: 0 }
  return (d.match(/[A-Za-z][^A-Za-z]*/g) ?? []).flatMap((segment) => {
    const command = segment.slice(0, 1)
    const numbers = segment.slice(1).match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    const stride = command === 'a' || command === 'A' ? 7 : command === 'h' || command === 'H' || command === 'v' || command === 'V' ? 1 : 2
    const relative = command === command.toLowerCase()
    return numbers.flatMap((_, index) => {
      if (index % stride !== 0) return []
      if (command === 'a' || command === 'A') {
        current = { x: relative ? current.x + numbers[index + 5] : numbers[index + 5], y: relative ? current.y + numbers[index + 6] : numbers[index + 6] }
        return [current]
      }
      if (command === 'h' || command === 'H') {
        current = { x: relative ? current.x + numbers[index] : numbers[index], y: current.y }
        return [current]
      }
      if (command === 'v' || command === 'V') {
        current = { x: current.x, y: relative ? current.y + numbers[index] : numbers[index] }
        return [current]
      }
      current = { x: relative ? current.x + numbers[index] : numbers[index], y: relative ? current.y + numbers[index + 1] : numbers[index + 1] }
      return [current]
    })
  })
}

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

async function syntheticImageSource(page: Page): Promise<string> {
  await page.goto('about:blank')
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context in the probe page')
    ctx.fillStyle = '#F2F3F5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#C9CED6'
    ctx.lineWidth = 1
    for (let x = 0; x <= canvas.width; x += 20) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    return canvas.toDataURL('image/png')
  })
}

test('annotate, undo, zoom, resize and save', async ({ page }, testInfo) => {
  const src = await syntheticImageSource(page)
  await page.goto(`${server.url}/?src=${encodeURIComponent(src)}`)

  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  for (const tool of ['select', 'marker', 'highlighter', 'arrow', 'rect', 'text', 'step']) {
    await expect(page.getByTestId(`editor-tool-${tool}`)).toBeVisible()
  }
  // Color and thickness are single trigger buttons; their palette lives in a popover
  // that only shows up once the trigger opens it.
  const colorTrigger = page.getByTestId('editor-color-picker')
  const widthTrigger = page.getByTestId('editor-width-picker')
  await expect(colorTrigger).toBeVisible()
  await expect(widthTrigger).toBeVisible()
  await expect(colorTrigger).toHaveAttribute('aria-label', 'Color')
  await expect(colorTrigger).toHaveAttribute('title', 'Color')
  await expect(widthTrigger).toHaveAttribute('aria-label', 'Thickness')
  await expect(widthTrigger).toHaveAttribute('title', 'Thickness 8px')
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(widthTrigger).toHaveAttribute('aria-expanded', 'false')
  for (const color of ['#E5484D', '#FFD666', '#F5A623', '#2F80ED', '#27AE60', '#9B51E0', '#1A1A1A', '#FFFFFF']) {
    await expect(page.getByTestId(`editor-color-${color}`)).toBeHidden()
  }
  for (const width of [2, 4, 8, 14]) {
    await expect(page.getByTestId(`editor-width-${width}`)).toBeHidden()
  }
  await expect(page.getByTestId('editor-undo')).toBeVisible()
  await expect(page.getByTestId('editor-save')).toBeVisible()
  await expect(page.getByTestId('editor-cancel')).toBeVisible()

  // Icon-only toolbar buttons: accessible name via aria-label/title, inline SVG glyph, no text node.
  const iconButtons: Array<[string, string]> = [
    ['editor-tool-select', 'Select'],
    ['editor-tool-marker', 'Marker'],
    ['editor-tool-highlighter', 'Highlighter'],
    ['editor-tool-arrow', 'Arrow'],
    ['editor-tool-rect', 'Rectangle'],
    ['editor-tool-text', 'Text'],
    ['editor-tool-step', 'Step'],
    ['editor-reset-view', 'Reset view'],
    ['editor-undo', 'Undo (Ctrl+Z)'],
    ['editor-save', 'Save'],
    ['editor-cancel', 'Cancel'],
  ]
  for (const [testid, label] of iconButtons) {
    const button = page.getByTestId(testid)
    await expect(button).toHaveAttribute('aria-label', label)
    await expect(button).toHaveAttribute('title', label)
    await expect(button.locator('svg')).toHaveCount(1)
    await expect(button).toHaveText('')
  }

  await expect.poll(() => editorState(page)).toMatchObject({
    tool: 'marker',
    color: '#E5484D',
    width: 8,
    shapeCount: 0,
    selectedId: null,
    selectedIds: [],
  })
  await expect(page.getByTestId('editor-tool-marker')).toHaveAttribute('data-active', 'true')

  // The color trigger shows the current swatch; opening the popover reveals the palette,
  // picking a swatch updates the default, marks it active and closes the popover again.
  await expect(colorTrigger.locator('.ie-swatch')).toHaveCSS('background-color', 'rgb(229, 72, 77)')
  await colorTrigger.click()
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'true')
  for (const color of ['#E5484D', '#FFD666', '#F5A623', '#2F80ED', '#27AE60', '#9B51E0', '#1A1A1A', '#FFFFFF']) {
    await expect(page.getByTestId(`editor-color-${color}`)).toBeVisible()
  }
  await expect(page.getByTestId('editor-color-#E5484D')).toHaveAttribute('data-active', 'true')
  await page.getByTestId('editor-color-#2F80ED').click()
  await expect.poll(() => editorState(page)).toMatchObject({ color: '#2F80ED' })
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('editor-color-#2F80ED')).toBeHidden()
  await expect(colorTrigger.locator('.ie-swatch')).toHaveCSS('background-color', 'rgb(47, 128, 237)')

  // The thickness trigger's glyph strokes at the current width; Escape closes its popover.
  await widthTrigger.click()
  await expect(widthTrigger).toHaveAttribute('aria-expanded', 'true')
  for (const width of [2, 4, 8, 14]) {
    await expect(page.getByTestId(`editor-width-${width}`)).toBeVisible()
  }
  await expect(page.getByTestId('editor-width-8')).toHaveAttribute('data-active', 'true')
  await page.keyboard.press('Escape')
  await expect(widthTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('editor-width-8')).toBeHidden()

  // Opening one trigger closes the other popover; picking a width updates the default,
  // the announced px value and the glyph stroke.
  await colorTrigger.click()
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'true')
  await widthTrigger.click()
  await expect(widthTrigger).toHaveAttribute('aria-expanded', 'true')
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('editor-color-#E5484D')).toBeHidden()
  await page.getByTestId('editor-width-2').click()
  await expect.poll(() => editorState(page)).toMatchObject({ width: 2 })
  await expect(widthTrigger).toHaveAttribute('title', 'Thickness 2px')
  await expect(widthTrigger.locator('svg line')).toHaveAttribute('stroke-width', '2')
  await expect(widthTrigger).toHaveAttribute('aria-expanded', 'false')

  // A click outside the toolbar closes whichever popover is open.
  await colorTrigger.click()
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId('editor-status').click()
  await expect(colorTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('editor-color-#2F80ED')).toBeHidden()

  const canvasBox = await page.getByTestId('editor-canvas').boundingBox()
  if (!canvasBox) throw new Error('canvas has no bounding box')
  await expect.poll(async () => (await editorState(page)).scale).toBeGreaterThan(1)

  // Drawing is only accepted inside the picture, so the gesture corners are derived from the
  // visible part of the image rect rather than raw canvas offsets (zoom re-clamps the view).
  const beforeZoom = visibleImageRect(await editorState(page), canvasBox)
  const corner = { x: beforeZoom.left + beforeZoom.width * 0.15, y: beforeZoom.top + beforeZoom.height * 0.15 }
  const opposite = { x: beforeZoom.left + beforeZoom.width * 0.45, y: beforeZoom.top + beforeZoom.height * 0.45 }

  await page.getByTestId('editor-tool-rect').click()
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(opposite.x, opposite.y)
  await page.mouse.up()
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(1)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(0)

  const scaleBefore = (await editorState(page)).scale
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => (await editorState(page)).scale).toBeGreaterThan(scaleBefore)

  const afterZoom = visibleImageRect(await editorState(page), canvasBox)
  const zoomedCorner = { x: afterZoom.left + afterZoom.width * 0.15, y: afterZoom.top + afterZoom.height * 0.15 }
  const zoomedOpposite = { x: afterZoom.left + afterZoom.width * 0.45, y: afterZoom.top + afterZoom.height * 0.45 }

  await page.mouse.move(zoomedCorner.x, zoomedCorner.y)
  await page.mouse.down()
  await page.mouse.move(zoomedOpposite.x, zoomedOpposite.y)
  await page.mouse.up()
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(1)

  // Picking and resizing need the select tool: while rect is active a plain press draws.
  await page.getByTestId('editor-tool-select').click()
  await page.mouse.click((zoomedCorner.x + zoomedOpposite.x) / 2, (zoomedCorner.y + zoomedOpposite.y) / 2)
  await expect.poll(async () => (await editorState(page)).selectedId).not.toBeNull()

  const widthBefore = (await editorState(page)).transforms[0]?.w ?? 0
  await page.mouse.move(zoomedOpposite.x, zoomedOpposite.y)
  await page.mouse.down()
  await page.mouse.move(zoomedOpposite.x + 30, zoomedOpposite.y)
  await page.mouse.up()
  await expect.poll(async () => (await editorState(page)).transforms[0]?.w ?? 0).toBeGreaterThan(widthBefore)

  await page.getByTestId('editor-save').click()
  await expect.poll(() => page.evaluate(() => window.__lastExport?.type)).toBe('image/png')
  await expect.poll(() => page.evaluate(() => window.__lastExport?.size ?? 0)).toBeGreaterThan(0)

  await page.screenshot({ path: testInfo.outputPath('editor-stage.png') })
})

test('middle-button pan tracks the pointer, is bounded by the image, and reset refits the view', async ({ page }) => {
  const src = await syntheticImageSource(page)
  await page.goto(`${server.url}/?src=${encodeURIComponent(src)}`)
  await expect.poll(async () => (await editorState(page)).scale).toBeGreaterThan(1)

  const canvasBox = await page.getByTestId('editor-canvas').boundingBox()
  if (!canvasBox) throw new Error('canvas has no bounding box')
  const center = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 }
  const fitted = await editorState(page)

  await page.mouse.move(center.x, center.y)
  await page.mouse.wheel(0, -240)
  const zoomed = await editorState(page)
  expect(zoomed.scale).toBeGreaterThan(fitted.scale)

  // Dragging toward the centre moves the picture by exactly the screen delta: pan math is
  // screen-space and the origin is never re-derived from the view it just changed.
  await panWithMiddleButton(page, center, { x: center.x + 60, y: center.y + 40 })
  const panned = await editorState(page)
  expect(panned.scale).toBe(zoomed.scale)
  expect(panned.offsetX - zoomed.offsetX).toBeCloseTo(60, 6)
  expect(panned.offsetY - zoomed.offsetY).toBeCloseTo(40, 6)

  // Dragging back lands on the same offsets — no accumulated drift.
  await panWithMiddleButton(page, { x: center.x + 60, y: center.y + 40 }, center)
  expect(await editorState(page)).toEqual(zoomed)

  // A real drag fires many pointermove events: the picture must track the pointer's total
  // displacement, not re-apply every incremental delta against the view it just moved.
  await panWithMiddleButton(page, center, { x: center.x + 45, y: center.y - 25 }, 8)
  const stepped = await editorState(page)
  expect(stepped.offsetX - zoomed.offsetX).toBeCloseTo(45, 6)
  expect(stepped.offsetY - zoomed.offsetY).toBeCloseTo(-25, 6)

  // Draging far toward the top-left pins the view at the lower edge of the clamp window on
  // each axis (the image edge that faces the drag lands on the viewport edge), so the picture
  // never leaves the viewport, and dragging further changes nothing.
  const topLeft = { x: 0, y: 0 }
  await panWithMiddleButton(page, center, topLeft)
  const dragged = await editorState(page)
  expect(dragged.offsetX).toBeLessThan(zoomed.offsetX)
  expect(dragged.offsetY).toBeLessThan(zoomed.offsetY)

  await panWithMiddleButton(page, center, topLeft)
  const bounded = await editorState(page)
  expect(bounded.offsetX).toBeCloseTo(Math.min(canvasBox.width - 240 * bounded.scale, 0), 1)
  expect(bounded.offsetY).toBeCloseTo(Math.min(canvasBox.height - 160 * bounded.scale, 0), 1)

  await panWithMiddleButton(page, center, topLeft)
  expect(await editorState(page)).toEqual(bounded)

  await page.getByTestId('editor-reset-view').click()
  const reset = await editorState(page)
  expect(reset.scale).toBeCloseTo(fitted.scale, 6)
  expect(reset.offsetX).toBeCloseTo(fitted.offsetX, 6)
  expect(reset.offsetY).toBeCloseTo(fitted.offsetY, 6)

  // Toolbar order: tools | color, width | reset, undo | save, cancel.
  const toolbarOrder = await page.evaluate(() => Array.from(document.querySelectorAll('.ie-toolbar [data-testid]'), (node) => node.dataset.testid))
  const indexOf = (testid: string): number => toolbarOrder.indexOf(testid)
  expect(indexOf('editor-width-picker')).toBeLessThan(indexOf('editor-reset-view'))
  expect(indexOf('editor-reset-view')).toBeLessThan(indexOf('editor-undo'))
  expect(indexOf('editor-undo')).toBeLessThan(indexOf('editor-save'))
  expect(indexOf('editor-save')).toBeLessThan(indexOf('editor-cancel'))
})

// Export is the image's natural size, so a shape outside the picture would never appear in
// the PNG: such gestures are refused, and a gesture that starts inside is pinned to the rect.
test('drawing outside the picture is refused and gestures are pinned to the image bounds', async ({ page }, testInfo) => {
  const src = await syntheticImageSource(page)
  await page.goto(`${server.url}/?src=${encodeURIComponent(src)}`)
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(0)

  const canvasBox = await page.getByTestId('editor-canvas').boundingBox()
  if (!canvasBox) throw new Error('canvas has no bounding box')
  await expect.poll(async () => (await editorState(page)).scale).toBeGreaterThan(1)

  // Fitted view: the whole picture is visible, so the bands around it are the letterbox.
  const fitted = await editorState(page)
  const rect = visibleImageRect(fitted, canvasBox)
  const letterbox = letterboxedDrag(canvasBox, rect)
  const insidePicture = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  const insideTopLeft = { x: rect.left + 24, y: rect.top + 24 }

  // A marker drag that never touches the picture draws nothing and must not pan either.
  await page.mouse.move(letterbox.from.x, letterbox.from.y)
  await page.mouse.down()
  await page.mouse.move(letterbox.to.x, letterbox.to.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(0)
  expect(await editorState(page)).toMatchObject({ offsetX: fitted.offsetX, offsetY: fitted.offsetY, scale: fitted.scale })

  // A stroke that starts inside and is dragged past the picture is pinned at the image edge.
  await page.mouse.move(insidePicture.x, insidePicture.y)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width - 4, canvasBox.y + canvasBox.height, { steps: 10 })
  await page.mouse.up()
  const pinned = await editorState(page)
  expect(pinned.shapeCount).toBe(1)
  pinned.transforms.forEach((transform) => {
    expect(transform.x).toBeGreaterThanOrEqual(0)
    expect(transform.y).toBeGreaterThanOrEqual(0)
    expect(transform.x + transform.w).toBeLessThanOrEqual(240 + 1e-6)
    expect(transform.y + transform.h).toBeLessThanOrEqual(160 + 1e-6)
  })
  await page.screenshot({ path: testInfo.outputPath('pinned-stroke.png') })

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(0)

  // Text outside the picture opens no inline input; inside the picture it still does.
  await page.getByTestId('editor-tool-text').click()
  await page.mouse.click(letterbox.from.x, letterbox.from.y)
  await expect(page.locator('.ie-text-input')).toHaveCount(0)
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(0)

  await page.mouse.click(insideTopLeft.x, insideTopLeft.y)
  await expect(page.locator('.ie-text-input')).toHaveCount(1)
  await page.keyboard.type('note')
  await page.keyboard.press('Enter')
  await expect(page.locator('.ie-text-input')).toHaveCount(0)
  await expect.poll(async () => (await editorState(page)).shapeCount).toBe(1)
  expect(await editorState(page)).toMatchObject({ offsetX: fitted.offsetX, offsetY: fitted.offsetY, scale: fitted.scale })
})

// The button row must sit centered inside the toolbar, and the palette popover must stay
// anchored under its trigger now that the row is centered.
test('toolbar button row is centered and the palette popover stays anchored under its trigger', async ({ page }, testInfo) => {
  const src = await syntheticImageSource(page)
  await page.goto(`${server.url}/?src=${encodeURIComponent(src)}`)
  await expect(page.getByTestId('editor-canvas')).toBeVisible()

  // Insets are measured from live bounding boxes, so the assertion holds at any viewport
  // width: a centered row leaves equal gaps on both sides of the button span. Popover items
  // carry .ie-btn too but are hidden, so they drop out of the span via the zero-width check.
  const insets = await page.evaluate(() => {
    const toolbar = document.querySelector('.ie-toolbar')
    if (!(toolbar instanceof HTMLElement)) throw new Error('toolbar missing')
    const box = toolbar.getBoundingClientRect()
    const spans = Array.from(toolbar.querySelectorAll('.ie-btn')).flatMap((node) => {
      if (!(node instanceof HTMLElement)) return []
      const buttonBox = node.getBoundingClientRect()
      if (buttonBox.width === 0) return []
      return [{ left: buttonBox.left, right: buttonBox.right }]
    })
    if (spans.length === 0) throw new Error('toolbar has no visible buttons')
    return {
      leftInset: Math.min(...spans.map((span) => span.left)) - box.left,
      rightInset: box.right - Math.max(...spans.map((span) => span.right)),
    }
  })
  expect(insets.leftInset).toBeGreaterThan(0)
  expect(insets.rightInset).toBeGreaterThan(0)
  expect(Math.abs(insets.leftInset - insets.rightInset)).toBeLessThanOrEqual(2)

  // The popover's left edge lines up with the trigger's left edge: offsetLeft-based anchoring
  // tracks the trigger wherever the centered row places it.
  await page.getByTestId('editor-color-picker').click()
  const popoverBox = await page.locator('.ie-popover:visible').boundingBox()
  const triggerBox = await page.getByTestId('editor-color-picker').boundingBox()
  if (!popoverBox || !triggerBox) throw new Error('popover or trigger has no bounding box')
  // boundingBox() reports x/y/width/height, not the DOM rect's left/top/bottom.
  expect(Math.abs(popoverBox.x - triggerBox.x)).toBeLessThanOrEqual(2)
  expect(popoverBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height)

  const toolbarBox = await page.locator('.ie-toolbar').boundingBox()
  if (!toolbarBox) throw new Error('toolbar has no bounding box')
  await page.screenshot({
    path: testInfo.outputPath('toolbar-centered.png'),
    clip: { x: toolbarBox.x, y: toolbarBox.y, width: toolbarBox.width, height: toolbarBox.height + popoverBox.height + 8 },
  })
})

// The undo glyph must read as "go back": arrowhead pointing left at the leftmost vertex,
// shaft running right from it, hook looping below the shaft. A clockwise U-turn (stroke
// coming in from the right and returning over the top with the arrowhead at the top) fails
// the arc check and the vertex/hook geometry checks.
test('undo glyph reads as a left-pointing arrow with the hook below the shaft', async ({ page }, testInfo) => {
  const src = await syntheticImageSource(page)
  await page.goto(`${server.url}/?src=${encodeURIComponent(src)}`)

  const undoButton = page.getByTestId('editor-undo')
  await expect(undoButton).toBeVisible()
  await expect(undoButton).toHaveAttribute('aria-label', 'Undo (Ctrl+Z)')
  await expect(undoButton.locator('svg')).toHaveCount(1)

  const shapes = await undoButton.locator('svg path').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d') ?? ''))
  expect(shapes.length).toBeGreaterThan(0)
  const paths = shapes.map((d) => pathPoints(d))
  expect(paths.every((points) => points.length > 0)).toBe(true)

  // (a) the hook is drawn with arc commands, so the loop cannot be a straight-line U-turn.
  expect(shapes.some((d) => /[aA]/.test(d))).toBe(true)

  // (b) the global minimum-x coordinate is the arrowhead vertex, and the path forming the
  // arrowhead spans a small x range around it — tips up-right and down-right of the vertex.
  const vertex = paths.flatMap((points) => points).reduce((left, point) => (point.x < left.x ? point : left))
  const arrowheads = paths.filter((points) => points.length >= 2 && points.some((point) => point.x === vertex.x) && Math.max(...points.map((point) => point.x)) - vertex.x <= 4.5)
  expect(arrowheads.length).toBeGreaterThanOrEqual(1)
  arrowheads.forEach((points) => {
    expect(points.some((point) => point.x > vertex.x && point.y < vertex.y)).toBe(true)
    expect(points.some((point) => point.x > vertex.x && point.y > vertex.y)).toBe(true)
  })

  // (c) every coordinate on the arc-bearing path sits strictly below the vertex's shaft line:
  // nothing returns over the top, which is what kills the U-turn look.
  const hooked = paths.filter((points, index) => /[aA]/.test(shapes[index] ?? ''))
  expect(hooked.length).toBeGreaterThanOrEqual(1)
  hooked.forEach((points) => {
    expect(points.every((point) => point.y > vertex.y)).toBe(true)
  })

  const undoBox = await undoButton.boundingBox()
  if (!undoBox) throw new Error('undo button has no bounding box')
  await page.screenshot({
    path: testInfo.outputPath('undo-icon.png'),
    clip: { x: undoBox.x - 20, y: undoBox.y - 20, width: undoBox.width + 40, height: undoBox.height + 40 },
  })
  const toolbarBox = await page.locator('.ie-toolbar').boundingBox()
  if (!toolbarBox) throw new Error('toolbar has no bounding box')
  await page.screenshot({ path: testInfo.outputPath('undo-toolbar.png'), clip: toolbarBox })
})
