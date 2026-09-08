import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { launchPluginTestHome, trackConsoleErrors } from '../../../../tests-helpers/e2e/live.ts'

// Keyless smoke on dsh 0.1.1-rc.2: the plugin's Model settings section renders its
// empty state, its client registers in the boot manifest, and nothing errors console-side.
test('keyless smoke shows the Model settings empty state', async ({ page }) => {
  const home = await launchPluginTestHome('dsh-model-settings')
  const errors = trackConsoleErrors(page)
  try {
    // 0.1.1-rc.2 prints a tokenless ready URL; use it as-is.
    await page.goto(home.url)

    // First-run dialogs, in order.
    await dismissIfVisible(page.getByRole('dialog', { name: 'Internal Testing Notice' }))
    await expect(page.getByRole('dialog', { name: 'Add an API key to get started' })).toBeVisible()
    await page.getByRole('button', { name: 'Configure later' }).click()

    await page.getByRole('button', { name: 'Settings' }).click()
    // The plugin-injected tab: distinct from the built-in 'Models' nav item.
    await page.getByRole('button', { name: 'Model settings' }).click()

    // Keyless empty state. The row's CSS class is a build hash, so match on text.
    await expect(page.getByText('No OpenAI-compatible routes configured.')).toBeVisible()

    // The plugin client must be registered in the boot manifest.
    const boot = (await page.evaluate(() => window.__DSH_BOOT__)) as DshBoot
    expect(boot.entries.some(entry => entry.id === '@apkawa/dsh-model-settings')).toBe(true)

    // Zero console error/warning messages and zero page errors.
    expect(errors()).toEqual([])
  } finally {
    // Guaranteed cleanup: a throwing body must still stop the spawned `dsh web`
    // and remove the temp root, or the child leaks its port and .tmp/dsh-e2e-*.
    await home.stop()
  }
})

// The Internal Testing Notice only appears on a fresh home and may not reappear on later
// loads; dismiss it only when present within a short window.
async function dismissIfVisible(dialog: Locator): Promise<void> {
  await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null)
  if (!(await dialog.isVisible())) return
  await dialog.getByRole('button', { name: 'Continue' }).click()
}

// Shape of window.__DSH_BOOT__ (read via page.evaluate; not typed on Window here).
interface DshBoot {
  rev: string
  entries: Array<{ id: string; url: string }>
}
