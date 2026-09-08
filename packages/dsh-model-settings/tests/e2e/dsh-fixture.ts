/**
 * e2e fixture — drives `scripts/e2e-live.mjs` black-box to bring up an independent
 * `dsh web` on a clean throwaway home, and provides the plumbing to talk to it:
 * RPC over the /model-settings channel (the client's exact wire shape) and warming
 * (seed one model into the instance's settings.yaml and wait for the host to commit).
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const LAUNCHER = join(REPO_ROOT, 'scripts', 'e2e-live.mjs')

export const E2E_PORT = 3091
export const ROUTE_ID = 'e2e'
export const MODEL_ID = 'e2e-model'

const READY_TIMEOUT_MS = 120_000
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

/** A running e2e instance plus the child that owns it (for teardown). */
export interface DshHandle { url: string; port: number; root: string; cookie: string | null; child: ChildProcess }

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let rpcSeq = 0

/** Spawn the launcher and wait for its ready line + temp-root line + session-cookie line. */
export async function startDsh(port: number = E2E_PORT): Promise<DshHandle> {
  const child = spawn('node', [LAUNCHER, '--package', 'dsh-model-settings', '--port', String(port)], { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const readyRe = /dsh e2e instance: (http:\/\/[^\s]+)/
  const rootRe = /temp root: (.+)/
  const cookieRe = /session cookie: (.+)/
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (readyRe.test(stdout) && rootRe.test(stdout) && cookieRe.test(stdout)) break
    if (child.exitCode !== null) throw new Error(`launcher exited early (code ${child.exitCode}); ${stderr.trim() || stdout}`)
    await sleep(POLL_MS)
  }
  const urlMatch = readyRe.exec(stdout)
  const rootMatch = rootRe.exec(stdout)
  const cookieMatch = cookieRe.exec(stdout)
  if (urlMatch === null || rootMatch === null || cookieMatch === null) throw new Error(`launcher did not reach ready in ${READY_TIMEOUT_MS / 1000}s; ${stderr.trim() || stdout}`)
  return { url: urlMatch[1].replace('://0.0.0.0', '://127.0.0.1'), port, root: rootMatch[1], cookie: parseSessionCookie(cookieMatch[1]), child }
}

// The launcher prints the literal `none` for dsh versions whose ready URL needs no session.
function parseSessionCookie(value: string): string | null {
  if (value === 'none') return null
  return value
}

/** SIGTERM the launcher; wait for its exit and for it to remove its temp root. */
export async function stopDsh(handle: DshHandle): Promise<{ code: number | null; rootRemoved: boolean }> {
  handle.child.kill('SIGTERM')
  const code = await onceExit(handle.child)
  let rootRemoved = false
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (!existsSync(handle.root)) { rootRemoved = true; break }
    await sleep(200)
  }
  return { code, rootRemoved }
}

/** One RPC call into the /model-settings channel — the client's exact wire shape. */
export async function rpc<T>(handle: DshHandle, endpoint: string, payload: unknown): Promise<RpcResult<T>> {
  const rpcId = `e2e-live-checks-${++rpcSeq}`
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/model-settings/${endpoint}`, {
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
    const res = await rpc<ModelRow[]>(handle, 'listModels', {})
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

function onceExit(proc: ChildProcess): Promise<number | null> {
  return new Promise(resolve => proc.once('exit', resolve))
}
