import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { dbg } from './log.ts'
import type { DdgsItem, DdgsRunner, SearchParams } from './runner.ts'

export const PROVIDER_ID = 'ddgs'
export const DEFAULT_BACKEND = 'duckduckgo'
export const DEFAULT_MAX_RESULTS = 8
export const DEFAULT_TIMEOUT_MS = 30000

export interface DdgsSearchProviderOptions {
  runner: DdgsRunner
  venvDir: string
  backend: string
  maxResults: number
}

/**
 * A ddgs-backed `WebSearchProvider`. Searches are serialized through an
 * internal queue: the tool fires up to four queries concurrently, and rapid
 * bursts trip the active backend's rate limits (see research notes).
 */
export class DdgsSearchProvider implements WebSearchProvider {
  readonly id = PROVIDER_ID
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: DdgsSearchProviderOptions) {}

  /** Cheap local check, no network: the venv exists, or uv can provision it. */
  available(): boolean {
    const venvReady = existsSync(join(this.options.venvDir, 'bin', 'python'))
    const uvOnPath = !venvReady && onPath('uv')
    dbg.log('available:', venvReady || uvOnPath, venvReady ? '(venv ready)' : uvOnPath ? '(uv on PATH)' : '(no venv, no uv)')
    return venvReady || uvOnPath
  }

  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const params: SearchParams = {
      query: request.query,
      backend: this.options.backend,
      maxResults: request.maxResults ?? this.options.maxResults,
      signal,
    }
    dbg.log('search:', params.query, 'backend:', params.backend, 'maxResults:', params.maxResults)
    const task = this.queue.then(() => this.options.runner.search(params))
    this.queue = task.then(() => undefined, () => undefined)
    return task
      .then(result => {
        dbg.log('search ok:', result.items.length, 'items')
        return { sources: toSources(result.items), truncated: false }
      })
  }
}

function toSources(items: readonly DdgsItem[]): WebSearchSource[] {
  return items.map(item => ({
    url: item.href,
    ...item.title !== undefined ? { title: item.title } : {},
    ...item.body !== undefined ? { snippet: item.body } : {},
  }))
}

/** Whether `bin` resolves to an executable on PATH (POSIX colon-separated). */
function onPath(bin: string): boolean {
  const dirs = process.env.PATH?.split(':') ?? []
  return dirs.some(dir => existsSync(join(dir, bin)))
}
