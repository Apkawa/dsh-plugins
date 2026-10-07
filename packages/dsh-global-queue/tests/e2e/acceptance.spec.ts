import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { trackConsoleErrors } from '@root/tests-helpers/e2e/live.ts'
import { E2E_DSH_VERSIONS, launchDsh, stopDsh } from '@root/tests-helpers/e2e/dsh.ts'
import type { DshHandle } from '@root/tests-helpers/e2e/dsh.ts'
import { MODEL_ID, ROUTE_ID, writeSettings } from '@root/tests-helpers/e2e/dsh-fixture.ts'

// Acceptance lane for the "Show queue" right-sidebar tab. One live `dsh web`
// per version: the home is provisioned once in beforeAll per version, and each
// test seeds its queue items — over the /global-queue channel (the live
// watcher then picks them up), or by a direct atomic write of the queue file
// (the event-driven watcher never sees a file write, so the fixture keeps the
// written status) — and removes them again; failures must come from the
// tab/pane behavior, never from the lane mechanics (launch, cookie,
// workspace, seeding).
//
// DOM hooks the implementation must provide (tab kind registered under the
// sidebar.right.pane.tab slot with the title "Show queue"):
//   [data-sidebar-right-expand]        framework: conversation header, expands the rightbar
//   role="tab", name "Show queue"      framework: dockkit tab chip
//   [data-testid="global-queue-pane"]  plugin: tab body root
//   [data-testid="global-queue-row"]   plugin: one row per item in file order,
//                                      [data-item-id=<id>] set per row
//   [data-testid="global-queue-status"] plugin: status label (raw status text,
//                                      one of queued | running | done |
//                                      interrupted — the live watcher may have
//                                      already picked up a seeded item)
//   [data-testid="global-queue-edit"]   plugin: the multi-line edit textarea
//                                      replacing the item text in edit mode
//                                      (entered by double-clicking the text or
//                                      the Edit button, queued items only); it
//                                      auto-grows with its content, Save
//                                      commits, Cancel/Escape discard, and
//                                      Enter and blur do NOT commit
//   role="button", name "Edit"         plugin: per-row edit icon button (queued
//                                      items only), left of the remove button;
//                                      one inline svg, no text label
//   role="button", name "Cancel"/"Save" plugin: the edit-mode action buttons
//   role="button", name "Remove"       plugin: per-row remove icon button;
//                                      one inline svg, no text label
//   [data-testid="global-queue-stats"] plugin: compact stats line (finished items)
//   [data-testid="global-queue-open"]  plugin: the open-session link — the
//                                      workspace's display name (its path's
//                                      last segment) with the workspace
//                                      list's folder icon, in the caption
//                                      tone (12/18 tertiary, underline on
//                                      hover only); shown whenever the item
//                                      has a workspace name, dimmed and
//                                      inert (aria-disabled) until the item
//                                      has a session
//   [data-testid="global-queue-drag"]  plugin: the ⋮⋮ drag handle — the ONLY
//                                      drag source ([draggable]; the row
//                                      itself is not draggable); the drop
//                                      target is the WHOLE row (dragover/drop
//                                      on the row div)
//   in-flight drag states (style-driven, no testids): the receiving row
//                                      frees — a dashed l3 outline with its
//                                      content cleared (layout preserved, no
//                                      list jump) — and the carried row's
//                                      origin dims
//
// DOM hooks for the "Add to queue" composer control (the button registers
// under the conversation.input.right slot, session scope — it receives the
// current session id, the workspace path, the draft text, and the session's
// blank signal from the slot context):
//   [data-testid="global-queue-add"]  plugin: "Add to queue" button in the
//                                      composer's right control area; one
//                                      click queues the draft — the target
//                                      session is derived from the session's
//                                      blank signal (blank → targetSessionId
//                                      null, non-blank → the on-screen
//                                      session id) and the composer is
//                                      cleared
//   empty draft                        plugin: clicking the button adds
//                                      nothing (no RPC) and leaves the button
//                                      visible and clickable
//   [data-composer-input]              framework: the composer draft
//                                      contenteditable (Lexical; role
//                                      textbox, aria-multiline)
//   [data-conversation-session]        framework: the chat content div; the
//                                      attribute value is the current session
//                                      id
//
// DOM hooks for the Start (guide) page, shown when no tab is open:
//   [data-sidebar-right-guide]         framework: the Start page body
//   [data-sidebar-right-guide-entry="global-queue"]
//                                       framework: the guide entry capsule
//                                       contributed by the tab type's guide
//                                       registration
const WORKSPACE = path.join(fileURLToPath(new URL('../../../..', import.meta.url)), '.tmp', 'queue-e2e-workspace')

// The shared launcher boots a plain `dsh web` (no in-page picker overlay), so
// the workspace picker on a headless host is the native backend, which shells
// out to `zenity` — absent in this sandbox. `dsh.ts` spawns the server with the
// test process's env, so a `zenity` shim first on PATH answers the native
// picker with the workspace path; the click flow then runs end to end.
const SHIM_DIR = path.join(fileURLToPath(new URL('../../../..', import.meta.url)), '.tmp', 'queue-e2e-shims')
mkdirSync(SHIM_DIR, { recursive: true })
const shimPath = path.join(SHIM_DIR, 'zenity')
writeFileSync(shimPath, `#!/bin/sh\necho "${WORKSPACE}"\n`)
chmodSync(shimPath, 0o755)
process.env.PATH = `${SHIM_DIR}:${process.env.PATH}`

