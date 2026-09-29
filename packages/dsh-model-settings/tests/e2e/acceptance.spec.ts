import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { launchPluginTestHome, trackConsoleErrors } from '@root/tests-helpers/e2e/live.ts'
import { E2E_DSH_VERSIONS } from '@root/tests-helpers/e2e/dsh.ts'

// Version matrix: 0.1.2-rc.1 is now covered for the plugin client import
// failure — its client bundle fails to import the client runtime ("missed the
// module table") and the whole GUI renders the full-screen "Failed to load
// plugins" error screen. That iteration's assertions are scoped to the import
// failure only; the separate known 0.1.2-rc.1 host bug (405 on in-session
// `POST /model-settings/*`, owned by `.dumbspec/current/fix_0.1.2-rc1`) is a
// separate lane — the vitest RPC suite (tests/e2e/server/model-settings.test.ts).
for (const version of E2E_DSH_VERSIONS) {
  test(`dsh ${version}: keyless smoke shows the Model settings section`, async ({ page }) => {
    // Provisioning a version is a slow path, so the test gets a generous timeout.
    test.setTimeout(180_000)
    let home: { url: string; cookie: string | null; stop: () => Promise<void> } | undefined
    try {
      home = await launchPluginTestHome('dsh-model-settings', version)
      const errors = trackConsoleErrors(page)

      // `home.url` is always plain (the core resolves the session cookie for
      // 0.1.2+ internally); when one was minted, the browser must present it.
      if (home.cookie !== null) {
        const [cookieName, cookieValue] = home.cookie.split('=')
        await page.context().addCookies([{ name: cookieName ?? '', value: cookieValue ?? '', url: home.url }])
      }
      await page.goto(home.url)

      // First-run dialogs, in order — dismiss only when present on the home.
      await dismissIfVisible(page.getByRole('dialog', { name: 'Internal Testing Notice' }), 'Continue')
      if (version === '0.1.1-rc.2') {
        // Fresh 0.1.1-rc.2 homes always present the API-key dialog.
        await expect(page.getByRole('dialog', { name: 'Add an API key to get started' })).toBeVisible()
      }
      await dismissIfVisible(page.getByRole('dialog', { name: 'Add an API key to get started' }), 'Configure later')

      // The import failure (if any) surfaces as a console/pageerror right after
      // load; on 0.1.2-rc.1 this is the red signal for this lane. Scoped to that
      // error: a separate known 0.1.2-rc.1 host bug (RPC 405) may add unrelated
      // console errors and must not fail this iteration.
      expect(errors().filter(text => /missed the module table/.test(text))).toEqual([])

      // The 0.1.2-rc.1 import failure replaces the whole GUI with this error
      // screen; asserting its absence is the other red signal for that version.
      expect(await page.getByText('Failed to load plugins').count()).toBe(0)

      await page.getByRole('button', { name: 'Settings' }).click()
      // The plugin-injected tab: distinct from the built-in 'Models' nav item.
      await page.getByRole('button', { name: 'Model settings' }).click()

      // Keyless empty state. The row's CSS class is a build hash, so match on text.
      await expect(page.getByText('No OpenAI-compatible routes configured.')).toBeVisible()

      // The plugin client must be registered in the boot manifest.
      const boot = await page.evaluate(() => (window as unknown as { __DSH_BOOT__: DshBoot }).__DSH_BOOT__)
      expect(boot.entries.some(entry => entry.id === '@apkawa/dsh-model-settings')).toBe(true)

      if (version === '0.1.1-rc.2') {
        // Zero console error/warning messages and zero page errors.
        expect(errors()).toEqual([])
      }
    } finally {
      // Guaranteed cleanup: a throwing body must still stop the spawned `dsh web`
      // and remove the temp root, or the child leaks its port and .tmp/dsh-e2e-*.
      await home?.stop()
    }
  })
}

// A first-run dialog appears only on a fresh home and may not reappear on later
// loads; dismiss it only when present within a short window.
async function dismissIfVisible(dialog: Locator, button: string): Promise<void> {
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null)
  if (!(await dialog.isVisible())) return
  await dialog.getByRole('button', { name: button }).click()
}

// Shape of window.__DSH_BOOT__ (read via page.evaluate; not typed on Window here).
interface DshBoot {
  rev: string
  entries: Array<{ id: string; url: string }>
}
