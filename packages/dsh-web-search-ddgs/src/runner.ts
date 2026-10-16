import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Log } from '@apkawa/utils'

const logger = new Log('web-search-ddgs')

/** ddgs result item as emitted by `ddgs-search.py`. */
export interface DdgsItem {
  href: string
  title?: string
  body?: string
}

export interface RunnerResult {
  items: DdgsItem[]
}

export interface SearchParams {
  query: string
  backend: string
  maxResults: number
  /** Host-side cancellation (forwarded from the WebSearchProvider signal). */
  signal?: AbortSignal | undefined
}

export interface RunnerOptions {
  venvDir: string
  ddgsVersion: string
  scriptPath: string
  /** Per-search subprocess timeout, ms. */
  timeoutMs: number
}

/** Injected process launcher; the default wraps child_process.spawn. */
export type Spawner = (cmd: string, args: string[], options: { signal?: AbortSignal }) => Promise<{ code: number; stdout: string; stderr: string }>

export interface DdgsRunner {
  search(params: SearchParams): Promise<RunnerResult>
}

/** ddgs per-engine request timeout, seconds (the script's outer budget is timeoutMs). */
const DDGS_TIMEOUT_SEC = 10

/** The ddgs-search.py shipped at the package root (one level above lib/ or src/). */
export const DEFAULT_SCRIPT_PATH = fileURLToPath(new URL('../ddgs-search.py', import.meta.url))

export function createRunner(options: RunnerOptions, spawner: Spawner = runCommand): DdgsRunner {
  let ready: Promise<void> | undefined
  const venvPython = () => join(options.venvDir, 'bin', 'python')

  function ensureVenv(): Promise<void> {
    if (!ready) ready = setupVenv().catch(error => {
      ready = undefined
      throw error
    })
    return ready
  }

  async function setupVenv(): Promise<void> {
    if (!existsSync(venvPython())) {
      logger.log('venv missing, provisioning:', options.venvDir)
      await uv('venv', [options.venvDir])
      await uv('pip', ['install', '-p', options.venvDir, options.ddgsVersion])
      return
    }
    if (!existsSync(join(options.venvDir, 'bin', 'ddgs'))) {
      logger.log('ddgs missing, installing:', options.ddgsVersion)
      await uv('pip', ['install', '-p', options.venvDir, options.ddgsVersion])
      return
    }
    logger.log('venv ready:', options.venvDir)
  }

  async function uv(args0: string, rest: string[]): Promise<void> {
    logger.log('uv:', [args0, ...rest].join(' '))
    const outcome = await spawner('uv', [args0, ...rest], {})
    if (outcome.code !== 0) throw new Error(`uv ${args0} failed: ${outcome.stderr.trim() || outcome.stdout.trim() || `exit ${outcome.code}`}`)
  }

  return {
    async search(params: SearchParams): Promise<RunnerResult> {
      await ensureVenv()
      let timedOut = false
      const controller = new AbortController()
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, options.timeoutMs)
      const onCallerAbort = () => controller.abort()
      params.signal?.addEventListener('abort', onCallerAbort)
      logger.log('spawn:', venvPython(), options.scriptPath, 'timeout:', options.timeoutMs, 'ms')
      const outcome = await spawner(venvPython(), [
        options.scriptPath,
        '--query', params.query,
        '--backend', params.backend,
        '--max-results', String(params.maxResults),
        '--timeout', String(DDGS_TIMEOUT_SEC),
      ], { signal: controller.signal })
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', onCallerAbort)
      if (timedOut) throw new Error(`ddgs search timed out after ${options.timeoutMs}ms`)
      if (params.signal?.aborted) throw new Error('ddgs search aborted')
      if (outcome.code !== 0) throw new Error(`ddgs exited with code ${outcome.code}: ${outcome.stderr.trim() || outcome.stdout.trim()}`)
      return { items: parseItems(outcome.stdout) }
    },
  }
}

function runCommand(cmd: string, args: string[], options: { signal?: AbortSignal }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal: options.signal, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', error => reject(error))
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

function parseItems(stdout: string): DdgsItem[] {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new Error(`ddgs returned malformed JSON: ${stdout.slice(0, 200)}`)
  }
  if (!Array.isArray(raw)) throw new Error('expected a JSON array of search items')
  return raw.map(normalizeItem)
}

function normalizeItem(entry: unknown): DdgsItem {
  if (typeof entry !== 'object' || entry === null) throw new Error('expected an object search item')
  const record = entry as Record<string, unknown>
  if (typeof record.href !== 'string' || record.href.length === 0) throw new Error('expected a string href on the search item')
  const item: DdgsItem = { href: record.href }
  if (typeof record.title === 'string' && record.title !== '') item.title = record.title
  if (typeof record.body === 'string' && record.body !== '') item.body = record.body
  return item
}
