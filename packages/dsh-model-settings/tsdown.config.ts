import { defineConfig } from 'tsdown'

// Stage 0: the client entry is a placeholder; stage 4 turns this into the
// lazy-CJS factory bundle that dsh's web runner loads for the settings card.
export default defineConfig({
  entry: { client: './src/client/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'browser',
  target: 'es2024',
  dts: true,
  // tsc already emitted the Host modules into lib/; do not wipe them.
  clean: false,
})
