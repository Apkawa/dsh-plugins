#!/usr/bin/env node
/**
 * e2e-live — launch an independent `dsh web` on a clean, throwaway home.
 *
 * Thin CLI over the shared launch core (`tests-helpers/e2e/dsh.ts`): provisioning,
 * plugin link, ready-wait, session-cookie exchange, and teardown all live there —
 * this file only parses args, verifies the ready URL, prints the handle, and wires
 * SIGINT/SIGTERM and the child's own exit to `stopDsh`. The temp root carries
 * DSH_HOME/DSH_AGENTS_HOME and is the child's cwd, so the instance shares nothing
 * with the real home. Provider API keys come from the inherited env (this manual
 * lane is not keyless) and are the only thing taken from the caller. `--keep`
 * preserves the temp root.
 */
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchDsh, stopDsh } from '../tests-helpers/e2e/dsh.ts'
import type { DshHandle } from '../tests-helpers/e2e/dsh.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

let handle: DshHandle | null = null
let keep = false
let stopping = false

main().catch((error: unknown) => fail(flat(error)))

/** Parse args, launch through the core, verify the ready URL, print the handle. */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const packageDir = join(REPO_ROOT, 'packages', args.packageName)
  if (!existsSync(packageDir)) throw new Error(`--package "${args.packageName}" not found: no packages/${args.packageName} in this repo`)
  keep = args.keep
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  handle = await launchDsh({ packageName: args.packageName, port: args.port, version: args.version })
  await verifyInstance(handle)

  console.log(`dsh binary: ${handle.bin}`)
  console.log(`dsh e2e instance: ${handle.url}`)
  console.log(`session cookie: ${handle.cookie ?? 'none'}`)
  console.log(`temp root: ${handle.root}`)
  console.log(`pid: ${process.pid} — SIGINT/SIGTERM stops it; --keep preserves the temp root`)

  const childCode = await onceExit(handle.child)
  await stopDsh(handle)
  process.exit(childCode === null ? 1 : childCode)
}

/** The ready URL must answer 200 — with the session cookie when the core minted one. */
async function verifyInstance(handle: DshHandle): Promise<void> {
  const init = handle.cookie === null ? undefined : { headers: { cookie: handle.cookie } }
  const response = await fetch(handle.url, init).catch(() => null)
  if (response === null || response.status !== 200) throw new Error(`GET ${handle.url} → ${response === null ? 'unreachable' : response.status}; expected 200`)
}

/** SIGINT/SIGTERM: stop via the core; `--keep` preserves the temp root. */
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  if (handle === null) { process.exit(0); return }
  if (keep) {
    process.env.E2E_KEEP = '1'
    console.log(`e2e-live: keeping temp root: ${handle.root}`)
  }
  await stopDsh(handle)
  process.exit(0)
}

/** One-line error on stderr, exit 1; the core's stopDsh does the kill/cleanup. */
async function fail(message: string): Promise<never> {
  if (handle !== null) await stopDsh(handle)
  console.error(`e2e-live: ${message}`)
  process.exit(1)
}

// The core's errors carry multi-line output; the CLI contract is one line on stderr.
function flat(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s*\n\s*/g, ' ')
}

type Args = { port: number; keep: boolean; packageName: string; version: string }

function parseArgs(argv: string[]): Args {
  const options: { port: number; keep: boolean; packageName: string | null; version: string } = { port: 3081, keep: false, packageName: null, version: '0.1.1-rc.2' }
  let index = 0
  while (index < argv.length) {
    const token = argv[index]
    if (token === undefined) break
    if (token === '--keep') {
      options.keep = true
      index += 1
      continue
    }
    if (token === '--port' || token === '--package' || token === '--version') {
      index += 1
      const value = argv[index]
      if (value === undefined) throw new Error(`${token} requires a value`)
      if (token === '--port') {
        options.port = Number(value)
        index += 1
        continue
      }
      if (token === '--package') {
        options.packageName = value
        index += 1
        continue
      }
      options.version = value
      index += 1
      continue
    }
    throw new Error(`unknown option "${token}" — e2e:live supports --package <name>, --port <n>, --version <v> and --keep`)
  }
  if (options.packageName === null) throw new Error('--package <name> is required — the plugin to link, as its directory under packages/')
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('invalid --port (want an integer in 1..65535)')
  return { port: options.port, keep: options.keep, packageName: options.packageName, version: options.version }
}

function onceExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => { child.once('exit', (code) => resolve(code)) })
}
