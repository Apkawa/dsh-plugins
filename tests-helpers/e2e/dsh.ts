/**
 * Shared e2e launch core — bring up an isolated `dsh web` on a fresh throwaway
 * home with the package under test linked into its `web` profile, and hand back
 * a handle (ready URL, parsed port, session cookie, child process) plus a stopper.
 *
 * The matrix targets only 0.2.0-rc.2, which tokenizes the ready URL (the URL
 * carries a `token=` that is exchanged once for a session cookie). That is
 * resolved here so callers always talk to the plain URL with the cookie (when
 * any). No `@playwright/test` dependency — this core is shared
 * by the vitest and playwright lanes alike.
 */
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

// ESM: __dirname is unavailable; this file lives in tests-helpers/e2e/, two levels below the repo root.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const READY_TIMEOUT_MS = 90_000
const PROVISION_STALE_MS = 10 * 60_000
const PROVISION_TIMEOUT_MS = 180_000
const ONLY_BUILT = ['@deepseek-ai/dsh-subprocess-local', '@google/genai', 'koffi', 'node-pty', 'protobufjs']
const KEYLESS_STRIP = ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DASHSCOPE_API_KEY', 'DSH_API_KEY']
// Matches the tokenized ready URL from 0.2.0-rc.2 (a tokenless URL would also match).
const READY_LINE = /dsh web: (http:\/\/[^\s]+)/

export const E2E_DSH_VERSIONS = ['0.2.0-rc.2'] as const

/** A running e2e instance plus everything needed to talk to it and tear it down. */
export interface DshHandle {
  url: string
  port: number
  root: string
  package: string
  bin: string
  cookie: string | null
  child: ChildProcess
  version: string | null
  /** Everything the child has written to stdout+stderr so far (activation diagnostics ride here). */
  readOutput: () => string
}

/**
 * Launch an isolated `dsh web` with `packageName` linked into its `web` profile.
 * `version` selects the dsh to run (defaults to 0.2.0-rc.2); an
 * `E2E_DSH_BIN` override (which must exist) wins and forces `handle.version` to
 * null. `keyless` strips provider API keys from the child env.
 */
export async function launchDsh(opts: { packageName: string; port?: number; keyless?: boolean; version?: string }): Promise<DshHandle> {
  const packageDir = join(REPO_ROOT, 'packages', opts.packageName)
  if (!existsSync(packageDir)) throw new Error(`package "${opts.packageName}" not found: no packages/${opts.packageName} in this repo`)
  const bin = await resolveDshBinary(opts.version)
  const version = process.env.E2E_DSH_BIN !== undefined ? null : (opts.version ?? '0.2.0-rc.2')
  const root = createTempRoot()
  const env = childEnv(root, opts.keyless === true)
  ensureBuilt(packageDir, env)
  addPlugin(bin, root, env, packageDir)
  const output = { text: '' }
  const home = await bootWeb(bin, root, env, opts.port ?? 0, output)
  const cookie = home.url.includes('token=') ? await exchangeSession(home.url) : null
  const url = (home.url.split('?')[0] ?? home.url).replace('://0.0.0.0', '://127.0.0.1')
  const port = Number(new URL(home.url).port)
  return { url, port, root, package: opts.packageName, bin, cookie, child: home.child, version, readOutput: () => output.text }
}

/** SIGTERM the child and await its exit code; remove the temp root unless `E2E_KEEP=1`. */
export async function stopDsh(handle: DshHandle): Promise<{ code: number | null; rootRemoved: boolean }> {
  const code = await stopChild(handle.child)
  if (process.env.E2E_KEEP !== '1') rmSync(handle.root, { recursive: true, force: true })
  return { code, rootRemoved: !existsSync(handle.root) }
}

/** `E2E_DSH_BIN` override (must exist) → provisioned dsh for `version` (default baseline). No PATH fallback. */
export async function resolveDshBinary(version?: string): Promise<string> {
  const override = process.env.E2E_DSH_BIN
  if (override !== undefined) {
    if (!existsSync(override)) throw new Error(`E2E_DSH_BIN does not exist: ${override} — point it at a dsh binary`)
    return override
  }
  return ensureDshVersion(version ?? '0.2.0-rc.2')
}

