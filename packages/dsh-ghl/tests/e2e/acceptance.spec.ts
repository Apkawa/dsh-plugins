import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { trackConsoleErrors } from '@root/tests-helpers/e2e/live.ts'
import { E2E_DSH_VERSIONS, launchDsh, stopDsh } from '@root/tests-helpers/e2e/dsh.ts'
import type { DshHandle } from '@root/tests-helpers/e2e/dsh.ts'

// Acceptance lane for the "Issues" right-sidebar tab. One live `dsh web` per
// version: the home is provisioned once in beforeAll, then the test expands the
// rightbar and opens the tab. The launcher boots `dsh web` with a throwaway
// home as its CWD, which sits inside this repository's working tree; beforeAll
// `git init`s it into a fresh repository with no origin so `detectRepo`
// resolves null and the pane must render its no-repo state — a structural/state
// assertion, no live network. Failures must come from the tab/pane behavior,
// never from the lane mechanics (launch, cookie, workspace, rightbar).
//
// DOM hooks the implementation must provide (the tab type registers under the
// sidebar.right.pane.tab slot with the title "Issues" and a guide entry that
// opens it from the Start page):
//   [data-sidebar-right-expand]     framework: conversation header, expands the rightbar
//   [data-sidebar-right-guide-entry="ghl"]  framework: the Start page's entry box
//                                             that opens the "Issues" tab
//   role="tab", name "Issues"       framework: dockkit tab chip (once opened)
//   [data-testid="ghl-pane"]        plugin: tab body root
//   [data-testid="ghl-missing-repo"]  plugin: the missing-repo empty state
//                                    (shown when the detected repo is null)
//
// The shared launcher boots a plain `dsh web` (no in-page picker overlay), so
// the workspace picker on a headless host is the native backend, which shells
// out to `zenity` — absent in this sandbox. `dsh.ts` spawns the server with the
// test process's env, so a `zenity` shim first on PATH answers the native
// picker with the workspace path; the connect flow then opens a session and the
// rightbar (and its tabs) become available.
const WORKSPACE = path.join(fileURLToPath(new URL('../../../..', import.meta.url)), '.tmp', 'ghl-e2e-workspace')
const SHIM_DIR = path.join(fileURLToPath(new URL('../../../..', import.meta.url)), '.tmp', 'ghl-e2e-shims')
mkdirSync(SHIM_DIR, { recursive: true })
const shimPath = path.join(SHIM_DIR, 'zenity')
writeFileSync(shimPath, `#!/bin/sh\necho "${WORKSPACE}"\n`)
chmodSync(shimPath, 0o755)
process.env.PATH = `${SHIM_DIR}:${process.env.PATH}`

// A file-wide timeout: provisioning happens in beforeAll (180 s there), and the
// per-test page load + workspace connect + rightbar expand + tab lookup needs
// headroom beyond the 30 s config default.
test.setTimeout(60_000)

// Playwright has no test.describe.each; the version matrix is a loop of
// describe blocks over the pinned version list.
for (const version of E2E_DSH_VERSIONS) {
  test.describe(`ghl "Issues" tab on dsh ${version}`, () => {
    let handle: DshHandle | undefined
    let cookie: string | null

    test.beforeAll(async () => {
      handle = await launchDsh({ packageName: 'dsh-ghl', keyless: true, port: 0, version })
      cookie = handle.cookie
      // The throwaway home sits inside this repository's working tree; git init
      // makes it a fresh repository with no origin, so `detectRepo` resolves
      // null and the pane renders its no-repo state (no live network). The
      // client's `refresh` runs when the browser loads (after this), so the
      // initialized CWD is what the Host's git detection reads.
      spawnSync('git', ['init', '--quiet'], { cwd: handle.root })
      mkdirSync(WORKSPACE, { recursive: true })
    }, 180_000)

    test.afterAll(async () => {
      // Guaranteed cleanup: a throwing suite must still stop the spawned `dsh web`
      // and remove the temp root, or the child leaks its port and .tmp/dsh-e2e-*.
      if (handle !== undefined) await stopDsh(handle)
    })

    test('Issues tab opens: the pane renders the no-repo state with no console errors', async ({ page }) => {
      const errors = trackConsoleErrors(page)
      await openRightbar(page)
      // The expanded rightbar shows the Start page (the guide); open the
      // "Issues" tab through its entry box, which replaces the guide and
      // selects the tab.
      const guideEntry = page.locator('[data-sidebar-right-guide-entry="ghl"]')
      await expect(guideEntry).toBeVisible()
      await guideEntry.click()
      const tab = page.getByRole('tab', { name: 'Issues' })
      await expect(tab).toBeVisible()
      await expect(page.getByTestId('ghl-pane')).toBeVisible()
      // The throwaway CWD is not a GitHub repo, so the pane shows missing-repo.
      await expect(page.getByTestId('ghl-missing-repo')).toBeVisible()

      // Lane sanity: the client bundle is loaded and the plugin is registered.
      expect(errors().filter(text => /missed the module table/.test(text))).toEqual([])
      expect(await page.getByText('Failed to load plugins').count()).toBe(0)
      const boot = await page.evaluate(() => (window as unknown as { __DSH_BOOT__: DshBoot }).__DSH_BOOT__)
      expect(boot.entries.some(entry => entry.id === '@apkawa/dsh-ghl')).toBe(true)
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
  })
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
