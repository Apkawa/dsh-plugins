import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import { dbg } from './log.ts'
import { DdgsSearchProvider, DEFAULT_BACKEND, DEFAULT_MAX_RESULTS, DEFAULT_TIMEOUT_MS, PROVIDER_ID } from './provider.ts'
import { createRunner, DEFAULT_SCRIPT_PATH } from './runner.ts'

export const name = 'web-search-ddgs'

/** This plugin needs the dsh web seam to register its search provider. */
export const inject = ['web']

export interface Config {
  backend?: string
  maxResults?: number
  timeoutMs?: number
  venvDir?: string
  ddgsVersion?: string
}

export const Config: z<Config> = z.object({
  /** ddgs search backend (default: duckduckgo). */
  backend: z.string(),
  /** Max sources per query (default: 8, matching dsh's web_search tool default). */
  maxResults: z.number().step(1).min(1),
  /** Per-search subprocess timeout, ms (default: 30000). */
  timeoutMs: z.number().min(1000),
  /** Managed uv venv directory (default: ~/.cache/dsh-web-search-ddgs/venv). */
  venvDir: z.string(),
  /** ddgs version pin for the managed venv (default: ddgs = latest). */
  ddgsVersion: z.string(),
})

/** Default managed-venv location (POSIX). */
export const DEFAULT_VENV_DIR = join(homedir(), '.cache', 'dsh-web-search-ddgs', 'venv')

export function apply(ctx: Context, config: Config): void {
  const venvDir = config.venvDir ?? DEFAULT_VENV_DIR
  dbg.log('apply: backend:', config.backend ?? DEFAULT_BACKEND,
    'maxResults:', config.maxResults ?? DEFAULT_MAX_RESULTS,
    'timeoutMs:', config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'venvDir:', venvDir, 'ddgsVersion:', config.ddgsVersion ?? 'ddgs')
  const runner = createRunner({
    venvDir,
    ddgsVersion: config.ddgsVersion ?? 'ddgs',
    scriptPath: DEFAULT_SCRIPT_PATH,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })
  ctx.web.registerSearchProvider(new DdgsSearchProvider({
    runner,
    venvDir,
    backend: config.backend ?? DEFAULT_BACKEND,
    maxResults: config.maxResults ?? DEFAULT_MAX_RESULTS,
  }))
  dbg.log('registered search provider:', PROVIDER_ID)
}
