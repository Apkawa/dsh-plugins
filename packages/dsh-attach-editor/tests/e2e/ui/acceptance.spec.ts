// Playwright acceptance suite for the attach-editor sidebar tab (one describe
// per pinned dsh version; the version matrix is a loop because Playwright has
// no test.describe.each). Mirrors the global-queue acceptance spec's shape:
// spawn an isolated `dsh web` over a temp home, drive the real UI, then stop.
import { deflateSync } from 'node:zlib'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { trackConsoleErrors } from '@root/tests-helpers/e2e/live.ts'
import { E2E_DSH_VERSIONS, launchDsh, stopDsh } from '@root/tests-helpers/e2e/dsh.ts'
import type { DshHandle } from '@root/tests-helpers/e2e/dsh.ts'

// DOM hooks this suite relies on:
//   [data-sidebar-right-expand]        framework: conversation header, expands the rightbar
//   [data-sidebar-right-open]          framework: the rightbar while it is open
//   [data-sidebar-right-guide]         framework: the Start page body (shown when no tab is open)
//   [data-sidebar-right-guide-entry="attach-editor"]
//                                       framework: the guide entry capsule contributed by the
//                                       tab type's guide registration (the attribute value is
//                                       the entry's *kind*, which is our tab kind)
//   [data-dockkit-tab] / [data-dockkit-tab-close]
//                                       framework: docked tab chips and their close buttons
//   getByRole('tab', { name: 'Annotate image' })
//                                       framework: the tab chip, named from the tab type's title
//   [data-testid="attach-editor-pane"] plugin: the tab body wrapper; inside it
//                                       `attach-editor-idle` / `attach-editor-missing`
//                                       hints, `attach-editor-blocked` refusal banner,
//                                       and `attach-editor-body` (the editor mount point)
//   [data-testid="editor-canvas"] / [data-testid="editor-save"] …
//                                       editor: the image-editor toolbar and canvas
//                                       (mounted privately into the plugin bundle)
//   [data-composer-card]               framework: the composer card (input bar)
//   input[type="file"] inside it       framework: the composer's hidden file input;
//                                       setInputFiles fires its change handler — the same
//                                       intake path the paperclip button opens
//   [data-testid="attach-editor-thumb"] plugin: the rail thumbnail button for an image
//                                       attachment (also carries data-attachment-kind="image")
//   [data-testid="attach-editor-remove"] plugin: the rail remove button per attachment
//   [data-testid="attach-editor-preview"] plugin: our portal preview overlay over the image,
//                                       with a header ABOVE the image holding
//                                       [data-testid="attach-editor-edit-button"] ("Edit image")
//                                       and a Close button; mask click and Escape close it
//   [data-testid="attach-editor-mask"] plugin: the overlay's dimming mask (click closes)
//   [role="alert"]                     framework: the ui-primitives Toast (portal; it holds
//                                       ~3 s then fades) — the prompt-error surface
const WORKSPACE = path.join(fileURLToPath(new URL('../../../..', import.meta.url)), '.tmp', 'attach-editor-e2e-workspace')

// A real 320x200 PNG written under .tmp/: a non-trivial blue→green gradient,
// hand-encoded (zlib deflate + crc32) so no image dependency is added. The
// composer's intake pre-check accepts image/png regardless of the selected
// model — vision gating lives at prompt submit, which the send step below
// exercises for real. The center pixel (≈ rgb(61,160,140)) is far from the
// editor's default stroke color (#E5484D), so a red pixel at (160,100) in the
// saved bytes proves a marker stroke landed.
const PNG_FIXTURE = path.join(fileURLToPath(new URL('../../../..', import.meta.url)), '.tmp', 'attach-editor-e2e', 'fixture.png')
mkdirSync(path.dirname(PNG_FIXTURE), { recursive: true })
const FIXTURE_BYTES = png320x200()
writeFileSync(PNG_FIXTURE, FIXTURE_BYTES)

// The shared launcher boots a plain `dsh web` (no in-page picker overlay), so the
// workspace picker on a headless host is the native backend, which shells out to
// `zenity` — absent in this sandbox. `dsh.ts` spawns the server with the test
// process's env, so a `zenity` shim first on PATH answers the native picker with
// the workspace path; the click flow then runs end to end.
const SHIM_DIR = path.join(fileURLToPath(new URL('../../../..', import.meta.url)), '.tmp', 'attach-editor-e2e-shims')
mkdirSync(SHIM_DIR, { recursive: true })
const shimPath = path.join(SHIM_DIR, 'zenity')
writeFileSync(shimPath, `#!/bin/sh\necho "${WORKSPACE}"\n`)
chmodSync(shimPath, 0o755)
process.env.PATH = `${SHIM_DIR}:${process.env.PATH}`

