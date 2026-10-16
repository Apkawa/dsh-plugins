import { useEffect, useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Issue, RepoRef } from '../issues.ts'
import css from './issue-pane.module.css'
import { issueRef, statusToken } from './format.ts'
import { back, getError, getIssues, getIssueLoading, getListLoading, getRepo, getSelected, refresh, select, subscribe } from './index.ts'

/** The status token's class, by issue state. */
const statusClass: Record<Issue['state'], string | undefined> = {
  open: css.statusOpen,
  closed: css.statusClosed,
}

/** The "Issues" tab body's props: the session the seat scopes it to, and the workspace-list selector hook it derives the workspace path from. */
interface IssuePaneProps {
  /** The session the pane belongs to (handed by the session-scoped seat dispatcher). */
  sessionId: string
  /** Selector hook over the workspace rows (the session's workspace path is looked up by its session id). */
  useWorkspaces: <S>(sel: (state: { items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[] }) => S) => S
}

/** The "Issues" tab body: one row per issue; clicking a row opens its detail. */
export function IssuePane(props: IssuePaneProps) {
  const workspacePath = props.useWorkspaces(state => state.items.find(workspace => workspace.sessionIds.includes(props.sessionId))?.path)
  const [repo, setRepo] = useState<RepoRef | null>(getRepo)
  const [issues, setIssues] = useState<Issue[]>(getIssues)
  const [selected, setSelected] = useState<Issue | null>(getSelected)
  const [error, setError] = useState(getError)
  const [listLoading, setListLoading] = useState(getListLoading)
  const [issueLoading, setIssueLoading] = useState(getIssueLoading)
  // The issue number the in-flight fetch targets, for the "Loading issue #N" label (stale is harmless: the label shows only while issueLoading).
  const [loadingNumber, setLoadingNumber] = useState<number | null>(null)
  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setRepo(getRepo())
      setIssues(getIssues())
      setSelected(getSelected())
      setError(getError())
      setListLoading(getListLoading())
      setIssueLoading(getIssueLoading())
    })
    void refresh(workspacePath)
    return unsubscribe
  }, [workspacePath])

  if (error !== null) {
    return (
      <div data-testid="ghl-pane" className={css.pane}>
        <div className={css.error} data-testid="ghl-error">
          <p className={css.errorMessage}>{error.message}</p>
          <span className={css.errorCode}>{error.code}</span>
          <button type="button" className={css.ghost} data-testid="ghl-reload" onClick={() => void refresh(workspacePath)}>Reload</button>
        </div>
      </div>
    )
  }

  if (listLoading && issues.length === 0) {
    return (
      <div data-testid="ghl-pane" className={css.pane}>
        <div className={css.loading} data-testid="ghl-loading-list">
          <StateDot state="ongoing" />
          Loading issues…
        </div>
      </div>
    )
  }

  if (repo === null) {
    return (
      <div data-testid="ghl-pane" className={css.pane}>
        <p className={css.empty} data-testid="ghl-missing-repo">No GitHub repository detected for this workspace</p>
      </div>
    )
  }

  if (issueLoading) {
    return (
      <div data-testid="ghl-pane" className={css.pane}>
        <div className={css.loading} data-testid="ghl-loading-issue">
          <StateDot state="ongoing" />
          Loading issue {loadingNumber !== null ? `#${loadingNumber}` : '…'}…
        </div>
      </div>
    )
  }

  if (selected !== null) {
    return (
      <div data-testid="ghl-pane" className={css.pane}>
        <div className={css.detail} data-testid="ghl-detail">
          <button type="button" className={css.back} data-testid="ghl-back" onClick={back}>Back</button>
          <header className={css.detailHeader}>
            <span className={css.ref} data-testid="ghl-detail-ref">{issueRef(selected.number)}</span>
            <span className={`${css.status} ${statusClass[selected.state]}`} data-testid="ghl-detail-status">{statusToken(selected)}</span>
            {selected.labels.map(label => <span key={label} className={css.label}>{label}</span>)}
          </header>
          <h2 className={css.title} data-testid="ghl-detail-title">{selected.title}</h2>
          <p className={css.body} data-testid="ghl-detail-body">{selected.body}</p>
          <a className={css.link} data-testid="ghl-detail-link" href={selected.htmlUrl} target="_blank" rel="noreferrer">View on GitHub</a>
        </div>
      </div>
    )
  }

  if (issues.length === 0) {
    return (
      <div data-testid="ghl-pane" className={css.pane}>
        <p className={css.empty} data-testid="ghl-empty">No issues</p>
      </div>
    )
  }

  return (
    <div data-testid="ghl-pane" className={css.pane}>
      <div className={css.toolbar}>
        <button
          type="button"
          className={css.ghost}
          data-testid="ghl-refresh"
          disabled={listLoading}
          onClick={e => { void refresh(workspacePath, e.ctrlKey) }}
        >
          Refresh
          {listLoading && <span className={css.busyDot} data-testid="ghl-refresh-busy"><StateDot state="ongoing" /></span>}
        </button>
      </div>
      <div className={css.list}>
        {issues.map(issue => (
          <div
            key={issue.number}
            data-testid="ghl-row"
            data-issue-number={issue.number}
            role="button"
            className={css.row}
            onClick={() => { setLoadingNumber(issue.number); void select(issue.number, workspacePath) }}
          >
            <span className={css.ref} data-testid="ghl-row-ref">{issueRef(issue.number)}</span>
            <span className={css.text}>{issue.title}</span>
            {issue.labels.map(label => <span key={label} className={css.label}>{label}</span>)}
            <span className={`${css.status} ${statusClass[issue.state]}`} data-testid="ghl-row-status">{statusToken(issue)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
