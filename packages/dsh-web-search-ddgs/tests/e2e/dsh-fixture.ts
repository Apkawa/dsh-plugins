/**
 * e2e fixture — drives `scripts/e2e-live.mjs` black-box to bring up an
 * independent `dsh web` on a clean throwaway home with this plugin linked into
 * the fresh `web` profile. No RPC of its own: this plugin only registers a web
 * search provider, so the observable contract is boot + linkage + HTTP 200.
 */
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LAUNCHER = join(PACKAGE_ROOT, 'scripts', 'e2e-live.mjs')

export const E2E_PORT = 3091
const READY_TIMEOUT_MS = 180_000
const POLL_MS = 500

/** A running e2e instance plus the child that owns it (for teardown). */
export interface DshHandle { url: string; port: number; root: string; child: ChildProcess }

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Spawn the launcher and wait for its ready line + temp-root line. */
export async function startDsh(port: number = E2E_PORT): Promise<DshHandle> {
  const child = spawn('node', [LAUNCHER, '--port', String(port)], { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

  const readyRe = /dsh e2e instance: (http:\/\/[^\s]+)/
  const rootRe = /temp root: (.+)/
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (readyRe.test(stdout) && rootRe.test(stdout)) break
    if (child.exitCode !== null) throw new Error(`launcher exited early (code ${child.exitCode}); ${stderr.trim() || stdout}`)
    await sleep(POLL_MS)
  }
  const urlMatch = readyRe.exec(stdout)
  const rootMatch = rootRe.exec(stdout)
  if (urlMatch === null || rootMatch === null) throw new Error(`launcher did not reach ready in ${READY_TIMEOUT_MS / 1000}s; ${stderr.trim() || stdout}`)
  return { url: urlMatch[1].replace('://0.0.0.0', '://127.0.0.1'), port, root: rootMatch[1], child }
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

/** Whether the plugin is linked into the instance's `web` profile (`dsh plugin …` forwards to pnpm). */
export function pluginListed(handle: DshHandle): boolean {
  const env = { ...process.env, DSH_HOME: join(handle.root, '.dsh'), DSH_AGENTS_HOME: join(handle.root, '.agents') }
  const result = spawnSync('dsh', ['plugin', '--profile', 'web', 'ls'], { cwd: handle.root, env, stdio: 'pipe' })
  return result.stdout?.toString().includes('@apkawa/dsh-web-search-ddgs')
}

function onceExit(proc: ChildProcess) {
  return new Promise((resolve) => { proc.once('exit', resolve) })
}
