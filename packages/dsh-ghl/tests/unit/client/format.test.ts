import { describe, expect, it } from 'vitest'
import { issueRef, statusToken } from '../../../src/client/format.ts'
import type { Issue } from '../../../src/issues.ts'

/** A baseline open issue; the case overrides the fields it exercises. */
function issue(partial: Partial<Issue> = {}): Issue {
  return {
    number: 42,
    title: 'test issue',
    state: 'open',
    body: 'test body',
    htmlUrl: 'https://github.com/apkawa/dsh/issues/42',
    labels: ['bug'],
    ...partial,
  }
}

describe('statusToken', () => {
  it('renders the open token for an open issue', () => {
    expect(statusToken(issue({ state: 'open' }))).toBe('open')
  })

  it('renders the closed token for a closed issue', () => {
    expect(statusToken(issue({ state: 'closed' }))).toBe('closed')
  })
})

describe('issueRef', () => {
  it('prefixes the number with "#"', () => {
    expect(issueRef(42)).toBe('#42')
    expect(issueRef(1)).toBe('#1')
  })
})
