// Label-format acceptance lane, driven through the dev page over http like the other specs.
// Visible picker labels are bare numbers; tooltips (title/aria-label) keep the px unit.
import { expect, test, type Page } from '@playwright/test'
import { serve, type Lane } from './serve.ts'
import { DEFAULT_FONT_SIZE, DEFAULT_WIDTH, FONT_SIZE_PRESETS, WIDTH_PRESETS } from '../../src/index.ts'
import type { EditorDebugState } from '../../src/editor.ts'

declare global {
  interface Window {
    __editorState?: () => EditorDebugState
  }
}

type Box = { x: number; y: number; width: number; height: number }
type Local = { x: number; y: number }

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

/** Mounts the editor over a flat fixture image and reports the canvas geometry for pointer math. */
async function openEditor(page: Page): Promise<Box> {
  await page.goto('about:blank')
  const src = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 200
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context in the probe page')
    ctx.fillStyle = '#F2F3F5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  })
  await page.goto(`${server.url}/?src=${encodeURIComponent(src)}`)
  await expect.poll(() => editorState(page)).toMatchObject({ shapeCount: 0 })
  const box = await page.getByTestId('editor-canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  return box
}

/** Places the text tool's anchor, opening the editing field. */
async function openField(page: Page, box: Box, anchor: Local): Promise<void> {
  await page.getByTestId('editor-tool-text').click()
  await page.mouse.move(box.x + anchor.x, box.y + anchor.y)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.getByTestId('editor-text-input')).toBeVisible()
}

/** Commits a label through the field, so it becomes a selectable text shape. */
async function placeText(page: Page, box: Box, anchor: Local, content: string): Promise<void> {
  await openField(page, box, anchor)
  await page.keyboard.type(content)
  await page.keyboard.press('Enter')
}

// The thickness palette is the toolbar popover: every item announces the unit, none prints it.
test('width popover items read as bare numbers while their tooltips keep px', async ({ page }, testInfo) => {
  await openEditor(page)
  const trigger = page.getByTestId('editor-width-picker')
  await expect(trigger).toHaveAttribute('title', `Thickness ${DEFAULT_WIDTH}px`)
  await expect(page.getByTestId('editor-color-picker')).toBeVisible()

  await trigger.click()
  for (const px of WIDTH_PRESETS) {
    const item = page.getByTestId(`editor-width-${px}`)
    await expect(item).toBeVisible()
    await expect(item).toHaveText(`${px}`)
    await expect(item).not.toContainText('px')
    await expect(item).toHaveAttribute('title', `${px}px`)
    await expect(item).toHaveAttribute('aria-label', `${px}px`)
  }

  await page.screenshot({ path: testInfo.outputPath('labels-width-popover.png') })
})

// The font palette opens under the size button that floats above the editing field.
test('font-size popover items read as bare numbers while their tooltips keep px', async ({ page }, testInfo) => {
  const box = await openEditor(page)
  await openField(page, box, { x: box.width / 2 - 100, y: box.height / 2 - 40 })
  await page.getByTestId('editor-text-size').click()

  for (const px of FONT_SIZE_PRESETS) {
    const item = page.getByTestId(`editor-font-size-${px}`)
    await expect(item).toBeVisible()
    await expect(item).toHaveText(`${px}`)
    await expect(item).not.toContainText('px')
    await expect(item).toHaveAttribute('title', `${px}px`)
    await expect(item).toHaveAttribute('aria-label', `${px}px`)
  }

  await page.screenshot({ path: testInfo.outputPath('labels-font-size-popover.png') })
})

// The button above the field mirrors the size being written; it must not spell the unit out.
test('the size button above the editing field shows a bare number', async ({ page }, testInfo) => {
  const box = await openEditor(page)
  await openField(page, box, { x: box.width / 2 - 100, y: box.height / 2 - 40 })
  const button = page.getByTestId('editor-text-size')
  await expect(button).toHaveText(`${DEFAULT_FONT_SIZE}`)
  await expect(button).not.toContainText('px')

  await button.click()
  await page.getByTestId('editor-font-size-32').click()
  await expect(button).toHaveText('32')
  await expect(button).not.toContainText('px')

  await page.screenshot({ path: testInfo.outputPath('labels-text-size-button.png') })
})

// The canvas-level button above a selected label behaves the same way.
test('the size button above a selected label shows a bare number', async ({ page }, testInfo) => {
  const box = await openEditor(page)
  const anchor = { x: box.width / 2 - 100, y: box.height / 2 - 40 }
  await placeText(page, box, anchor, 'note')
  await expect.poll(() => editorState(page)).toMatchObject({ shapeCount: 1 })

  await page.getByTestId('editor-tool-select').click()
  await page.mouse.click(box.x + anchor.x + 12, box.y + anchor.y + 12)
  await expect.poll(async () => (await editorState(page)).selectedId).not.toBeNull()

  const button = page.getByTestId('editor-shape-size')
  await expect(button).toBeVisible()
  await expect(button).toHaveText(`${DEFAULT_FONT_SIZE}`)
  await expect(button).not.toContainText('px')

  await page.screenshot({ path: testInfo.outputPath('labels-shape-size-button.png') })
})
