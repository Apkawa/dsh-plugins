/**
 * Vitest e2e fixture — a thin wrapper over the shared launch core
 * (`tests-helpers/e2e/dsh.ts`): `startDsh` is `launchDsh` in an e2e-shaped
 * signature (port defaults to 0 — the core reads the real port from the ready
 * URL) and `stopDsh`/`DshHandle` come straight from the core. The domain
 * helpers below operate on the in-process `DshHandle` the core hands back:
 * RPC over any channel (the client's exact wire shape), warming (seed one
 * model into the instance's settings.yaml and wait for the host to commit),
 * the plugin-linkage check, settings writes, and a local JSON stand-in server.
 */
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchDsh, stopDsh } from './dsh.ts'
import type { DshHandle } from './dsh.ts'

export type { DshHandle }
export { stopDsh }

export const ROUTE_ID = 'e2e'
export const MODEL_ID = 'e2e-model'

const WARMUP_TIMEOUT_MS = 30_000
const POLL_MS = 500

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

/** Seed one model into the instance's settings.yaml and wait for the host to commit it. */
export async function warmModel(handle: DshHandle, routeId: string = ROUTE_ID, modelId: string = MODEL_ID): Promise<void> {
  // baseURL points at a closed local port: any probe the host makes is refused locally
  // and skipped quietly — no internet involved.
  writeFileSync(
    join(handle.root, '.dsh', 'settings.yaml'),
    [
      'llm-pi-ai:',
      '  providers:',
      `    ${routeId}:`,
      '      api: openai-completions',
      '      baseURL: http://127.0.0.1:9/v1',
      '      models:',
      `        - id: ${modelId}`,
      '',
    ].join('\n'),
  )
  const deadline = Date.now() + WARMUP_TIMEOUT_MS
  let committed = false
  while (Date.now() < deadline) {
    const res = await rpc<ModelRow[]>(handle, 'model-settings', 'listModels', {})
    if (res.ok === true && findRow(res.value, routeId, modelId) !== undefined) { committed = true; break }
    await sleep(POLL_MS)
  }
  if (!committed) throw new Error(`host did not commit the settings.yaml edit within ${WARMUP_TIMEOUT_MS / 1000}s`)
}

/** Find a row by (routeId, modelId); undefined when absent. */
export function findRow(rows: readonly ModelRow[] | undefined, routeId: string, modelId: string): ModelRow | undefined {
  return (rows ?? []).find(row => row.routeId === routeId && row.modelId === modelId)
}

/** Replace the instance's settings.yaml (the watcher re-reads on file changes). */
export function writeSettings(handle: DshHandle, yaml: string): void {
  writeFileSync(join(handle.root, '.dsh', 'settings.yaml'), yaml)
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