// A file-wide timeout: provisioning happens in beforeAll (180 s there), and the
// per-test page load + workspace connect + guide lookup needs headroom beyond
// the 30 s config default.
test.setTimeout(60_000)

for (const version of E2E_DSH_VERSIONS) {
  test.describe(`attach-editor "Annotate image" tab on dsh ${version}`, () => {
    let handle: DshHandle | undefined
    let cookie: string | null

    test.beforeAll(async () => {
      handle = await launchDsh({ packageName: 'dsh-attach-editor', keyless: true, port: 0, version })
      cookie = handle.cookie
      mkdirSync(WORKSPACE, { recursive: true })
    }, 180_000)

    test.afterAll(async () => {
      // Guaranteed cleanup: a throwing suite must still stop the spawned `dsh web`
      // and remove the temp root, or the child leaks its port and .tmp/dsh-e2e-*.
      if (handle !== undefined) await stopDsh(handle)
    })

    test('guide entry: the Start page lists "Annotate image" and picking it opens the tab with its pane', async ({ page }) => {
      const errors = trackConsoleErrors(page)
      await openRightbar(page)
      // Close every docked tab except Start so the guide page is on screen.
      const chips = page.locator('[data-dockkit-tab]')
      for (let i = await chips.count() - 1; i >= 0; i--) {
        const chip = chips.nth(i)
        if ((await chip.textContent()) === 'Start') continue
        const close = chip.locator('[data-dockkit-tab-close]')
        if (await close.count() === 0) continue
        await close.click()
      }
      // Closing the sole docked tab collapses the column; expanding re-seeds the
      // default page, which is the Start page once the guide entries register.
      if (await chips.count() === 0) await page.locator('[data-sidebar-right-expand]').click()
      const guide = page.locator('[data-sidebar-right-guide]')
      await expect(guide).toBeVisible({ timeout: 15_000 })
      const entry = guide.locator('[data-sidebar-right-guide-entry="attach-editor"]')
      await expect(entry).toBeVisible({ timeout: 15_000 })
      await expect(entry).toContainText('Annotate image')
      // Picking the capsule opens the tab; the chip carries the tab title and the
      // body renders our pane.
      await entry.click()
      const tab = page.getByRole('tab', { name: 'Annotate image' })
      await expect(tab).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('attach-editor-pane')).toBeVisible()

      // Lane sanity: the client bundle loaded and registered on the module table.
      expect(errors().filter(text => /missed the module table/.test(text))).toEqual([])
      expect(await page.getByText('Failed to load plugins').count()).toBe(0)
    })

    test('image intake: a picked PNG renders a rail thumbnail, previews with an Edit button above the image, opens the tab, and removes', async ({ page }) => {
      const errors = trackConsoleErrors(page)
      // openRightbar connects the workspace and leaves a session open — the
      // composer needs a session id for `addFiles` intake to run.
      await openRightbar(page)

      // The hidden intake input accepts the fixture exactly like the paperclip:
      // setInputFiles fires the change handler → intake pre-check → drafts.
      await page.locator('[data-composer-card] input[type="file"]').setInputFiles(PNG_FIXTURE)
      const thumb = page.getByTestId('attach-editor-thumb')
      await expect(thumb).toBeVisible({ timeout: 15_000 })
      expect(await thumb.getAttribute('data-attachment-kind')).toBe('image')

      await thumb.click()
      const preview = page.getByTestId('attach-editor-preview')
      await expect(preview).toBeVisible()
      const edit = preview.getByTestId('attach-editor-edit-button')
      await expect(edit).toBeVisible()
      await expect(edit).toHaveText('Edit image')

      // The header sits ABOVE the image: the edit button's box is above the img's box.
      const editBox = await edit.boundingBox()
      const imageBox = await preview.locator('img').boundingBox()
      expect(editBox !== null && imageBox !== null && editBox.y < imageBox.y).toBe(true)

      // Edit records the edit session and opens our sidebar tab.
      await edit.click()
      await expect(page.getByRole('tab', { name: 'Annotate image' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('attach-editor-pane')).toBeVisible()

      // Escape closes the preview overlay; the tab stays open.
      await page.keyboard.press('Escape')
      await expect(preview).toHaveCount(0)
      await expect(page.getByTestId('attach-editor-pane')).toBeVisible()

      // Reopening and clicking the mask (away from the centered image) closes too.
      await thumb.click()
      await expect(preview).toBeVisible()
      await preview.getByTestId('attach-editor-mask').click({ position: { x: 12, y: 12 } })
      await expect(preview).toHaveCount(0)

      // The remove button drops the attachment from the rail.
      await page.getByTestId('attach-editor-remove').click()
      await expect(thumb).toHaveCount(0)

      // Lane sanity: the rail bundle loaded and registered.
      expect(errors().filter(text => /missed the module table/.test(text))).toEqual([])
      expect(await page.getByText('Failed to load plugins').count()).toBe(0)
    })

    test('annotate → save: the edited PNG replaces the draft attachment, then sending shows how the host treats image input', async ({ page }) => {
      const errors = trackConsoleErrors(page)
      await openRightbar(page)

      await page.locator('[data-composer-card] input[type="file"]').setInputFiles(PNG_FIXTURE)
      const thumb = page.getByTestId('attach-editor-thumb')
      await expect(thumb).toBeVisible({ timeout: 15_000 })
      const oldSrc = await thumb.locator('img').getAttribute('src')
      expect(oldSrc !== null && oldSrc.startsWith('blob:')).toBe(true)

      // Thumbnail → preview overlay → Edit image; the tab opens with the editor mounted.
      await thumb.click()
      const preview = page.getByTestId('attach-editor-preview')
      await expect(preview).toBeVisible()
      await preview.getByTestId('attach-editor-edit-button').click()
      await expect(page.getByRole('tab', { name: 'Annotate image' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('attach-editor-body')).toBeVisible({ timeout: 15_000 })
      const canvas = page.getByTestId('editor-canvas')
      await expect(canvas).toBeVisible()
      await expect(page.getByTestId('editor-tool-marker')).toBeVisible()
      await expect(page.getByTestId('editor-color-picker')).toBeVisible()
      await expect(page.getByTestId('editor-width-picker')).toBeVisible()
      await expect(page.getByTestId('editor-undo')).toBeVisible()
      await expect(page.getByTestId('editor-save')).toBeVisible()
      await expect(page.getByTestId('editor-cancel')).toBeVisible()

      // The color palette is a popover: the swatch shows only after the trigger opens it,
      // and picking the swatch closes the popover again.
      await expect(page.getByTestId('editor-color-#E5484D')).toBeHidden()
      await page.getByTestId('editor-color-picker').click()
      await expect(page.getByTestId('editor-color-#E5484D')).toBeVisible()
      await page.getByTestId('editor-color-#E5484D').click()
      await expect(page.getByTestId('editor-color-#E5484D')).toBeHidden()

      // A marker stroke through the canvas center lands on the image center
      // (fitView centers the image in the world), so the live canvas shows the
      // default red stroke there — sampled the same way image-editor's tools
      // suite samples (device pixels via getImageData, no debug hooks).
      const box = await canvas.boundingBox()
      if (box === null) throw new Error('the editor canvas is not laid out')
      const centerX = box.x + box.width / 2
      const centerY = box.y + box.height / 2
      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await page.mouse.move(centerX + 60, centerY, { steps: 8 })
      await page.mouse.up()
      await expect.poll(() => canvasPixelDistance(page, box), { timeout: 5_000 }).toBeLessThan(90)

      // Save composes the replacement: a new draft image is added, the edited
      // attachment leaves the draft. Exactly one thumbnail remains, its bytes
      // are the edited export, and the pane returns to idle.
      await page.getByTestId('editor-save').click()
      await expect(page.getByTestId('attach-editor-idle')).toBeVisible()
      await expect(thumb).toHaveCount(1)
      const newImg = thumb.locator('img')
      await expect.poll(() => newImg.evaluate(img => img.naturalWidth), { timeout: 10_000 }).toBe(320)
      const newSrc = await newImg.getAttribute('src')
      expect(newSrc !== null && newSrc !== oldSrc).toBe(true)

      const edited = await page.evaluate(async (src) => {
        const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer())
        const image = new Image()
        image.src = src
        await image.decode()
        const probe = document.createElement('canvas')
        probe.width = image.naturalWidth
        probe.height = image.naturalHeight
        const ctx = probe.getContext('2d')
        if (ctx === null) return null
        ctx.drawImage(image, 0, 0)
        const pixel = ctx.getImageData(160, 100, 1, 1).data
        let hash = 0
        bytes.forEach(byte => { hash = (hash * 31 + byte) % 2147483647 })
        return {
          size: bytes.length,
          hash,
          signature: Array.from(bytes.subarray(0, 8)),
          width: image.naturalWidth,
          height: image.naturalHeight,
          distance: Math.sqrt((pixel[0] - 229) ** 2 + (pixel[1] - 72) ** 2 + (pixel[2] - 77) ** 2),
        }
      }, newSrc ?? '')
      expect(edited !== null).toBe(true)
      if (edited === null) return
      expect(edited.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(edited.width).toBe(320)
      expect(edited.height).toBe(200)
      expect(edited.hash).not.toBe(fixtureHash(FIXTURE_BYTES))
      expect(edited.distance).toBeLessThan(90)

      // Send with text attached. Honestly assert what the host does with the
      // image on this home's model: the modality gate refuses (`session/
      // attachment-invalid` → the localized Toast) or the request passes the
      // gate and some other prompt outcome surfaces. Whichever happens is what
      // this test records — no faking either branch.
      await page.locator('[data-composer-card] [contenteditable="true"]').click()
      await page.keyboard.type('annotate check')
      await page.keyboard.press('Enter')

      const refusal = page.getByRole('alert').getByText(/does not support images|不支持图片/)
      const deadline = Date.now() + 10_000
      let refused = false
      let cleared = false
      let alerts: string[] = []
      for (;;) {
        refused = await refusal.count() > 0
        cleared = await page.getByTestId('attach-editor-thumb').count() === 0
        alerts = await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"]')).map(el => el.textContent ?? ''))
        if (refused || cleared || alerts.length > 0) break
        if (Date.now() > deadline) break
        await page.waitForTimeout(250)
      }
      expect(refused || cleared || alerts.length > 0, `sending the image produced no observable host response; alerts: ${JSON.stringify(alerts)}`).toBe(true)
      // A modality refusal keeps the draft intact (the prompt never ran); the
      // rail still shows the annotated attachment.
      if (refused) await expect(thumb).toHaveCount(1)

      expect(errors().filter(text => /missed the module table/.test(text))).toEqual([])
      expect(await page.getByText('Failed to load plugins').count()).toBe(0)
    })

    // Load the app on this home (cookie, first-run dialogs), connect a workspace
    // when the home is still session-less, then expand the collapsed rightbar.
    async function openRightbar(page: Page): Promise<void> {
      const url = handle?.url ?? ''
      if (cookie !== null) {
        const [cookieName, cookieValue] = cookie.split('=')
        await page.context().addCookies([{ name: cookieName ?? '', value: cookieValue ?? '', url }])
      }
      await page.goto(url)
      await dismissIfVisible(page, 'Preview Notice', 'Continue')
      await dismissIfVisible(page, 'Add an API key to get started', 'Configure later')
      // A session-less home shows the workspace chooser (fresh) or a "New
      // session" button (registered workspace); an open session shows the
      // rightbar expand button (collapsed) or the open rightbar. The states are
      // mutually exclusive, so race for whichever appears first.
      const chooser = page.getByRole('textbox', { name: 'Choose workspace' })
      const newSession = page.getByRole('button', { name: 'New session' }).first()
      const expand = page.locator('[data-sidebar-right-expand]')
      const open = page.locator('[data-sidebar-right-open]')
      await Promise.race([
        chooser.waitFor({ state: 'visible', timeout: 30_000 }),
        newSession.waitFor({ state: 'visible', timeout: 30_000 }),
        expand.waitFor({ state: 'visible', timeout: 30_000 }),
        open.waitFor({ state: 'visible', timeout: 30_000 }),
      ]).catch(() => null)
      const preview = page.getByRole('dialog', { name: 'Preview Notice' })
      const apiKey = page.getByRole('dialog', { name: 'Add an API key to get started' })
      if (await chooser.isVisible()) {
        // The native picker resolves through the `zenity` shim; the returned
        // path registers the workspace and opens a session. The first-run
        // dialogs can appear just after the dismiss window and mask the
        // chooser, so retry the click, dismissing whichever dialog is on
        // screen until the chooser takes it.
        const deadline = Date.now() + 30_000
        for (;;) {
          await dismissIfVisible(page, 'Preview Notice', 'Continue')
          await dismissIfVisible(page, 'Add an API key to get started', 'Configure later')
          if (await chooser.click({ timeout: 2_000 }).then(() => true).catch(() => false)) break
          if (Date.now() > deadline) throw new Error('the workspace chooser never became clickable')
        }
      } else if (await newSession.isVisible()) {
        await newSession.click()
      }
      // A freshly live session re-triggers the onboarding dialogs after the
      // workspace registers (later than any fixed dismiss window), and their
      // modal masks block the expand button. Poll for whichever surface shows
      // up first: dismiss the dialogs whenever they appear, expand once a
      // rightbar control is on screen.
      const deadline = Date.now() + 30_000
      for (;;) {
        const rightbar = await Promise.race([
          expand.waitFor({ state: 'visible', timeout: 1_000 }).then(() => true),
          open.waitFor({ state: 'visible', timeout: 1_000 }).then(() => true),
          apiKey.waitFor({ state: 'visible', timeout: 1_000 }).then(() => false),
          preview.waitFor({ state: 'visible', timeout: 1_000 }).then(() => false),
        ]).catch(() => null)
        if (rightbar === true) break
        await dismissIfVisible(page, 'Add an API key to get started', 'Configure later')
        await dismissIfVisible(page, 'Preview Notice', 'Continue')
        if (Date.now() > deadline) throw new Error('neither the rightbar nor an onboarding dialog appeared within the settle window')
      }
      if (await expand.isVisible()) await expand.click()
    }
  })
}

// A first-run dialog appears only on a fresh home and may not reappear on later
// loads; dismiss it only when present within a short window. The button click is
// bounded — the Preview Notice "Continue" stays disabled while its acknowledgement
// saves, and an unbounded click would wait on the stale element past the test.
async function dismissIfVisible(page: Page, dialogName: string, button: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: dialogName })
  if (!(await dialog.isVisible({ timeout: 3_000 }).catch(() => false))) return
  await dialog.getByRole('button', { name: button }).click({ timeout: 5_000 }).catch(() => undefined)
}

/** The live editor canvas pixel at its center, as a distance from #E5484D. */
async function canvasPixelDistance(page: Page, box: { readonly width: number; readonly height: number }): Promise<number> {
  return page.evaluate(([w, h]) => {
    const canvas = document.querySelector('[data-testid="editor-canvas"]') as HTMLCanvasElement | null
    const ctx = canvas?.getContext('2d')
    if (canvas === null || ctx === null) return 10_000
    const dpr = window.devicePixelRatio
    const pixel = ctx.getImageData(Math.round((w / 2) * dpr), Math.round((h / 2) * dpr), 1, 1).data
    return Math.sqrt((pixel[0] - 229) ** 2 + (pixel[1] - 72) ** 2 + (pixel[2] - 77) ** 2)
  }, [box.width, box.height])
}

/** A byte hash shared with the in-page probe, so the saved bytes differ from the fixture. */
function fixtureHash(bytes: Buffer): number {
  let hash = 0
  bytes.forEach(byte => { hash = (hash * 31 + byte) % 2147483647 })
  return hash
}

/** A hand-encoded 320x200 RGB PNG (filter-0 scanlines, zlib-deflated IDAT). */
function png320x200(): Buffer {
  const width = 320
  const height = 200
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0 // filter "None" per scanline
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3
      raw[i] = 45 + Math.round(x * 0.1) // blue→green gradient, non-trivial pixels
      raw[i + 1] = 120 + Math.round(y * 0.4)
      raw[i + 2] = 140
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 0)
  return Buffer.concat([length, Buffer.from(type), data, checksum])
}

function crc32(data: Buffer): number {
  const table = crc32Table()
  let crc = 0xffffffff
  data.forEach(byte => {
    const entry = table[(crc ^ byte) & 0xff] ?? 0
    crc = (crc >>> 8) ^ entry
  })
  // PNG stores the CRC-32 final complement; omitting it makes Chromium reject the file.
  return (crc ^ 0xffffffff) >>> 0
}

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let value = n
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[n] = value
  }
  return table
}
