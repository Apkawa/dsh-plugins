import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { launchPluginTestHome, trackConsoleErrors } from '@root/tests-helpers/e2e/live.ts'
import { E2E_DSH_VERSIONS } from '@root/tests-helpers/e2e/dsh.ts'

// Version matrix: this lane asserts the client bundle imports and the Model
// settings section renders on a keyless home, once per pinned version.
// Playwright has no test.describe.each, so the matrix is a loop of describe
// blocks over E2E_DSH_VERSIONS. The 0.2.0-rc.2 host RPC bug (rpc-host
// register() reads webServer off a context whose fiber chain lacks the
// service, so the channel route never mounts) is worked around plugin-side:
// the plugin mounts its own /model-settings prefix route via a nested
// webServer inject and serves the 0.2.0 client-request wire itself; covered
// by the vitest RPC lane (tests/e2e/server/model-settings.test.ts).
for (const version of E2E_DSH_VERSIONS) {
  test.describe(`model-settings "Model settings" section on dsh ${version}`, () => {
    test(`dsh ${version}: keyless smoke shows the Model settings section`, async ({ page }) => {
      // Provisioning a version is a slow path, so the test gets a generous timeout.
      test.setTimeout(180_000)
      let home: { url: string; cookie: string | null; stop: () => Promise<void> } | undefined
      try {
        home = await launchPluginTestHome('dsh-model-settings', version)
        const errors = trackConsoleErrors(page)

        // `home.url` is always plain (the core resolves the session cookie for
        // 0.2.0 internally); when one was minted, the browser must present it.
        if (home.cookie !== null) {
          const [cookieName, cookieValue] = home.cookie.split('=')
          await page.context().addCookies([{ name: cookieName ?? '', value: cookieValue ?? '', url: home.url }])
        }
        await page.goto(home.url)

        // First-run dialogs on the 0.2.0-rc.2 fresh home, in order: a "Preview
        // Notice" dialog, then — once dismissed — an "Add an API key to get started"
        // dialog. Each dialog's mask intercepts pointer events until dismissed.
        await dismissIfVisible(page.getByRole('dialog', { name: 'Preview Notice' }), 'Continue')
        await dismissIfVisible(page.getByRole('dialog', { name: 'Add an API key to get started' }), 'Configure later')
        // On dsh 0.2.1-rc.5 the same onboarding dialog is named "Get started"
        // (buttons "Add API Key" / "Sign in") and is dismissed via "Close".
        await dismissIfVisible(page.getByRole('dialog', { name: 'Get started' }), 'Close')

        // A client bundle that misses the module table surfaces as a console/page
        // error right after load.
        expect(errors().filter(text => /missed the module table/.test(text))).toEqual([])

        // An import failure would replace the whole GUI with this error screen.
        expect(await page.getByText('Failed to load plugins').count()).toBe(0)

        // Settings navigation is version-dependent, so the path is probed rather
        // than assumed. 0.2.0-rc.2 exposes a sidebar "Settings" button. On
        // 0.2.1-rc.5 that button is gone — the sidebar exposes Plugins,
        // Automation tasks and More — and settings live behind the "Account menu"
        // popover's "Settings" menuitem, which opens an unnamed settings dialog
        // whose nav buttons are General / Models / "Model settings" / Built-in
        // plugins / Agent presets / Close. A URL route is not an option on rc.5
        // (`/settings` serves an empty body; the app stays at `/`), so both
        // versions are reached by role.
        await openSettings(page)
        // The plugin-injected section: a nav button in both versions' settings
        // page, distinct from the built-in 'Models' entry.
        await page.getByRole('button', { name: 'Model settings' }).click()

        // Keyless empty state. The row's CSS class is a build hash, so match on text.
        await expect(page.getByText('No OpenAI-compatible routes configured.')).toBeVisible()

        // The plugin client must be registered in the boot manifest.
        const boot = await page.evaluate(() => (window as unknown as { __DSH_BOOT__: DshBoot }).__DSH_BOOT__)
        expect(boot.entries.some(entry => entry.id === '@apkawa/dsh-model-settings')).toBe(true)

        // The keyless 0.2.0-rc.2 home is console-clean (confirmed by the green run).
        expect(errors()).toEqual([])
      } finally {
        // Guaranteed cleanup: a throwing body must still stop the spawned `dsh web`
        // and remove the temp root, or the child leaks its port and .tmp/dsh-e2e-*.
        await home?.stop()
      }
    })
  })
}

// A first-run dialog appears only on a fresh home and may not reappear on later
// loads; dismiss it only when present within a short window.
async function dismissIfVisible(dialog: Locator, button: string): Promise<void> {
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null)
  if (!(await dialog.isVisible())) return
  await dialog.getByRole('button', { name: button }).click()
}

// Open the settings page on either matrix version: 0.2.0-rc.2 has a sidebar
// "Settings" button, 0.2.1-rc.5 reaches the same page through the "Account menu"
// popover's "Settings" menuitem. Counted, not waited on, so the older shape wins
// whenever it is present and the rc.5 fallback never times out on rc.2.
async function openSettings(page: Page): Promise<void> {
  const settingsButton = page.getByRole('button', { name: 'Settings' }).first()
  if (await settingsButton.count() > 0) {
    await settingsButton.click()
    return
  }
  await page.getByRole('button', { name: 'Account menu' }).first().click()
  await page.getByRole('menuitem', { name: 'Settings' }).first().click()
}

// Shape of window.__DSH_BOOT__ on 0.2.0-rc.2 (WebBootGraph: a graph rev, entries
// with id/url/rev, and combo-script batches); read via page.evaluate.
interface DshBoot {
  rev: string
  entries: Array<{ id: string; url: string; rev: string }>
  batches: Array<{ phase: string; url: string; rev: string; entries: string[] }>
}