/**
 * Ensure a dsh version is provisioned under `.tmp/dsh-versions/<version>` and
 * return its `node_modules/.bin/dsh` path. Provisions once; concurrent callers
 * for the same version serialize on a per-version lock (a lock older than ~10 min
 * is reclaimed, so a crashed provisioner cannot wedge it).
 */
export async function ensureDshVersion(version: string): Promise<string> {
  const dir = join(REPO_ROOT, '.tmp', 'dsh-versions', version)
  const bin = join(dir, 'node_modules', '.bin', 'dsh')
  if (existsSync(bin)) return bin
  await acquireProvisionLock(dir)
  try {
    // Re-check after acquiring the lock: a prior caller may have finished it.
    if (existsSync(bin)) return bin
    writeProvisionFiles(dir, version)
    const install = spawnSync('pnpm', ['install'], {
      cwd: dir,
      env: { ...process.env, CI: '1', pnpm_config_store_dir: join(REPO_ROOT, '.cache', 'pnpm', 'v11') },
      stdio: 'pipe',
      timeout: PROVISION_TIMEOUT_MS,
    })
    if (install.error !== undefined || install.status !== 0) {
      throw new Error(`pnpm install for dsh ${version} failed (status ${String(install.status)})\nstdout:\n${install.stdout.toString()}\nstderr:\n${install.stderr.toString()}`)
    }
    if (!existsSync(bin)) throw new Error(`pnpm install for dsh ${version} finished but ${bin} is missing`)
    return bin
  } finally {
    rmSync(join(dir, '.provision-lock'), { recursive: true, force: true })
  }
}

// The temp root is the child's cwd and carries DSH_HOME/DSH_AGENTS_HOME, so the
// instance shares nothing with the real home (sessions, `.env`, settings stay inside).
function createTempRoot(): string {
  const root = mkdtempSync(join(REPO_ROOT, '.tmp', 'dsh-e2e-'))
  mkdirSync(join(root, '.dsh'))
  mkdirSync(join(root, '.agents'))
  return root
}

