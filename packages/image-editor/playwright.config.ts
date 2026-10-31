// Playwright config for the editor's acceptance e2e suite.
// No webServer block and no baseURL: pages are started by the test itself over
// http (ES modules do not load over file://). Browsers come from the shared
// ~/.cache/ms-playwright cache (chromium build 1234) — never `playwright install`.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// The package is ESM ("type": "module"), so Playwright loads this config as ESM
// and __dirname is unavailable; this is the cwd-independent equivalent.
const packageDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Top-level outputDir keeps artifacts and .last-run.json under the git-ignored
  // .tmp/ dir instead of a test-results/ next to package.json.
  outputDir: path.join(packageDir, '..', '..', '.tmp', 'playwright', 'image-editor'),
  use: {
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
