import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@root/tests-helpers': fileURLToPath(new URL('../../tests-helpers', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
