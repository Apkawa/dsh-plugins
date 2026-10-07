import type { QueueItem } from '../queue/types.ts'

/**
 * The compact per-item stats line: `<runtime>, <tokens>`, with the runtime part
 * omitted when the item has no start/end times and the tokens part omitted when
 * it has no stats; `''` when neither part is present.
 * @param item - the queued item to format.
 * @returns the joined stats line, or `''`.
 */
export function formatStats(item: QueueItem): string {
  const parts: string[] = []
  if (item.startedAt !== undefined && item.endedAt !== undefined) parts.push(formatRuntime(item.endedAt - item.startedAt))
  if (item.stats !== undefined) parts.push(formatTokens(item.stats.tokens))
  return parts.join(', ')
}

/**
 * A duration as its two largest non-zero units (`1d 3h`, `3h 25m`, `25m`,
 * `45s`); minutes and seconds are always two-digit padded, and a zero or
 * sub-second duration renders as `0s`.
 */
function formatRuntime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const units: Array<[number, string]> = [
    [Math.floor(totalSeconds / 86_400), 'd'],
    [Math.floor((totalSeconds % 86_400) / 3_600), 'h'],
    [Math.floor((totalSeconds % 3_600) / 60), 'm'],
    [totalSeconds % 60, 's'],
  ]
  const rendered = units
    .filter(([value]) => value > 0)
    .slice(0, 2)
    .map(([value, unit]) => `${unit === 'm' || unit === 's' ? value.toString().padStart(2, '0') : value}${unit}`)
  if (rendered.length === 0) return '0s'
  return rendered.join(' ')
}

/** A token count as `30.5M` / `1.2K` / `500` (>=1e6 -> M, >=1e3 -> K, below -> integer). */
function formatTokens(tokens: number): string {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}K`
  return `${Math.round(tokens)}`
}

/**
 * The workspace's display name: the last non-empty segment of its path (both
 * separator styles), `''` when the path carries no segment (empty or root).
 * @param workspacePath - the workspace's absolute path.
 * @returns the display name, or `''`.
 */
export function workspaceName(workspacePath: string): string {
  return workspacePath.split(/[\\/]/).filter(segment => segment !== '').pop() ?? ''
}
