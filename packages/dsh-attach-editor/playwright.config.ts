// Playwright config for the acceptance e2e suite.
// The dsh instance is spawned by the test itself (no webServer block, no baseURL);
// browsers come from the shared ~/.cache/ms-playwright cache (default chromium build).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// The package is ESM ("type": "module"), so Playwright loads this config as ESM
// and __dirname is unavailable; this is the cwd-independent equivalent.
const packageDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir: './tests/e2e',
  // Playwright e2e tests use .spec.ts; the pre-existing vitest e2e tests under
  // tests/e2e/server use .test.ts and must stay out of Playwright's collection.
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Top-level outputDir (not use.outputDir): the normalized project setting that
  // governs both test artifacts and the .last-run.json run state — keeps them all
  // under the git-ignored .tmp/ dir instead of a test-results/ next to package.json.
  outputDir: path.join(packageDir, '..', '..', '.tmp', 'playwright', 'attach-editor'),
  use: {
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
