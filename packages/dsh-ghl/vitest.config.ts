import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Runtime-only for tests: the primitives package is a dsh platform seed
      // (resolved by the web shell's module table), not a devDependency. The
      // provisioned 0.2.0-rc.2 tree is host-only (no client deps installed),
      // so point at the dsh checkout's package, whose node_modules are fully
      // linked (its lib build exports StateDot, the only import we need).
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(
        new URL(
          '../../../../source/deepseek-harness/packages/client/ui-primitives',
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
})
