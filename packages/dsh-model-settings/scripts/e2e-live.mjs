#!/usr/bin/env node
/**
 * e2e-live — launch an independent `dsh web` on a clean, throwaway home.
 *
 * The temp root carries DSH_HOME/DSH_AGENTS_HOME and is the child's cwd, so the
 * instance shares nothing with the real home (sessions, `.env`, settings all
 * stay inside the temp root). The plugin under test is linked into the fresh
 * `web` profile exactly like the live one (`dsh plugin --profile web add`).
 * The dsh binary is resolved once and used for the plugin add and the `web`
 * spawn: `E2E_DSH_BIN` override, then the provisioned baseline
 * `.tmp/dsh-versions/0.1.1-rc.2/node_modules/.bin/dsh`, then `dsh` on PATH —
 * the same chain the playwright lane uses (`tests/e2e/live.ts`). Provider API
 * keys come from the inherited env and are the only thing taken from the
 * caller. SIGINT/SIGTERM stop the child gracefully and remove the temp root
 * unless `--keep` is passed.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const READY_TIMEOUT_MS = 90_000

let root
let child = null
let stopping = false

const { port, keep } = parseArgs(process.argv.slice(2))

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

const dshBin = resolveDshBinary()
requireCommand(dshBin, ['-V'])
requireCommand('pnpm', ['--version'])

const missing = ['index.js', 'client.js'].filter((name) => !existsSync(join(PACKAGE_ROOT, 'lib', name)))
if (missing.length > 0) fail(`built artifacts missing: ${missing.join(', ')} — run "pnpm build" in the package first`)

// Repo rule: temp state lives in .tmp/, not the system tmpdir (same as tests/e2e/live.ts).
root = mkdtempSync(join(REPO_ROOT, '.tmp', 'dsh-e2e-'))
const env = { ...process.env, DSH_HOME: join(root, '.dsh'), DSH_AGENTS_HOME: join(root, '.agents') }
addPlugin(dshBin, env)

child = spawn(dshBin, ['web', '--port', String(port), '--no-open'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
const ready = await waitForReadyLine(child).then((url) => ({ url }), (error) => ({ error: error.message }))
if (ready.error !== undefined) fail(ready.error)

const url = ready.url.replace('://0.0.0.0', '://127.0.0.1')
const session = url.includes('token=') ? await exchangeSession(url) : null
const plainUrl = url.split('?')[0]
const response = await fetch(plainUrl, session === null ? undefined : { headers: { cookie: session } }).catch(() => null)
if (response?.status !== 200) fail(`GET ${plainUrl} → ${response === null ? 'unreachable' : response.status}; expected 200`)

console.log(`dsh binary: ${dshBin}`)
console.log(`dsh e2e instance: ${url}`)
console.log(`session cookie: ${session === null ? 'none' : session}`)
console.log(`temp root: ${root}`)
console.log(`pid: ${process.pid} — SIGINT/SIGTERM stops it; --keep preserves the temp root`)

const code = await onceExit(child)
cleanup()
process.exit(stopping ? 0 : code ?? 1)

/** SIGINT/SIGTERM: forward SIGTERM to the child, wait for its graceful drain, remove the temp root. */
async function stop() {
  if (stopping) return
  stopping = true
  if (child !== null) {
    child.kill('SIGTERM')
    await onceExit(child)
  }
  cleanup()
  process.exit(0)
}

function parseArgs(argv) {
  const options = { port: 3081, keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--keep') {
      options.keep = true
      continue
    }
    if (token === '--port') {
      index += 1
      options.port = Number(argv[index])
      continue
    }
    fail(`unknown option "${token}" — e2e:live supports --port <n> and --keep`)
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) fail(`invalid --port (want an integer in 1..65535)`)
  return options
}

function requireCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'pipe' })
  if (result.error !== undefined) fail(`${command} not found on PATH — install it before running e2e:live`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with code ${result.status}`)
}

// E2E_DSH_BIN override (must exist) → provisioned 0.1.1-rc.2 baseline → `dsh` on PATH.
function resolveDshBinary() {
  const override = process.env.E2E_DSH_BIN
  if (override !== undefined) {
    if (existsSync(override)) return override
    fail(`E2E_DSH_BIN does not exist: ${override} — point it at a dsh binary`)
  }
  const provisioned = join(REPO_ROOT, '.tmp', 'dsh-versions', '0.1.1-rc.2', 'node_modules', '.bin', 'dsh')
  if (existsSync(provisioned)) return provisioned
  if (spawnSync('dsh', ['--version'], { stdio: 'pipe' }).error !== undefined) fail('no dsh binary found: set E2E_DSH_BIN or provision .tmp/dsh-versions/0.1.1-rc.2/node_modules/.bin/dsh')
  return 'dsh'
}

/** Link this package into the fresh `web` profile (auto-initialized by the CLI on first use). */
function addPlugin(bin, env) {
  const result = spawnSync(bin, ['plugin', '--profile', 'web', 'add', PACKAGE_ROOT], { cwd: root, env, stdio: 'pipe' })
  if (result.status !== 0) {
    console.error(result.stdout?.toString())
    console.error(result.stderr?.toString())
    fail(`"dsh plugin --profile web add ${PACKAGE_ROOT}" failed with code ${result.status}`)
  }
}

/** The ready line on stdout/stderr is the CLI's own contract (`dsh web: http://…`). */
function waitForReadyLine(child) {
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`dsh web not ready in ${READY_TIMEOUT_MS / 1000}s; output:\n${out}`)), READY_TIMEOUT_MS)
    const onData = (chunk) => {
      out += chunk.toString()
      const match = /dsh web: (http:\/\/[^\s]+)/.exec(out)
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(out.includes('EADDRINUSE')
        ? `port ${port} is already in use — free it or pass --port <n>`
        : `dsh web exited early (code ${code}); output:\n${out}`))
    })
  })
}

function onceExit(proc) {
  return new Promise((resolve) => { proc.once('exit', resolve) })
}

/**
 * dsh 0.1.2+ ready URLs are an exchange-only 303: the token never yields a 200, it
 * only mints the session cookie. All in-session requests go to the plain URL
 * with that cookie instead.
 */
function exchangeSession(url) {
  return fetch(url, { redirect: 'manual' }).then(
    (response) => {
      const setCookie = response.headers.get('set-cookie')
      if (response.status !== 303) fail(`GET ${url} → ${response.status}; expected 303 from the token exchange`)
      if (setCookie === null) fail(`GET ${url} → 303 without Set-Cookie`)
      return setCookie.split(';')[0]
    },
    () => fail(`GET ${url} → unreachable; expected 303 from the token exchange`)
  )
}

function cleanup() {
  if (root === undefined) return
  if (keep) {
    console.log(`e2e-live: keeping temp root: ${root}`)
    return
  }
  rmSync(root, { recursive: true, force: true })
}

function fail(message) {
  if (child !== null && child.exitCode === null) child.kill('SIGTERM')
  cleanup()
  console.error(`e2e-live: ${message}`)
  process.exit(1)
}
