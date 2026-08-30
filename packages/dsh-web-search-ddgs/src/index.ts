import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

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
  /** ddgs search backend (default: yandex — the only one reachable on the author's whitelist). */
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

export function apply(_ctx: Context, _config: Config): void {
  // The provider registration lands with the DdgsSearchProvider stage.
}
