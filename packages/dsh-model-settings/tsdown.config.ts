import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** The plugin id (the package name) — registered with the client module loader. */
const PLUGIN_ID = '@apkawa/dsh-model-settings'

/** Module specifiers the dsh web shell shares into its frozen module table (union of the 0.1.1-rc.2 and 0.1.2-rc.1 seed lists). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

function isExternal(source: string): boolean {
  return (PLATFORM_MODULES as readonly string[]).includes(source)
}

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const require = createRequire(import.meta.url)

/** Resolve a css import to a physical file (relative paths against the importer). */
function resolveCssFile(source: string, importer: string | undefined): string {
  if (!source.startsWith('.')) return require.resolve(source)
  if (importer === undefined) throw new Error(`cannot resolve relative css "${source}" without an importer`)
  return resolvePath(dirname(importer), source)
}

/** Inject a <style> tag for one css asset at factory execution. */
function styleTagModule(css: string, tagId: string): string {
  return [
    `const css = ${JSON.stringify(css)};`,
    `if (typeof document !== 'undefined' && document.querySelector(${JSON.stringify(`style[data-plugin-css="${tagId}"]`)}) === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    `  tag.dataset.pluginCss = ${JSON.stringify(tagId)};`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
  ].join('\n')
}

// The browser half only: the Host modules are emitted by `tsc -p tsconfig.json`
// into lib/, so this config must not clean the directory. CSS Modules compile
// via lightningcss into auto-injected <style data-plugin> tags (vendored from
// the dsh-stickers reference config).
export default defineConfig({
  entry: { client: './src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  // Bundle my own modules; keep only the loader module-table entries external.
  noExternal: (id: string) => (isExternal(id) ? undefined : true),
  plugins: [{
    name: 'dsh-css-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css')) return null
      const abs = resolveCssFile(source, importer)
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const tagId = `${PLUGIN_ID}/${basename(fileId)}`
      if (!fileId.endsWith('.module.css')) return styleTagModule(source.toString(), tagId) + '\nexport default css;'
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: `[hash]_[local]` },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
      return styleTagModule(code.toString(), tagId) + `\nexport default ${JSON.stringify(classMap)};`
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    // Dual-version store fallback: on 0.1.2-rc.1 the store is a static platform
    // seed (answered directly); on 0.1.1-rc.2 the seed word is unknown to the
    // loader, which throws synchronously, so the wrapper falls back to the old
    // parser-preloaded runtime specifier. Every other specifier routes through
    // the original `require` unchanged.
    banner: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      'var __nq = require;',
      'var require = function (spec) {',
      "  if (spec === '@deepseek-ai/dsh-client-store') {",
      "    try { return __nq(spec) } catch { return __nq('@deepseek-ai/dsh-client-runtime/client') }",
      '  }',
      '  return __nq(spec)',
      '};',
    ].join('\n'),
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
