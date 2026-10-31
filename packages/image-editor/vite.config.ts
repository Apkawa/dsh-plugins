import path from 'node:path'
import { defineConfig } from 'vite'

// Rooted at dev/, so `/` is the demo page and `pnpm start` opens it directly. The page loads
// ./dev.ts, which vite transforms from source — editing a module under src/ reloads the page,
// no build step first. Those modules sit above the root, so the package dir is allowed through
// vite's fs guard. Paths are cwd-relative: vite runs from this package dir (`pnpm start`), and
// its config loader bundles the file elsewhere, so import.meta.dirname would not point here.
// vite stays a dev-only dependency; the editor itself is dependency-free.
const packageDir = process.cwd()

export default defineConfig({
  root: path.join(packageDir, 'dev'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: { allow: [packageDir] },
    open: '/',
  },
})