function childEnv(root: string, keyless: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (keyless) for (const name of KEYLESS_STRIP) delete env[name]
  env.DSH_HOME = join(root, '.dsh')
  env.DSH_AGENTS_HOME = join(root, '.agents')
  env.DSH_TELEMETRY_DISABLED = '1'
  env.pnpm_config_store_dir = join(REPO_ROOT, '.cache', 'pnpm', 'v11')
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

// lib/index.js is always required; the ./client export's target additionally when
// the package's exports map has a ./client key (same rule as the shared launcher).
function requiredArtifacts(packageDir: string): string[] {
  const packageJson = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
  const artifacts = ['lib/index.js']
  const clientExport = packageJson.exports?.['./client']
  if (clientExport === undefined) return artifacts
  const clientPath = typeof clientExport === 'string' ? clientExport : (clientExport as { default?: unknown }).default
  if (typeof clientPath !== 'string') return artifacts
  artifacts.push(clientPath.replace(/^\.\//, ''))
  return artifacts
}

// Link the package into the fresh `web` profile (auto-initialized by the CLI on first use).
function addPlugin(bin: string, root: string, env: NodeJS.ProcessEnv, packageDir: string): void {
  const result = spawnSync(bin, ['plugin', '--profile', 'web', 'add', packageDir], { cwd: root, env, stdio: 'pipe' })
  if (result.error !== undefined) throw new Error(`"dsh plugin add" failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`"dsh plugin --profile web add" exited with code ${result.status}\n${result.stdout.toString()}\n${result.stderr.toString()}`)
}

async function bootWeb(bin: string, root: string, env: NodeJS.ProcessEnv, port: number, output: { text: string }): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(bin, ['web', '--port', String(port), '--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout = child.stdout
  const stderr = child.stderr
  if (stdout === null || stderr === null) { child.kill('SIGTERM'); throw new Error('dsh web: stdio pipes are missing') }
  try {
    const url = await waitForReady(stdout, stderr, child, output)
    return { child, url }
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  }
}

// The ready line on stdout/stderr is the CLI's own contract (`dsh web: http://…`).
// The shared `output` buffer keeps accumulating after the resolve (the listeners
// stay attached), so callers can read startup activation diagnostics later.
function waitForReady(stdout: Readable, stderr: Readable, child: ChildProcess, output: { text: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = (message: string): void => reject(new Error(`${message}\noutput:\n${output.text}`))
    const timer = setTimeout(() => fail(`dsh web not ready in ${READY_TIMEOUT_MS / 1000}s`), READY_TIMEOUT_MS)
    const onData = (chunk: Buffer): void => {
      output.text += chunk.toString()
      const match = READY_LINE.exec(output.text)
      if (match === null) return
      const url = match[1]
      if (url === undefined) return
      clearTimeout(timer)
      resolve(url)
    }
    stdout.on('data', onData)
    stderr.on('data', onData)
    child.once('exit', (code) => { clearTimeout(timer); fail(`dsh web exited early (code ${code})`) })
  })
}

// dsh 0.1.2+ ready URLs are an exchange-only 303: the token never yields a 200, it
// only mints the session cookie. Callers then use the plain URL with that cookie.
function exchangeSession(url: string): Promise<string> {
  return fetch(url, { redirect: 'manual' }).then(
    (response) => {
      const setCookie = response.headers.get('set-cookie')
      if (response.status !== 303) throw new Error(`GET ${url} → ${response.status}; expected 303 from the token exchange`)
      if (setCookie === null) throw new Error(`GET ${url} → 303 without Set-Cookie`)
      const cookie = setCookie.split(';')[0]
      if (cookie === undefined) throw new Error(`GET ${url} → 303 with an empty Set-Cookie`)
      return cookie
    },
    () => { throw new Error(`GET ${url} → unreachable; expected 303 from the token exchange`) },
  )
}

// Serialize concurrent provisioning of one version: the first caller provisions
// while the rest wait on the lock (reclaimed after ~10 min).
function acquireProvisionLock(dir: string): Promise<void> {
  const lockDir = join(dir, '.provision-lock')
  mkdirSync(dir, { recursive: true })
  return new Promise<void>((resolve, reject) => {
    const attempt = (): void => {
      try {
        mkdirSync(lockDir)
        resolve()
        return
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) { reject(error); return }
        if (lockIsStale(lockDir)) { rmSync(lockDir, { recursive: true, force: true }); attempt(); return }
        setTimeout(attempt, 200)
      }
    }
    attempt()
  })
}

function lockIsStale(lockDir: string): boolean {
  try {
    return Date.now() - statSync(lockDir).mtimeMs > PROVISION_STALE_MS
  } catch {
    return false
  }
}

// Write the throwaway provision project: the pinned dsh manifest plus a local
// pnpm-workspace.yaml. That workspace file does two jobs pnpm v11 needs — it
// makes this dir its own pnpm root (so `pnpm install` doesn't anchor to the repo
// workspace and silently no-op), and `allowBuilds` approves the native build
// scripts (pnpm v11 no longer reads package.json's `pnpm` field, so that alone
// would leave koffi/node-pty/protobufjs unbuilt).
function writeProvisionFiles(dir: string, version: string): void {
  const manifest = {
    name: `dsh-${version}`,
    private: true,
    dependencies: { '@deepseek-ai/dsh': version },
    pnpm: { onlyBuiltDependencies: ONLY_BUILT },
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const builds = ONLY_BUILT.map((name) => `  ${name.startsWith('@') ? `'${name}'` : name}: true`).join('\n')
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), `packages: []\nallowBuilds:\n${builds}\n`)
}

function isErrno(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  if (!('code' in error)) return false
  return error.code === code
}

function stopChild(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(child.exitCode); return }
    child.once('exit', (code) => { resolve(code) })
    child.kill('SIGTERM')
  })
}
