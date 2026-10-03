// Playwright-lane wrapper over the shared e2e launch core (`./dsh.ts`): launch a
// throwaway, keyless `dsh web` with the given package linked into the `web`
// profile and hand back the ready URL, the session cookie when one was minted
// (0.1.2+), and a stopper. All provisioning, version selection, token/cookie
// handling, and teardown live in the core.
import type { Page } from '@playwright/test'
import { launchDsh, stopDsh } from './dsh.ts'

export async function launchPluginTestHome(packageName: string, version?: string): Promise<{ url: string; cookie: string | null; stop: () => Promise<void> }> {
  // Version is forwarded only when provided (core defaults to the 0.2.0-rc.2
  // target); the conditional build keeps this exactOptionalPropertyTypes-clean.
  const opts = version === undefined
    ? { packageName, keyless: true, port: 0 }
    : { packageName, keyless: true, port: 0, version }
  const handle = await launchDsh(opts)
  const stop = async (): Promise<void> => {
    await stopDsh(handle)
  }
  // The 0.2.0-rc.2 ready URL is tokenized: the core exchanges the token for a
  // session cookie, which the browser must present before navigating the plain URL.
  return { url: handle.url, cookie: handle.cookie, stop }
}

// Returns a collector that yields the error/warning console messages and page
// errors observed on the page. The keyless 0.2.0-rc.2 home is console-clean
// (no error/warning/pageerror messages, confirmed by the e2e runs; a live probe
// capturing every console severity observed none at all), so no filtering of
// benign noise is needed — the severity filter stays for robustness.
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