// A file-wide timeout: provisioning happens in beforeAll (180 s there), and the
// per-test page load + workspace connect + tab lookup needs headroom beyond the
// 30 s config default while the tab is still absent.
test.setTimeout(60_000)

let rpcSeq = 0
let fileSeq = 0

// Playwright has no test.describe.each; the version matrix is a loop of
// describe blocks over the pinned version list.
for (const version of E2E_DSH_VERSIONS) {
  test.describe(`global-queue "Show queue" tab on dsh ${version}`, () => {
    let handle: DshHandle | undefined
    let port: number
    let cookie: string | null

    test.beforeAll(async () => {
      handle = await launchDsh({ packageName: 'dsh-global-queue', keyless: true, port: 0, version })
      port = Number(new URL(handle.url).port)
      cookie = handle.cookie
      mkdirSync(WORKSPACE, { recursive: true })
    }, 180_000)

    test.afterAll(async () => {
      // Guaranteed cleanup: a throwing suite must still stop the spawned `dsh web`
      // and remove the temp root, or the child leaks its port and .tmp/dsh-e2e-*.
      if (handle !== undefined) await stopDsh(handle)
    })

    test('tab opens: the Show queue tab is visible in the right sidebar and opens the pane', async ({ page }) => {
      await clearQueue()
      const errors = trackConsoleErrors(page)
      await openRightbar(page)
      const tab = page.getByRole('tab', { name: 'Show queue' })
      await expect(tab).toBeVisible()
      await tab.click()
      await expect(page.getByTestId('global-queue-pane')).toBeVisible()

      // Lane sanity: the client bundle is loaded and the plugin is registered.
      expect(errors().filter(text => /missed the module table/.test(text))).toEqual([])
      expect(await page.getByText('Failed to load plugins').count()).toBe(0)
      const boot = await page.evaluate(() => (window as unknown as { __DSH_BOOT__: DshBoot }).__DSH_BOOT__)
      expect(boot.entries.some(entry => entry.id === '@apkawa/dsh-global-queue')).toBe(true)
    })

    test('list renders: both seeded items are visible in file order', async ({ page }) => {
      await clearQueue()
      await seed('queue row alpha')
      await seed('queue row beta')
      await openRightbar(page)
      await openQueueTab(page)
      const rows = page.getByTestId('global-queue-pane').getByTestId('global-queue-row')
      await expect(rows.nth(0).getByText('queue row alpha', { exact: true })).toBeVisible()
      await expect(rows.nth(1).getByText('queue row beta', { exact: true })).toBeVisible()
    })

    test('drag-and-drop: dragging row 2 onto row 1 moves it first', async ({ page }) => {
      await clearQueue()
      const sourceId = await seed('drag source item')
      const targetId = await seed('drag target item')
      await openRightbar(page)
      await openQueueTab(page)
      const rows = page.getByTestId('global-queue-pane').getByTestId('global-queue-row')
      // Only the ⋮⋮ handle is draggable; the row itself is not.
      expect(await rows.nth(0).getAttribute('draggable')).toBeNull()
      expect(await rows.nth(1).getAttribute('draggable')).toBeNull()
      const sourceHandle = rows.nth(1).getByTestId('global-queue-drag')
      expect(await sourceHandle.getAttribute('draggable')).toBe('true')
      const sourceRow = page.locator(`[data-item-id="${sourceId}"]`)
      const targetRow = page.locator(`[data-item-id="${targetId}"]`)
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
      await sourceHandle.dispatchEvent('dragstart', { dataTransfer })
      // The drop target is the whole row: dragover + drop land on the target
      // row, not on its handle.
      await targetRow.dispatchEvent('dragover', { dataTransfer })
      // In-flight states: the receiving slot frees (dashed outline, content
      // cleared) and the carried row's origin dims.
      expect(await targetRow.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('dashed')
      expect(await targetRow.evaluate(el => getComputedStyle(el.firstElementChild as Element).opacity)).toBe('0')
      expect(await sourceRow.evaluate(el => getComputedStyle(el).opacity)).toBe('0.4')
      await targetRow.dispatchEvent('drop', { dataTransfer })
      // dragend fires on the source handle after the completed drop and
      // resets both in-flight states.
      await sourceHandle.dispatchEvent('dragend', { dataTransfer })
      expect(await targetRow.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none')
      expect(await sourceRow.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
      await expect(rows.nth(0).getByText('drag target item', { exact: true })).toBeVisible()
      await expect(rows.nth(1).getByText('drag source item', { exact: true })).toBeVisible()
    })

    test('text edit: double-clicking the item text opens a multi-line edit field that grows with its content', async ({ page }) => {
      await clearQueue()
      seedFileItem('editable draft', 'queued')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.getByTestId('global-queue-pane').getByTestId('global-queue-row')
      await row.getByText('editable draft', { exact: true }).dblclick()
      const edit = row.getByTestId('global-queue-edit')
      await expect(edit).toBeVisible()
      // The edit field is the multi-line textarea, not the old single-line input.
      expect(await edit.evaluate(el => el.tagName.toLowerCase())).toBe('textarea')
      // The field auto-grows with multi-line content (its floor is the 32px min).
      const singleLine = await edit.evaluate(el => el.offsetHeight)
      await edit.fill('line one\nline two\nline three')
      const grown = await edit.evaluate(el => el.offsetHeight)
      expect(grown).toBeGreaterThan(singleLine)
    })

    test('text edit: the Edit button opens the edit field and Save commits the new text', async ({ page }) => {
      await clearQueue()
      seedFileItem('editable draft', 'queued')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.getByTestId('global-queue-pane').getByTestId('global-queue-row')
      await row.getByRole('button', { name: 'Edit' }).click()
      const edit = row.getByTestId('global-queue-edit')
      await expect(edit).toBeVisible()
      await edit.fill('edited draft text')
      await row.getByRole('button', { name: 'Save' }).click()
      await expect(edit).toHaveCount(0)
      await expect(row.getByText('edited draft text', { exact: true })).toBeVisible()
    })

    test('text edit: Cancel discards the draft', async ({ page }) => {
      await clearQueue()
      seedFileItem('editable draft', 'queued')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.getByTestId('global-queue-pane').getByTestId('global-queue-row')
      await row.getByText('editable draft', { exact: true }).dblclick()
      const edit = row.getByTestId('global-queue-edit')
      await expect(edit).toBeVisible()
      await edit.fill('discarded draft text')
      await row.getByRole('button', { name: 'Cancel' }).click()
      await expect(edit).toHaveCount(0)
      await expect(row.getByText('editable draft', { exact: true })).toBeVisible()
    })

    test('text edit: Enter and blur do not commit the draft', async ({ page }) => {
      await clearQueue()
      seedFileItem('editable draft', 'queued')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.getByTestId('global-queue-pane').getByTestId('global-queue-row')
      await row.getByText('editable draft', { exact: true }).dblclick()
      const edit = row.getByTestId('global-queue-edit')
      await expect(edit).toBeVisible()
      await edit.fill('uncommitted text')
      // Enter does not commit: the channel still lists the original text.
      await edit.press('Enter')
      expect((await listItems()).map(item => item.text)).toEqual(['editable draft'])
      // A click away (blur) does not commit either.
      await row.click({ position: { x: 4, y: 4 } })
      expect((await listItems()).map(item => item.text)).toEqual(['editable draft'])
    })

    test('edit gate: only queued rows offer the edit affordance', async ({ page }) => {
      await clearQueue()
      const queuedId = seedFileItem('queued gate row', 'queued')
      const doneId = seedFileItem('done gate row', 'done')
      await openRightbar(page)
      await openQueueTab(page)
      // The queued row offers the Edit button; the non-queued row renders none.
      const queuedRow = page.locator(`[data-item-id="${queuedId}"]`)
      await expect(queuedRow.getByRole('button', { name: 'Edit' })).toBeVisible()
      const doneRow = page.locator(`[data-item-id="${doneId}"]`)
      await expect(doneRow.getByRole('button', { name: 'Edit' })).toHaveCount(0)
      // Double-clicking the non-queued row's text does not enter edit mode.
      await doneRow.getByText('done gate row', { exact: true }).dblclick()
      await expect(doneRow.getByTestId('global-queue-edit')).toHaveCount(0)
      await expect(doneRow.getByText('done gate row', { exact: true })).toBeVisible()
    })

    test('remove: clicking the remove button deletes the row', async ({ page }) => {
      await clearQueue()
      const id = await seed('removable item')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.locator(`[data-item-id="${id}"]`)
      await row.getByRole('button', { name: 'Remove' }).click()
      await expect(page.locator(`[data-item-id="${id}"]`)).toHaveCount(0)
    })

    test('status: a freshly added item shows a status label with a valid status', async ({ page }) => {
      await clearQueue()
      const id = await seed('status probe item')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.locator(`[data-item-id="${id}"]`)
      const status = row.getByTestId('global-queue-status')
      await expect(status).toBeVisible()
      // The live watcher may already have picked up the freshly seeded item
      // (free local model), so the status races between the four valid values;
      // assert membership, not a fixed value.
      expect(['queued', 'running', 'done', 'interrupted']).toContain((await status.textContent()) ?? '')
    })

    test('pane restyle: rows are hairline-separated items with settings typography and a ghost remove control', async ({ page }) => {
      await clearQueue()
      const id = await seed('styled row probe')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.locator(`[data-item-id="${id}"]`)
      await expect(row).toBeVisible()
      // Geometry and color read from the live theme: every color is compared
      // against a token probe, so the assertions hold in light and dark alike
      // without a hardcoded theme RGB.
      const style = await row.evaluate(el => {
        const probe = (token: string) => {
          const div = document.createElement('div')
          div.style.color = `var(${token})`
          document.body.appendChild(div)
          const value = getComputedStyle(div).color
          div.remove()
          return value
        }
        const statusTokens: Record<string, string> = {
          queued: '--dsw-alias-label-secondary',
          running: '--dsw-alias-state-warn-label',
          done: '--dsw-alias-state-success-primary',
          interrupted: '--dsw-alias-state-error-primary',
        }
        const rowStyle = getComputedStyle(el)
        const title = getComputedStyle(el.querySelector('span') as Element)
        const status = el.querySelector('[data-testid="global-queue-status"]') as HTMLElement
        const statusStyle = getComputedStyle(status)
        const statusText = (status.textContent ?? '').trim()
        const remove = getComputedStyle(el.querySelector('[data-testid="global-queue-remove"]') as Element)
        return {
          borderBottomStyle: rowStyle.borderBottomStyle,
          borderBottomColor: rowStyle.borderBottomColor,
          borderL2: probe('--dsw-alias-border-l2'),
          titleFontSize: title.fontSize,
          titleLineHeight: title.lineHeight,
          statusText,
          statusFontSize: statusStyle.fontSize,
          statusLineHeight: statusStyle.lineHeight,
          statusColor: statusStyle.color,
          statusToken: probe(statusTokens[statusText] ?? '--dsw-alias-label-primary'),
          removeHeight: remove.height,
          removeRadius: remove.borderTopLeftRadius,
          removeBackground: remove.backgroundColor,
        }
      })
      // The hairline row separator resolves through the theme alias token.
      expect(style.borderBottomStyle).toBe('solid')
      expect(style.borderBottomColor).toBe(style.borderL2)
      // 14/22 title, 12/18 caption, the dense geometry of the settings rows.
      expect(style.titleFontSize).toBe('14px')
      expect(style.titleLineHeight).toBe('22px')
      expect(style.statusFontSize).toBe('12px')
      expect(style.statusLineHeight).toBe('18px')
      // The status label reads in the state token family of its meaning.
      expect(['queued', 'running', 'done', 'interrupted']).toContain(style.statusText)
      expect(style.statusColor).toBe(style.statusToken)
      // The remove control is the ghost sm capsule: h28, 14px corners, no fill.
      expect(style.removeHeight).toBe('28px')
      expect(style.removeRadius).toBe('14px')
      expect(style.removeBackground).toBe('rgba(0, 0, 0, 0)')
    })

    test('pane restyle: the remove and edit buttons are icon buttons', async ({ page }) => {
      await clearQueue()
      // A file-seeded `queued` item stays in the editable state the watcher
      // never touches, so both icon buttons render (Edit is the queued gate).
      const id = seedFileItem('icon button probe', 'queued')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.locator(`[data-item-id="${id}"]`)
      await expect(row).toBeVisible()
      // The accessible names resolve to the per-row icon buttons.
      const remove = row.getByRole('button', { name: 'Remove' })
      const edit = row.getByRole('button', { name: 'Edit' })
      expect(await remove.getAttribute('data-testid')).toBe('global-queue-remove')
      expect(await edit.getAttribute('data-testid')).toBe('global-queue-edit-button')
      // Each button carries exactly one inline svg and no text label.
      await expect(remove.locator('svg')).toHaveCount(1)
      await expect(edit.locator('svg')).toHaveCount(1)
      expect((await remove.textContent()) ?? '').toBe('')
      expect((await edit.textContent()) ?? '').toBe('')
      // The remove keeps the h28 geometry (radius and transparency are probed
      // in the row restyle test above).
      expect(await remove.evaluate(el => getComputedStyle(el).height)).toBe('28px')
    })

    test('pane restyle: the edit field is an auto-growing textarea', async ({ page }) => {
      await clearQueue()
      // A file-seeded `queued` item: the watcher never sees a file write, so
      // the row stays in the editable state the double-click gate requires.
      const id = seedFileItem('styled edit probe', 'queued')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.locator(`[data-item-id="${id}"]`)
      await expect(row).toBeVisible()
      // The inline edit field: the auto-growing textarea with the token border.
      await row.getByText('styled edit probe', { exact: true }).dblclick()
      const edit = row.getByTestId('global-queue-edit')
      await expect(edit).toBeVisible()
      const editStyle = await edit.evaluate(field => {
        const computed = getComputedStyle(field)
        const probe = document.createElement('div')
        probe.style.borderTopColor = 'var(--dsw-alias-border-l2)'
        document.body.appendChild(probe)
        const token = getComputedStyle(probe).borderTopColor
        probe.remove()
        return {
          tag: field.tagName.toLowerCase(),
          height: field.offsetHeight,
          minHeight: computed.minHeight,
          maxHeight: computed.maxHeight,
          radius: computed.borderTopLeftRadius,
          borderStyle: computed.borderTopStyle,
          borderColor: computed.borderTopColor,
          resize: computed.resize,
          token,
        }
      })
      expect(editStyle.tag).toBe('textarea')
      // The field auto-grows from its 32px floor up to the 200px cap, without
      // a manual resize handle.
      expect(editStyle.minHeight).toBe('32px')
      expect(editStyle.maxHeight).toBe('200px')
      expect(editStyle.height).toBeGreaterThanOrEqual(32)
      expect(editStyle.radius).toBe('8px')
      expect(editStyle.borderStyle).toBe('solid')
      expect(editStyle.borderColor).toBe(editStyle.token)
      expect(editStyle.resize).toBe('none')
      // Escape discards the draft and exits edit mode.
      await edit.press('Escape')
      await expect(row.getByText('styled edit probe', { exact: true })).toBeVisible()
    })

    test('pane restyle: the open-session link carries the tertiary caption tone', async ({ page }) => {
      await clearQueue()
      const id = await seed('styled edit probe')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.locator(`[data-item-id="${id}"]`)
      await expect(row).toBeVisible()
      // The link renders as soon as the item has a workspace name; wait for
      // the session so the link is in its enabled state, and the channel
      // poll bounds the wait.
      await waitForSessionId(id)
      const open = row.getByTestId('global-queue-open')
      await expect(open).toBeVisible()
      const openStyle = await open.evaluate(link => {
        const computed = getComputedStyle(link)
        const probe = document.createElement('div')
        probe.style.color = 'var(--dsw-alias-label-tertiary)'
        document.body.appendChild(probe)
        const token = getComputedStyle(probe).color
        probe.remove()
        return {
          fontSize: computed.fontSize,
          lineHeight: computed.lineHeight,
          color: computed.color,
          token,
        }
      })
      expect(openStyle.fontSize).toBe('12px')
      expect(openStyle.lineHeight).toBe('18px')
      expect(openStyle.color).toBe(openStyle.token)
    })

    test('pane restyle: the open-session link shows the workspace name with a folder icon', async ({ page }) => {
      await clearQueue()
      const id = await seed('workspace label probe')
      await openRightbar(page)
      await openQueueTab(page)
      const row = page.locator(`[data-item-id="${id}"]`)
      await expect(row).toBeVisible()
      // The link renders as soon as the item has a workspace name; the
      // channel poll (waiting for the session) bounds the wait.
      await waitForSessionId(id)
      const open = row.getByTestId('global-queue-open')
      await expect(open).toBeVisible()
      // The link shows the workspace's display name (its path's last segment).
      await expect(open).toHaveText('queue-e2e-workspace')
      // The folder glyph: one inline svg, like the workspace list's folder rows.
      await expect(open.locator('svg')).toHaveCount(1)
      // Tone read from the live theme: the 12/18 caption in the tertiary tone.
      const style = await open.evaluate(el => {
        const computed = getComputedStyle(el)
        const probe = document.createElement('div')
        probe.style.color = 'var(--dsw-alias-label-tertiary)'
        document.body.appendChild(probe)
        const token = getComputedStyle(probe).color
        probe.remove()
        return {
          fontSize: computed.fontSize,
          lineHeight: computed.lineHeight,
          color: computed.color,
          token,
        }
      })
      expect(style.fontSize).toBe('12px')
      expect(style.lineHeight).toBe('18px')
      expect(style.color).toBe(style.token)
    })

    test('add control: the "Add to queue" button is visible in the composer of an open session', async ({ page }) => {
      await clearQueue()
      await openRightbar(page)
      // Scoping to the composer card pins the control to the input bar's
      // right control area (the conversation.input.right slot).
      const add = page.locator('[data-composer-card]').getByTestId('global-queue-add')
      // Bounded wait: while the control is unimplemented this is the RED
      // failure point — a clean locator timeout, not the test-level budget.
      await expect(add).toBeVisible({ timeout: 15_000 })
    })

    test('add control: the button is a dense capsule with a leading icon', async ({ page }) => {
      await clearQueue()
      await openRightbar(page)
      const add = page.locator('[data-composer-card]').getByTestId('global-queue-add')
      await expect(add).toBeVisible({ timeout: 15_000 })
      // Geometry and stroke read from the live theme: the border color is
      // compared against a token probe, so the assertion holds in light and
      // dark alike without a hardcoded theme RGB.
      const style = await add.evaluate(button => {
        const computed = getComputedStyle(button)
        const probe = document.createElement('div')
        probe.style.borderTopColor = 'var(--dsw-alias-border-l3)'
        document.body.appendChild(probe)
        const token = getComputedStyle(probe).borderTopColor
        probe.remove()
        return {
          height: computed.height,
          radius: computed.borderTopLeftRadius,
          padding: computed.padding,
          fontSize: computed.fontSize,
          lineHeight: computed.lineHeight,
          borderTopStyle: computed.borderTopStyle,
          borderTopColor: computed.borderTopColor,
          backgroundColor: computed.backgroundColor,
          token,
        }
      })
      // The dense capsule: h28, 14px corners, 0 10px padding, 12/18 text.
      expect(style.height).toBe('28px')
      expect(style.radius).toBe('14px')
      expect(style.padding).toBe('0px 10px')
      expect(style.fontSize).toBe('12px')
      expect(style.lineHeight).toBe('18px')
      expect(style.borderTopStyle).toBe('solid')
      // The outline stroke resolves through the theme alias token.
      expect(style.borderTopColor).toBe(style.token)
      // The rest fill stays transparent; the hover tone is state-only.
      expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
      // One leading icon in the button.
      await expect(add.locator('svg')).toHaveCount(1)
    })

    test('start tab: with all tabs closed, the Start page offers "Show queue" and clicking it opens the pane', async ({ page }) => {
      await clearQueue()
      await openRightbar(page)
      // The open effect auto-mounts the queue page when the sidebar appears;
      // close every chip except Start so the pane shows the guide page with
      // its entry capsules.
      const chips = page.locator('[data-dockkit-tab]')
      for (let i = await chips.count() - 1; i >= 0; i--) {
        const chip = chips.nth(i)
        if ((await chip.textContent()) === 'Start') continue
        const close = chip.locator('[data-dockkit-tab-close]')
        if (await close.count() === 0) continue
        await close.click()
      }
      // Closing the sole docked tab collapses the column; the expansion
      // re-seeds the default page, which is the Start page once the built-in
      // guide entries are registered alongside ours.
      if (await chips.count() === 0) await page.locator('[data-sidebar-right-expand]').click()
      const guide = page.locator('[data-sidebar-right-guide]')
      await expect(guide).toBeVisible({ timeout: 15_000 })
      const entry = guide.locator('[data-sidebar-right-guide-entry="global-queue"]')
      await expect(entry).toBeVisible({ timeout: 15_000 })
      await expect(entry).toContainText('Show queue')
      await entry.click()
      await expect(page.getByTestId('global-queue-pane')).toBeVisible()
    })

    // Declared before the conversation-context test: it runs on the fresh
    // blank session, while that test primes the session and leaves it non-blank.
    test('add control: from a blank session, clicking add queues the draft with no target session and clears the composer', async ({ page }) => {
      await clearQueue()
      await openRightbar(page)
      const draft = page.locator('[data-composer-input]')
      await draft.fill('queue add: blank session draft')
      const add = page.locator('[data-composer-card]').getByTestId('global-queue-add')
      await add.click({ timeout: 15_000 })
      const listed = await listItems()
      expect(listed.filter(item => item.text === 'queue add: blank session draft')).toEqual([
        expect.objectContaining({ targetSessionId: null }),
      ])
      // The add commits and clears the composer field.
      await expect(draft).toHaveText('')
    })

    test('add control: from a session with a conversation, clicking add queues the draft for that session', async ({ page }) => {
      await clearQueue()
      await openRightbar(page)
      const draft = page.locator('[data-composer-input]')
      // The home's preselected model has no API key on a keyless home, so the
      // turn fails — but the session is non-blank from the moment the turn
      // starts (blank clears on running), which is all the add control needs.
      await draft.fill('prime the session')
      await draft.press('Enter')
      await waitForTurnToSettle(page)
      // The live app exposes the current session id on the chat content div.
      const sessionId = (await page.locator('[data-conversation-session]').first().getAttribute('data-conversation-session')) ?? ''
      expect(sessionId).not.toBe('')
      await draft.fill('queue add: current session draft')
      const add = page.locator('[data-composer-card]').getByTestId('global-queue-add')
      await add.click({ timeout: 15_000 })
      const listed = await listItems()
      expect(listed.filter(item => item.text === 'queue add: current session draft')).toEqual([
        expect.objectContaining({ targetSessionId: sessionId }),
      ])
      await expect(draft).toHaveText('')
    })

    test('add control: an empty draft adds nothing and the control stays visible', async ({ page }) => {
      await clearQueue()
      await openRightbar(page)
      const draft = page.locator('[data-composer-input]')
      await expect(draft).toHaveText('')
      const add = page.locator('[data-composer-card]').getByTestId('global-queue-add')
      await add.click({ timeout: 15_000 })
      expect(await listItems()).toEqual([])
      // The no-op leaves the control in place.
      await expect(add).toBeVisible()
    })

    // End-to-end new-session flow with a fake provider: an item queued from a
    // blank session is run by the watcher in a freshly created session, that
    // session is visible in the workspace browser (grouped under its
    // workspace), the pane's "open session" link navigates to it, and the
    // turn's provider failure lands the item in `interrupted`.
    //
    // The fake provider is a hand-declared route on a closed local port,
    // written into the live profile patch the host watches (no model-settings
    // RPC is mounted in this lane, so the settle is observed in the model
    // picker instead of an RPC poll).
    //
    // Model-path note: model selection is per-session. Selecting the fake
    // model in the blank composer does NOT carry over to the watcher-created
    // session, which runs the home's preselected default (keyless on this
    // home). Either way the turn fails — connection-refused for the fake
    // provider, a no-API-key credential failure for the keyless default — so
    // the item lands `interrupted` with the provider failure text (never the
    // `{{model}}` assembly error, which an unbound session model produces)
    // and the essential (a)/(b)/(c)/(d) assertions hold on both paths.
    test('new-session flow: a queued item runs in a created session, is visible in the workspace, and interrupts on provider failure', async ({ page }) => {
      if (handle === undefined) throw new Error('dsh handle is not ready')
      await clearQueue()

      // Wire the fake provider into the live profile patch.
      writeSettings(handle, [
        'llm-pi-ai:',
        '  providers:',
        `    ${ROUTE_ID}:`,
        '      api: openai-completions',
        '      baseURL: http://127.0.0.1:9/v1',
        '      models:',
        `        - id: ${MODEL_ID}`,
      ].join('\n'))

      await openRightbar(page)

      // Settle the fake model into the catalog and select it in the blank
      // composer (per-session; the created session runs the home default).
      await selectModel(page, MODEL_ID)

      // Queue the draft from the blank session (targetSessionId null).
      const draft = page.locator('[data-composer-input]')
      await draft.fill('global queue e2e: new session flow')
      await page.locator('[data-composer-card]').getByTestId('global-queue-add').click({ timeout: 15_000 })

      const listed = await listItems()
      const item = listed.find(entry => entry.text === 'global queue e2e: new session flow')
      if (item === undefined) throw new Error('the queued item is not listed')
      expect(item.targetSessionId).toBe(null)

      // (a) The watcher picks up the item and runs it in a freshly created
      // session. The `running` status itself is transient — a provider-failed
      // turn flips it to `interrupted` within a heartbeat — so the durable
      // proof the item ran is the sessionId the watcher sets exactly when the
      // item reaches `running`.
      const sessionId = await sessionIdOf(item.id)

      // (b) The created session is visible in the workspace browser, grouped
      // under its workspace: some ancestor of the session row (its group
      // section) carries the workspace header row for the same group.
      const sessionRow = page.locator(`[data-row-key="session:${sessionId}"]`)
      await expect(sessionRow).toBeVisible({ timeout: 15_000 })
      const groupedUnderWorkspace = await sessionRow.evaluate((row) => {
        let el: Element | null = row
        for (let i = 0; i < 10 && el !== null; i++) {
          if (el.querySelector('[data-row-key^="workspace:"]') !== null) return true
          el = el.parentElement
        }
        return false
      })
      expect(groupedUnderWorkspace).toBe(true)

      // (b) The pane's "open session" link appears and navigates to the session.
      // The pane re-lists the queue only on mount (it has no server-push
      // subscription), so the watcher-driven queued → running → interrupted
      // transition does not reach it on its own. Re-navigate to remount the
      // pane fresh; its mount-time refresh surfaces the sessionId the watcher
      // assigned.
      await openRightbar(page)
      await openQueueTab(page)
      const open = page.getByTestId('global-queue-pane').getByTestId('global-queue-open')
      await expect(open).toBeVisible({ timeout: 15_000 })
      await open.click()
      await expect(page.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', sessionId, { timeout: 15_000 })

      // (c) The turn fails against the provider; the item interrupts.
      const interrupted = await waitForItemStatus(item.id, 'interrupted')
      expect(interrupted.status).toBe('interrupted')

      // (d) The turn's failure is the provider failure (the keyless home
      // default model), not the `{{model}}` assembly error: without the
      // session's model binding the deployment's `{{model}}` prompt variable
      // resolves empty and the assembly throws. The session is open from step
      // (b); read the turn's failure line from its transcript.
      const turnFailure = page.getByRole('status').filter({ hasText: 'This turn failed' }).first()
      const failureText = (await turnFailure.textContent({ timeout: 15_000 })) ?? ''
      expect(failureText).not.toContain('{{model}}')
      expect(failureText).toMatch(/credential|connection|api key/i)
    })

    // One client-request round-trip over the /global-queue channel on this home.
    async function call<T>(method: string, payload: unknown): Promise<T> {
      const response = await fetch(`http://127.0.0.1:${port}/global-queue/${method}`, {
        method: 'POST',
        headers: cookie === null
          ? { 'content-type': 'application/json' }
          : { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: `acceptance-${++rpcSeq}`, method, payload }),
      })
      const envelope = (await response.json()) as { result: { ok: boolean; value?: T; error?: { code: string; message: string } } }
      if (!envelope.result.ok) throw new Error(envelope.result.error.message)
      return envelope.result.value as T
    }

    async function seed(text: string): Promise<string> {
      const added = await call<{ item: { id: string } }>('add', { text, workspacePath: WORKSPACE, targetSessionId: null })
      return added.item.id
    }

    // Seeds an item by writing the queue file directly (atomic rename, the
    // store's own commit style): the RPC lane has no status endpoint (the
    // watcher alone sets statuses), and the event-driven watcher never sees a
    // file write, so the fixture keeps exactly the status written — a `done`
    // row for the gate, and a stable `queued` row the watcher will not pick up.
    function seedFileItem(text: string, status: 'queued' | 'done' | 'interrupted'): string {
      if (handle === undefined) throw new Error('dsh handle is not ready')
      const queueFile = path.join(handle.root, '.dsh', '.global-queue.json')
      const items = existsSync(queueFile)
        ? (JSON.parse(readFileSync(queueFile, 'utf8')) as Array<Record<string, unknown>>)
        : []
      const now = Date.now()
      const id = `e2e-${status}-${++fileSeq}`
      items.push({
        id,
        text,
        workspacePath: WORKSPACE,
        targetSessionId: null,
        status,
        createdAt: now,
        updatedAt: now,
      })
      const temp = `${queueFile}.e2e-tmp`
      writeFileSync(temp, `${JSON.stringify(items, undefined, 2)}\n`)
      renameSync(temp, queueFile)
      return id
    }

    // Remove every queued item so no state leaks between tests.
    async function clearQueue(): Promise<void> {
      const listed = await call<{ items: Array<{ id: string }> }>('list', {})
      for (const item of listed.items) await call('remove', { id: item.id })
    }

    async function listItems(): Promise<Array<{ text: string; targetSessionId: string | null }>> {
      const listed = await call<{ items: Array<{ text: string; targetSessionId: string | null }> }>('list', {})
      return listed.items
    }

    // The watcher attaches a session to a queued item; poll the channel until
    // the item carries a sessionId (the open-session link renders then).
    async function waitForSessionId(id: string): Promise<void> {
      const deadline = Date.now() + 30_000
      for (;;) {
        const listed = await call<{ items: Array<{ id: string; sessionId?: string }> }>('list', {})
        if (listed.items.find(item => item.id === id)?.sessionId !== undefined) return
        if (Date.now() > deadline) throw new Error('the item never received a sessionId')
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }

    // Poll the channel until the item reaches `status`; return the item.
    async function waitForItemStatus(id: string, status: string): Promise<{ id: string; status: string; sessionId?: string }> {
      const deadline = Date.now() + 30_000
      for (;;) {
        const listed = await call<{ items: Array<{ id: string; status: string; sessionId?: string }> }>('list', {})
        const item = listed.items.find(entry => entry.id === id)
        if (item !== undefined && item.status === status) return item
        if (Date.now() > deadline) throw new Error(`item ${id} never reached status ${status}`)
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }

    // Poll the channel until the item carries a sessionId; return it. The
    // watcher sets the sessionId exactly when the item reaches `running`, so a
    // sessionId is the durable proof the item ran (the `running` status itself
    // is transient — a provider-failed turn flips it to `interrupted` in a
    // heartbeat).
    async function sessionIdOf(id: string): Promise<string> {
      const deadline = Date.now() + 30_000
      for (;;) {
        const listed = await call<{ items: Array<{ id: string; sessionId?: string }> }>('list', {})
        const sessionId = listed.items.find(entry => entry.id === id)?.sessionId
        if (sessionId !== undefined) return sessionId
        if (Date.now() > deadline) throw new Error(`item ${id} never received a sessionId`)
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }

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
      // A session-less home shows the workspace chooser (fresh) or a
      // "New session" button (registered workspace); an open session shows
      // the rightbar expand button (collapsed) or the open rightbar. The
      // states are mutually exclusive, so race for whichever appears first.
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
      if (await chooser.isVisible()) {
        // The native picker resolves through the `zenity` shim; the returned
        // path registers the workspace and opens a session.
        await chooser.click()
      } else if (await newSession.isVisible()) {
        // Open a session for the registered workspace.
        await newSession.click()
      }
      // A freshly live session re-triggers the API key onboarding dialog.
      await dismissIfVisible(page, 'Add an API key to get started', 'Configure later')
      await Promise.race([
        expand.waitFor({ state: 'visible', timeout: 30_000 }),
        open.waitFor({ state: 'visible', timeout: 30_000 }),
      ]).catch(() => null)
      if (await expand.isVisible()) {
        await expand.click()
      }
    }

    async function openQueueTab(page: Page): Promise<void> {
      // Bounded wait: while the tab is unimplemented this is the RED failure
      // point — a clean locator timeout, not the test-level budget.
      await page.getByRole('tab', { name: 'Show queue' }).click({ timeout: 15_000 })
    }
  })
}

// The prime prompt runs against the home's preselected model, which has no
// API key on a keyless home, so the turn settles as a failure. The session is
// non-blank from the moment the turn starts (the blank bit clears on running
// and on an accepted submission), so a settled turn is a stable non-blank
// session to read the session id from. The visible failure line is the settle
// signal (the terminal status span is a visually-hidden live region).
async function waitForTurnToSettle(page: Page): Promise<void> {
  await expect(page.getByText('This turn failed')).toBeVisible({ timeout: 30_000 })
}

// Settle a model into the catalog and select it in the blank composer: open
// the picker, drill to the model pane (a current model makes the root pane
// first), and poll for the model row — re-opening re-issues the catalog load,
// so the row appears once the host commits the profile patch. Selecting the
// row closes the picker.
async function selectModel(page: Page, modelName: string): Promise<void> {
  const trigger = page.locator('[data-composer-card] button[aria-haspopup="menu"]')
  const deadline = Date.now() + 30_000
  for (;;) {
    await trigger.click()
    const modelCell = page.getByRole('menuitem', { name: /Model/ })
    if (await modelCell.isVisible()) await modelCell.click()
    const row = page.getByRole('menuitemradio', { name: modelName })
    if (await row.isVisible()) {
      await row.click()
      return
    }
    await trigger.click()
    if (Date.now() > deadline) throw new Error(`model ${modelName} did not appear in the picker within the settle window`)
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
}

// A first-run dialog appears only on a fresh home and may not reappear on later
// loads; dismiss it only when present within a short window.
async function dismissIfVisible(page: Page, dialogName: string, button: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: dialogName })
  // The dialogs render right after load on a fresh home; a short window keeps
  // the restored-session loads (tests after the first) from stalling.
  await dialog.waitFor({ state: 'visible', timeout: 3000 }).catch(() => null)
  if (!(await dialog.isVisible())) return
  await dialog.getByRole('button', { name: button }).click()
}

// Shape of window.__DSH_BOOT__ on 0.2.0-rc.2 (WebBootGraph: a graph rev, entries
// with id/url/rev, and combo-script batches); read via page.evaluate.
interface DshBoot {
  rev: string
  entries: Array<{ id: string; url: string; rev: string }>
  batches: Array<{ phase: string; url: string; rev: string; entries: string[] }>
}
