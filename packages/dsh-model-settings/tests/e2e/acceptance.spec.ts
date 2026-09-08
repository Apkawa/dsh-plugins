import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { launchPluginTestHome, trackConsoleErrors } from '@root/tests-helpers/e2e/live.ts'

// Pinned dsh version for this lane: 0.1.2-rc.1 returns 405 on in-session
// `POST /model-settings/*` (host plugin apply-ordering, owned by
// `.dumbspec/current/fix_0.1.2-rc1`), and the plugin client fires that RPC on
// page load — the 405 can surface as a console error and fail an otherwise
// clean run. The version matrix for this lane will follow that fix.
const VERSION = '0.1.1-rc.2'

let home: { url: string; stop: () => Promise<void> } | undefined

// Provisioning a version is a slow path, so the hooks get generous timeouts.
// Playwright's beforeAll/afterAll take a title (not a timeout) as their second
// argument — `test.setTimeout` inside the hook sets that hook's own timeout.
test.beforeAll(async () => {
  test.setTimeout(180_000)
  home = await launchPluginTestHome('dsh-model-settings', VERSION)
})

test.afterAll(async () => {
  test.setTimeout(60_000)
  if (home === undefined) return
  // Guaranteed cleanup: a throwing body must still stop the spawned `dsh web`
  // and remove the temp root, or the child leaks its port and .tmp/dsh-e2e-*.
  await home.stop()
})

// Keyless smoke on dsh 0.1.1-rc.2: the plugin's Model settings section renders its
// empty state, its client registers in the boot manifest, and nothing errors console-side.
test('keyless smoke shows the Model settings empty state', async ({ page }) => {
  const errors = trackConsoleErrors(page)

  // The core strips any token and resolves the session cookie internally (0.1.2+),
  // so `home.url` is always plain; on the pinned 0.1.1-rc.2 that URL is
  // tokenless, so the browser navigates to it as-is.
  await page.goto(home!.url)

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
  const boot = await page.evaluate(() => (window as unknown as { __DSH_BOOT__: DshBoot }).__DSH_BOOT__)
  expect(boot.entries.some(entry => entry.id === '@apkawa/dsh-model-settings')).toBe(true)

  // Zero console error/warning messages and zero page errors.
  expect(errors()).toEqual([])
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
