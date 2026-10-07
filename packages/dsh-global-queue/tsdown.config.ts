import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** The plugin id (the package name) — registered with the client module loader. */
const PLUGIN_ID = '@apkawa/dsh-global-queue'

/** Module specifiers the dsh web shell shares into its frozen module table (the 0.2.0-rc.2 `PLATFORM_MODULES` seed list, `packages/client/web/src/platform.ts`). */
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
    entryFileNames: 'client/index.js',
    // The 0.2.0-rc.2 module table statically seeds every external specifier, so
    // the factory's `require` answers each one directly.
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
