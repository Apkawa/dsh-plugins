import { defineConfig } from 'tsdown'

/** The plugin id (the package name) — registered with the client module loader. */
const PLUGIN_ID = '@apkawa/dsh-model-settings'

/** Module specifiers the dsh web shell shares into its frozen module table. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Externals resolved from the loader module table: platform seeds + runtime store exemption. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

function isExternal(source: string): boolean {
  return (CLIENT_EXTERNALS as readonly string[]).includes(source)
}

// The browser half only: the Host modules are emitted by `tsc -p tsconfig.json`
// into lib/, so this config must not clean the directory.
export default defineConfig({
  entry: { client: './src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  // Bundle my own modules; keep only the loader module-table entries external.
  noExternal: (id: string) => (isExternal(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
