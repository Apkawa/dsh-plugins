import type { Issue } from '../issues.ts'

/**
 * The row's state token: the issue's state as its display label, the key the
 * pane uses to pick the status label's color class.
 * @param issue - the issue to label.
 * @returns the token for the status label.
 */
export function statusToken(issue: Issue): 'open' | 'closed' {
  return issue.state
}

/**
 * The issue's short reference: `#<number>`.
 * @param number - the issue number.
 * @returns the reference string.
 */
export function issueRef(number: number): string {
  return `#${number}`
}
