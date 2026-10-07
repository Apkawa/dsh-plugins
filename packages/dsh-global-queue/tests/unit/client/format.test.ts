import { describe, expect, it } from 'vitest'
import { formatStats, workspaceName } from '../../../src/client/format.ts'
import type { QueueItem } from '../../../src/queue/types.ts'

/** A baseline queued item; the case overrides the fields it exercises. */
function item(partial: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'item-1',
    text: 'test item',
    workspacePath: '/tmp/ws',
    targetSessionId: null,
    status: 'queued',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

/** An item that ran for `ms`, with an optional token total. */
function finished(ms: number, tokens?: number): QueueItem {
  const partial: Partial<QueueItem> = { startedAt: 0, endedAt: ms }
  if (tokens !== undefined) partial.stats = { tokens }
  return item(partial)
}

describe('formatStats', () => {
  it('joins the runtime and tokens parts with ", "', () => {
    expect(formatStats(finished(5_700_000, 30_500_000))).toBe('1h 35m, 30.5M')
  })

  it('omits the tokens part when stats is missing', () => {
    expect(formatStats(finished(5_700_000))).toBe('1h 35m')
  })

  it('omits the runtime part when the times are missing', () => {
    expect(formatStats(item({ stats: { tokens: 30_500_000 } }))).toBe('30.5M')
  })

  it('renders an empty string when neither part is present', () => {
    expect(formatStats(item())).toBe('')
  })

  describe('runtime', () => {
    it('shows the two largest non-zero units', () => {
      expect(formatStats(finished(97_200_000))).toBe('1d 3h')
      expect(formatStats(finished(12_300_000))).toBe('3h 25m')
      expect(formatStats(finished(1_500_000))).toBe('25m')
      expect(formatStats(finished(45_000))).toBe('45s')
    })

    it('pads minutes and seconds to two digits', () => {
      expect(formatStats(finished(300_000))).toBe('05m')
      expect(formatStats(finished(5_000))).toBe('05s')
    })

    it('renders zero and sub-second durations as 0s', () => {
      expect(formatStats(finished(0))).toBe('0s')
      expect(formatStats(finished(999))).toBe('0s')
    })
  })

  describe('tokens (no times, so no runtime part)', () => {
    it('renders millions with one decimal', () => {
      expect(formatStats(item({ stats: { tokens: 30_500_000 } }))).toBe('30.5M')
      expect(formatStats(item({ stats: { tokens: 1_200_000 } }))).toBe('1.2M')
    })

    it('renders thousands with one decimal below 1e6', () => {
      expect(formatStats(item({ stats: { tokens: 1_234 } }))).toBe('1.2K')
      expect(formatStats(item({ stats: { tokens: 100_000 } }))).toBe('100.0K')
    })

    it('pins the 1e3 and 1e6 boundaries', () => {
      expect(formatStats(item({ stats: { tokens: 1_000 } }))).toBe('1.0K')
      expect(formatStats(item({ stats: { tokens: 999 } }))).toBe('999')
      expect(formatStats(item({ stats: { tokens: 1_000_000 } }))).toBe('1.0M')
      expect(formatStats(item({ stats: { tokens: 500 } }))).toBe('500')
    })

    it('rounds to one decimal', () => {
      expect(formatStats(item({ stats: { tokens: 1_234_567 } }))).toBe('1.2M')
      expect(formatStats(item({ stats: { tokens: 12_345 } }))).toBe('12.3K')
    })
  })
})

describe('workspaceName', () => {
  it('returns the last path segment', () => {
    expect(workspaceName('/tmp/ws')).toBe('ws')
    expect(workspaceName('/home/user/code/my-project')).toBe('my-project')
  })

  it('ignores trailing separators', () => {
    expect(workspaceName('/tmp/ws/')).toBe('ws')
    expect(workspaceName('/tmp/ws//')).toBe('ws')
  })

  it('splits on backslashes as well', () => {
    expect(workspaceName('C:\\Users\\dev\\proj')).toBe('proj')
  })

  it('renders an empty string when no segment exists', () => {
    expect(workspaceName('')).toBe('')
    expect(workspaceName('/')).toBe('')
  })
})
