import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@root/tests-helpers': fileURLToPath(new URL('../../tests-helpers', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    // Version provisioning in boot hooks takes up to 180 s; tests share that budget.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
