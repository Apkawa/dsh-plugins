/**
 * The plugin's gated logger. Every level except `error` is silent unless the process runs with
 * `DEBUG=1` (the exact value — no namespace globs); `error` is never gated, so failures stay
 * visible in quiet runs. The `[web-search-ddgs]` tag lives here so call sites don't repeat it.
 */

/** True when this process was started with exactly `DEBUG=1`. */
const isEnabled = (): boolean => process.env.DEBUG === '1'

const TAG = '[web-search-ddgs]'

export const dbg = {
  log: (...args: unknown[]): void => { if (isEnabled()) console.log(TAG, ...args) },
  info: (...args: unknown[]): void => { if (isEnabled()) console.info(TAG, ...args) },
  warn: (...args: unknown[]): void => { if (isEnabled()) console.warn(TAG, ...args) },
  debug: (...args: unknown[]): void => { if (isEnabled()) console.debug(TAG, ...args) },
  /** Never gated — failures must stay loud. */
  error: (...args: unknown[]): void => { console.error(TAG, ...args) },
}
