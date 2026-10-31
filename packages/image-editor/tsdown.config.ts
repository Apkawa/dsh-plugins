// Standalone browser bundles: everything from src/ is bundled into dist/editor.js,
// nothing is external, and there is no dsh module-loader envelope — the bundle
// is loaded directly by a page served over http. dist/dev.js is the same code
// plus the dev page wiring, not part of the public API. Types come from `tsc`
// (lib/), so dts stays off here; dist/ is owned by tsdown alone.
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { editor: './src/index.ts', dev: './dev/dev.ts' },
  outDir: 'dist',
  format: 'esm',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  external: [],
})
