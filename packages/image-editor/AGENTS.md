# image-editor

Standalone image annotation editor: plain TypeScript + canvas. Zero runtime
dependencies and zero imports from dsh or React — it ships as a self-contained
browser bundle, so it must never gain `dependencies` or Cordis/dsh seams.

Public API and MVP limits: [README.md](./README.md).

## Layout

- `src/` — editor source; `src/index.ts` is the public API entry (`mountImageEditor`
  + the pure scene/tool/transform/hit/undo/view/export modules). Types are
  emitted by `tsc` into `lib/` (the `exports` target).
- `dist/` — browser bundles built by `tsdown` (ESM, all modules bundled,
  nothing external, no module-loader envelope): `editor.js` (library entry)
  and `dev.js` (the demo page entry), plus the shared chunk they import.
- `tests/unit/` — vitest suites (`*.test.ts`, node env — the pure modules are
  tested headless, DOM behavior goes to playwright).
- `tests/e2e/` — playwright suites (`*.spec.ts`): `editor.spec.ts` (annotate,
  undo, zoom, resize, save), `tools.spec.ts` (per-tool gestures, presets,
  transforms), and `select.spec.ts` (selection set: rubber band, moving and
  deleting several shapes at once, handles for a lone selection), all driving
  the dev page through the shared static http server in `tests/e2e/serve.ts`:
  ES modules do not load over `file://`, and without vite the page's `./dev.ts`
  is raw TypeScript, so that server rewrites it to
  `/dist/dev.js` (the built bundle) and serves only `/` → `dev/index.html` plus
  paths under `dev/` + `dist/`.
- `dev/` — manual demo page: `index.html` + `dev/dev.ts` (mount via file
  picker, paste, or `?src=<url>`; exposes `window.__editorState()` and
  `window.__lastExport`). `index.html` loads `./dev.ts` as a source module —
  vite compiles it; the page is served raw outside vite and needs the rewrite.

## Commands (run from this package dir)

- `pnpm build` — `tsc -p tsconfig.json && tsdown` → `lib/` + `dist/editor.js`
- `pnpm typecheck` — `tsc -p tsconfig.json --noEmit`
- `pnpm test` — `vitest run`
- `pnpm test:e2e` — builds first (`pretest:e2e`) so the bundle the lane drives
  matches `src/`, then `playwright test` (chromium headless, single worker;
  browsers come from the shared `~/.cache/ms-playwright` cache — never run
  `playwright install`)
- `pnpm start` — `vite` dev server rooted at `dev/`, so
  `http://127.0.0.1:5173/` is the demo page and opens directly; it serves
  `dev/dev.ts` from source, so edits under `src/` reload the page with no
  rebuild (`server.fs.allow` covers `../src`). vite is dev-only
  (`vite.config.ts`, catalog ref) and never enters `dependencies`

## Constraints

- The dev/demo page must be served over http: ES modules do not load over
  `file://`.
- Playwright artifacts go to `.tmp/playwright/image-editor` (config `outputDir`);
  all temp state stays under repo-root `.tmp/`, caches under `.cache/`.
- Install rule: never `pnpm add` — edit `package.json` (catalog refs only) and
  run `pnpm install` from the repo root.
- TDD exception for the playwright lane: e2e acceptance specs are NOT written
  red-first. Unit tests follow red → green as usual; `tests/e2e/*.spec.ts` are
  written/retuned AFTER the implementation lands, so the lane runs green in one
  pass (a deliberately-failing e2e wait is wasted time — the user verifies the
  final visuals by hand anyway).
