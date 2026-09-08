// Playwright fixture for the acceptance spec: launch a throwaway `dsh web` on a
// fresh, keyless home with this plugin linked into the `web` profile, and hand
// the ready URL (plus a stopper) back to the test.
//
// Spawn sequence, verified fully offline on dsh 0.1.1-rc.2:
//   dsh plugin --profile web add <package>   # before boot; link dep, no registry
//   dsh web --port 0 --no-open               # ready line: "dsh web: http://127.0.0.1:<port>"
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

// ESM: __dirname is unavailable; this file lives in tests-helpers/e2e/, two levels below the repo root.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const BOOT_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 5_000
// 0.1.1-rc.2 prints a tokenless ready URL; 0.1.2+ tokenizes it — this pattern matches both.
const READY_LINE = /dsh web: (http:\/\/[^\s]+)/
const KEYLESS_STRIP = ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DASHSCOPE_API_KEY', 'DSH_API_KEY']

export async function launchPluginTestHome(packageName: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const packageDir = join(repoRoot, 'packages', packageName)
  const bin = resolveDshBinary()
  const root = createTempRoot()
  const env = childEnv(root)
  ensureBuilt(packageDir, env)
  addPlugin(bin, root, env, packageDir)
  const home = await bootWeb(bin, root, env)
  return { url: home.url, stop: () => stopHome(home.child, root) }
}

// Returns a collector that yields the error/warning console messages and page
// errors observed on the page. Severity-filtered: the keyless 0.1.1-rc.2 render
// emits one benign note — `[VERBOSE] [DOM] Password field is not contained in a
// form` (from the API-key input) — that must not fail an otherwise clean run.
export function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    const type = message.type()
    if (type !== 'error' && type !== 'warning') return
    errors.push(message.text())
  })
  page.on('pageerror', (error) => {
    errors.push(String(error))
  })
  return () => errors
}

// E2E_DSH_BIN override → provisioned 0.1.1-rc.2 baseline → `dsh` on PATH.
function resolveDshBinary(): string {
  const override = process.env.E2E_DSH_BIN
  if (override !== undefined) {
    if (!existsSync(override)) throw new Error(`E2E_DSH_BIN does not exist: ${override} — point it at a dsh binary`)
    return override
  }
  const provisioned = join(repoRoot, '.tmp', 'dsh-versions', '0.1.1-rc.2', 'node_modules', '.bin', 'dsh')
  if (existsSync(provisioned)) return provisioned
  if (spawnSync('dsh', ['--version'], { stdio: 'pipe' }).error !== undefined) throw new Error('no dsh binary found: set E2E_DSH_BIN or provision .tmp/dsh-versions/0.1.1-rc.2/node_modules/.bin/dsh')
  return 'dsh'
}

// The temp root is the child's cwd and carries DSH_HOME/DSH_AGENTS_HOME, so the
// instance shares nothing with the real home.
function createTempRoot(): string {
  const root = mkdtempSync(join(repoRoot, '.tmp', 'dsh-e2e-'))
  mkdirSync(join(root, '.dsh'))
  mkdirSync(join(root, '.agents'))
  return root
}

function childEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of KEYLESS_STRIP) delete env[name]
  env.DSH_HOME = join(root, '.dsh')
  env.DSH_AGENTS_HOME = join(root, '.agents')
  env.DSH_TELEMETRY_DISABLED = '1'
  env.pnpm_config_store_dir = join(repoRoot, '.cache', 'pnpm', 'v11')
  // No PLAYWRIGHT_BROWSERS_PATH: Playwright's Linux default already resolves the shared
  // ~/.cache/ms-playwright cache (a repo-relative override would not, in this sandbox).
  return env
}

function ensureBuilt(packageDir: string, env: NodeJS.ProcessEnv): void {
  const artifacts = requiredArtifacts(packageDir)
  if (artifacts.every((name) => existsSync(join(packageDir, name)))) return
  const build = spawnSync('pnpm', ['build'], { cwd: packageDir, env, stdio: 'pipe' })
  if (build.error !== undefined) throw new Error(`"pnpm build" failed to start: ${build.error.message}`)
  const stillMissing = artifacts.filter((name) => !existsSync(join(packageDir, name)))
  if (stillMissing.length > 0) throw new Error(`built artifacts still missing after "pnpm build": ${stillMissing.join(', ')}`)
}

// Same rule as the shared launcher: lib/index.js is always required; lib/client.js
// additionally when the package's exports map has a ./client key.
function requiredArtifacts(packageDir: string): string[] {
  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
  const artifacts = ['lib/index.js']
  const exportsMap = packageJson.exports
  if (exportsMap !== null && typeof exportsMap === 'object' && Object.prototype.hasOwnProperty.call(exportsMap, './client')) artifacts.push('lib/client.js')
  return artifacts
}

function addPlugin(bin: string, root: string, env: NodeJS.ProcessEnv, packageDir: string): void {
  const result = spawnSync(bin, ['plugin', '--profile', 'web', 'add', packageDir], { cwd: root, env, stdio: 'pipe' })
  if (result.error !== undefined) throw new Error(`"dsh plugin add" failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`"dsh plugin --profile web add" exited with code ${result.status}\n${result.stdout.toString()}\n${result.stderr.toString()}`)
}

async function bootWeb(bin: string, root: string, env: NodeJS.ProcessEnv): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(bin, ['web', '--port', '0', '--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout = child.stdout
  const stderr = child.stderr
  if (stdout === null || stderr === null) throw new Error('dsh web: stdio pipes are missing')
  try {
    const url = await waitForReady(stdout, stderr, child)
    return { child, url }
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
}

function waitForReady(stdout: Readable, stderr: Readable, child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    const fail = (message: string) => reject(new Error(`${message}\noutput:\n${output}`))
    const timer = setTimeout(() => fail(`dsh web not ready in ${BOOT_TIMEOUT_MS / 1000}s`), BOOT_TIMEOUT_MS)
    stderr.setEncoding('utf8')
    stderr.on('data', (chunk: string) => { output += chunk })
    child.once('exit', (code) => fail(`dsh web exited early (code ${code})`))
    const lines = readline.createInterface({ input: stdout })
    lines.on('line', (line: string) => {
      output += `${line}\n`
      const match = READY_LINE.exec(line)
      if (match === null) return
      clearTimeout(timer)
      lines.close()
      resolve(match[1])
    })
  })
}

async function stopHome(child: ChildProcess, root: string): Promise<void> {
  await stopChild(child)
  if (process.env.E2E_KEEP === '1') return
  // E2E_KEEP=1 escape hatch: keep the temp root for debugging a failed run.
  rmSync(root, { recursive: true, force: true })
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
    const timer = setTimeout(resolve, STOP_TIMEOUT_MS)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
