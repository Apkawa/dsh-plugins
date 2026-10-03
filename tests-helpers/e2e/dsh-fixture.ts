/**
 * Vitest e2e fixture — a thin wrapper over the shared launch core
 * (`tests-helpers/e2e/dsh.ts`): `startDsh` is `launchDsh` in an e2e-shaped
 * signature (port defaults to 0 — the core reads the real port from the ready
 * URL) and `stopDsh`/`DshHandle` come straight from the core. The domain
 * helpers below operate on in-process `DshHandle`s the core hands back:
 * RPC over arbitrary channels (the client's exact wire shape), warming (seed
 * one model into the instance's web profile patch and wait for the host to
 * commit), plugin linkage checks, settings writes, and a local JSON stand-in
 * server.
 */
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchDsh, stopDsh } from './dsh.ts'
import type { DshHandle } from './dsh.ts'

export type { DshHandle }
export { stopDsh }

export const ROUTE_ID = 'e2e'
export const MODEL_ID = 'e2e-model'

const WARMUP_TIMEOUT_MS = 30_000
const POLL_MS = 500
// The llm adapter entry the settings document projects; composition is id-keyed, last-match-wins.
const LLM_ENTRY_ID = 'llm-pi-ai'

/** A model-settings row as returned by the /model-settings handles. */
export interface ModelRow {
  routeId: string
  modelId: string
  contextWindow?: number | null
  efforts?: Record<string, string>
  input?: string[]
}

interface RpcResult<T> { ok: boolean; value?: T; error?: { code: string; message: string } }

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let rpcSeq = 0

/** Bring up an isolated `dsh web` for `packageName`; port 0 → the core reports the port it actually bound. */
export async function startDsh({ packageName, version, port = 0 }: { packageName: string; version?: string; port?: number }): Promise<DshHandle> {
  return launchDsh({ packageName, port, ...(version === undefined ? {} : { version }) })
}

/** Whether the package's plugin is linked into the instance's `web` profile (`dsh plugin …` forwards to pnpm). */
export function pluginListed(handle: DshHandle): boolean {
  const env = { ...process.env, DSH_HOME: join(handle.root, '.dsh'), DSH_AGENTS_HOME: join(handle.root, '.agents') }
  const result = spawnSync(handle.bin, ['plugin', '--profile', 'web', 'ls'], { cwd: handle.root, env, stdio: 'pipe' })
  return result.stdout?.toString().includes(`@apkawa/${handle.package}`)
}

/** One RPC call into a channel — the client's exact wire shape. */
export async function rpc<T>(handle: DshHandle, channel: string, endpoint: string, payload: unknown): Promise<RpcResult<T>> {
  const rpcId = `e2e-live-checks-${++rpcSeq}`
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/${channel}/${endpoint}`, {
      method: 'POST',
      headers: rpcHeaders(handle),
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
    })
    const envelope = (await res.json()) as { result: RpcResult<T> }
    return envelope.result
  } catch (error) {
    return { ok: false, error: { code: 'transport', message: String(error) } }
  }
}

// Session-required dsh versions 401 without the cookie; keep the header set unchanged when none.
function rpcHeaders(handle: DshHandle) {
  if (handle.cookie === null) return { 'content-type': 'application/json' }
  return { 'content-type': 'application/json', cookie: handle.cookie }
}

/**
 * Seed one model into the instance's web profile patch and wait for the host
 * to commit it. dsh 0.2.0 imports settings.yaml exactly once at boot (then
 * renames it settings.yaml.imported) and never watches it; the live commit
 * path is the profile's cordis.patch.yml, which the host's config watcher
 * reconciles (app-boot/config-reload → settings document revision bump).
 */
export async function warmModel(handle: DshHandle, routeId: string = ROUTE_ID, modelId: string = MODEL_ID): Promise<void> {
  // baseURL points at a closed local port: any probe the host makes is refused locally
  // and skipped quietly — no internet involved.
  upsertLlmEntry(handle, [
    `${LLM_ENTRY_ID}:`,
    '  providers:',
    `    ${routeId}:`,
    '      api: openai-completions',
    '      baseURL: http://127.0.0.1:9/v1',
    '      models:',
    `        - id: ${modelId}`,
  ].join('\n'))
  const deadline = Date.now() + WARMUP_TIMEOUT_MS
  let committed = false
  while (Date.now() < deadline) {
    const res = await rpc<ModelRow[]>(handle, 'model-settings', 'listModels', {})
    if (res.ok === true && findRow(res.value, routeId, modelId) !== undefined) { committed = true; break }
    await sleep(POLL_MS)
  }
  if (!committed) throw new Error(`host did not commit the profile patch edit within ${WARMUP_TIMEOUT_MS / 1000}s`)
}

/** Find a row by (routeId, modelId); undefined when absent. */
export function findRow(rows: readonly ModelRow[] | undefined, routeId: string, modelId: string): ModelRow | undefined {
  return (rows ?? []).find(row => row.routeId === routeId && row.modelId === modelId)
}

/** Replace the llm-pi-ai entry in the web profile patch (the host's config watcher reconciles it live). */
export function writeSettings(handle: DshHandle, yaml: string): void {
  upsertLlmEntry(handle, yaml)
}

// The web profile's patch file: a top-level YAML sequence of { id, config, … }
// entries applied after every bundle layer, watched live by the host.
function patchPath(handle: DshHandle): string {
  return join(handle.root, '.dsh', 'profiles', 'web', 'cordis.patch.yml')
}

// The llm-pi-ai profile-patch entry for one settings section: the section body
// becomes the entry's `config` (the field names the llm adapter reads).
function llmEntryLines(section: string): string[] {
  const lines = section.trimEnd().split('\n')
  return [`- id: ${LLM_ENTRY_ID}`, '  config:', ...lines.slice(1).map(line => line === '' ? '' : `  ${line}`)]
}

// Upsert the llm-pi-ai entry into the web profile patch: replace the matching
// entry or append one, preserving every other entry and the header comments.
// String-level on purpose — the file is machine-written, entries start at column
// 0, and composition is id-keyed last-match-wins, so one well-placed entry suffices.
function upsertLlmEntry(handle: DshHandle, section: string): void {
  const path = patchPath(handle)
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '[]\n'
  const header: string[] = []
  const entries: string[][] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) { entries.push([line]); continue }
    (entries.length === 0 ? header : entries[entries.length - 1]).push(line)
  }
  const entry = llmEntryLines(section)
  const index = entries.findIndex(lines => lines[0]?.startsWith(`- id: ${LLM_ENTRY_ID}`))
  if (index >= 0) entries[index] = entry
  if (index < 0) {
    // The auto-created file is the empty-sequence template; drop its marker and
    // trailing blanks before appending the entry.
    let cut = header.length
    while (cut > 0 && (header[cut - 1] === '' || header[cut - 1].trim() === '[]')) cut -= 1
    header.length = cut
    entries.push(entry)
  }
  writeFileSync(path, [...header, ...entries.flatMap(lines => lines)].join('\n') + '\n')
}

/**
 * A local HTTP server that answers every request with a fixed JSON body — a
 * stand-in for a llama.cpp instance (no internet; 127.0.0.1 only).
 */
export async function startJsonServer(body: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(body)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('json server has no TCP address')
  return { url: `http://127.0.0.1:${address.port}`, stop: () => new Promise(resolve => server.close(() => resolve())) }
}
