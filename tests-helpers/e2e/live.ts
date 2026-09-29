// Playwright-lane wrapper over the shared e2e launch core (`./dsh.ts`): launch a
// throwaway, keyless `dsh web` with the given package linked into the `web`
// profile and hand back the ready URL, the session cookie when one was minted
// (0.1.2+), and a stopper. All provisioning, version selection, token/cookie
// handling, and teardown live in the core.
import type { Page } from '@playwright/test'
import { launchDsh, stopDsh } from './dsh.ts'

export async function launchPluginTestHome(packageName: string, version?: string): Promise<{ url: string; cookie: string | null; stop: () => Promise<void> }> {
  // Version is forwarded only when provided (core defaults to the 0.1.1-rc.2
  // baseline); the conditional build keeps this exactOptionalPropertyTypes-clean.
  const opts = version === undefined
    ? { packageName, keyless: true, port: 0 }
    : { packageName, keyless: true, port: 0, version }
  const handle = await launchDsh(opts)
  const stop = async (): Promise<void> => {
    await stopDsh(handle)
  }
  // 0.1.2+ ready URLs are tokenized: the core exchanges the token for a session
  // cookie, which the browser must present before navigating the plain URL.
  return { url: handle.url, cookie: handle.cookie, stop }
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
