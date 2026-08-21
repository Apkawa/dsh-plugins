/**
 * The reasoning settings section (browser half): lists each OpenAI-compatible
 * route's models as a card. Every model row carries its context-window field,
 * a refresh control (re-read from the live llama.cpp listing) and one Save that
 * commits the context window and the per-level thinking mapping together; the
 * level editor folds behind a collapsed <details> accordion. The component holds
 * no settings or RPC logic of its own — it drafts locally and posts through the
 * controller face.
 */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { THINKING_LEVELS, type ReasoningEfforts, type ReasoningRow, type ReasoningSectionFace } from './reasoning-controller.ts'
import { draftsDirty, draftsFromEfforts, effortsFromDrafts, validateEffortsClient, type LevelDraft } from './efforts-editor.ts'
import { formatContextWindow, parseContextWindow } from './context-format.ts'
import css from './reasoning-section.module.css'

/** The composed props the slot dispatcher hands the section. */
type SectionProps = InjectFace<ReasoningSectionFace>

/** A route's models grouped for display. */
interface RouteGroup {
  routeId: string
  rows: readonly ReasoningRow[]
}

/** Group the flat rows by their route, preserving first-seen order. */
function groupByRoute(rows: readonly ReasoningRow[]): RouteGroup[] {
  const order: string[] = []
  const byRoute = new Map<string, ReasoningRow[]>()
  for (const row of rows) {
    const bucket = byRoute.get(row.routeId)
    if (bucket === undefined) {
      order.push(row.routeId)
      byRoute.set(row.routeId, [row])
    } else {
      bucket.push(row)
    }
  }
  return order.map(routeId => ({ routeId, rows: byRoute.get(routeId)! }))
}

export function ReasoningSection(props: SectionProps) {
  const state = props.useReasoningSection(snapshot => snapshot)

  if (state.phase === 'loading') return <p className={css.stateText}>Loading models…</p>

  if (state.phase === 'error') {
    return (
      <div className={css.section}>
        <p className={css.errorNotice} role="alert">{state.error ?? 'Failed to load models.'}</p>
        <button type="button" className={css.secondaryButton} onClick={() => props.loadRows()}>Retry</button>
      </div>
    )
  }

  if (state.rows.length === 0) return <p className={css.stateText}>No OpenAI-compatible routes configured.</p>

  return (
    <div className={css.section}>
      {groupByRoute(state.rows).map(group => (
        <section key={group.routeId} className={css.rowCard}>
          <header className={css.rowHead}>
            <span className={css.rowName}>{group.routeId}</span>
            <span className={css.rowTag}>{group.rows.length === 1 ? '1 model' : `${group.rows.length} models`}</span>
          </header>
          <div className={css.models}>
            {group.rows.map(row => (
              <ModelRow key={row.modelId} row={row} save={props.save} refreshContextWindow={props.refreshContextWindow} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** One model's row: name + ctx field + refresh/Save, and the level editor folded behind an accordion. */
function ModelRow({
  row,
  save,
  refreshContextWindow,
}: {
  row: ReasoningRow
  save: ReasoningSectionFace['save']
  refreshContextWindow: ReasoningSectionFace['refreshContextWindow']
}) {
  const [drafts, setDrafts] = useState<Record<string, LevelDraft>>(() => draftsFromEfforts(row.efforts))
  const [ctxDraft, setCtxDraft] = useState(() => (row.contextWindow === undefined ? '' : formatContextWindow(row.contextWindow)))
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // While the ctx field is focused a re-list must not yank the user's draft away.
  const ctxFocused = useRef(false)

  // Focus-aware sync: after a save/refresh re-lists the rows, adopt the stored
  // value into the draft — but only while the field is unfocused.
  useEffect(() => {
    if (ctxFocused.current) return
    setCtxDraft(row.contextWindow === undefined ? '' : formatContextWindow(row.contextWindow))
  }, [row.contextWindow])

  /** Read one level's draft (all seven are always present after init). */
  function draftFor(level: string): LevelDraft {
    return drafts[level] ?? { offered: false, wire: '' }
  }

  function updateLevel(level: string, fn: (d: LevelDraft) => LevelDraft): void {
    setDrafts(prev => ({ ...prev, [level]: fn(draftFor(level)) }))
  }

  function toggle(level: string): void {
    updateLevel(level, d => ({ ...d, offered: !d.offered }))
  }

  function setWire(level: string, wire: string): void {
    updateLevel(level, d => ({ ...d, wire }))
  }

  async function onSave(): Promise<void> {
    // The level editor's state is committed whenever it differs from the stored one:
    // a mapping when levels are offered, or an empty object — the clear — when every
    // stored level was unchecked. An untouched editor leaves the mapping alone.
    const offered = effortsFromDrafts(drafts)
    const hasLevels = Object.keys(offered).length > 0
    if (hasLevels) {
      const errors = validateEffortsClient(offered)
      if (errors.length > 0) {
        setError(errors.join('; '))
        return
      }
    }
    const effortsPart: ReasoningEfforts | undefined = draftsDirty(drafts, row.efforts) ? (hasLevels ? offered : {}) : undefined
    // A changed field commits a new value; an emptied field clears the stored one
    // (the host drops the key so dsh falls back to its own resolution). An
    // untouched field leaves the value alone.
    let contextWindow: number | null | undefined
    const parsed = parseContextWindow(ctxDraft)
    if (parsed !== undefined && parsed !== row.contextWindow) {
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError('Context window must be a positive integer, e.g. 120K')
        return
      }
      contextWindow = parsed
    } else if (ctxDraft === '' && row.contextWindow !== undefined) {
      contextWindow = null // the clear
    }
    setError(undefined)
    setSaving(true)
    try {
      await save(row.routeId, row.modelId, effortsPart, contextWindow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function onRefresh(): Promise<void> {
    setError(undefined)
    setRefreshing(true)
    try {
      await refreshContextWindow(row.routeId, row.modelId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  // Save is available once there is something to commit: a changed level editor
  // (a mapping, or the clearing of every stored level), a new context-window
  // value, or the clearing of a stored one. An untouched row stays disabled;
  // "no change" means the part is omitted.
  const parsedCtx = parseContextWindow(ctxDraft)
  const ctxWriting = parsedCtx !== undefined && parsedCtx !== row.contextWindow
  const ctxClearing = ctxDraft === '' && row.contextWindow !== undefined
  const canSave = draftsDirty(drafts, row.efforts) || ctxWriting || ctxClearing

  return (
    <div className={css.modelRow}>
      <div className={css.modelHead}>
        <span className={css.modelName} title={row.modelId}>{row.modelId}</span>
        <button type="button" className={css.secondaryButton} disabled={saving || refreshing} onClick={() => void onRefresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className={css.saveButton} disabled={saving || refreshing || !canSave} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <label className={css.ctxRow}>
        <span className={css.ctxLabel}>Context window</span>
        <input
          type="text"
          inputMode="numeric"
          className={css.ctxInput}
          value={ctxDraft}
          placeholder="unset"
          onFocus={() => { ctxFocused.current = true }}
          onBlur={() => { ctxFocused.current = false }}
          onChange={e => setCtxDraft(e.target.value)}
        />
      </label>
      {error !== undefined && (
        <p className={css.errorNotice} role="alert">{error}</p>
      )}
      <details>
        <summary className={css.accordionSummary}>Reasoning</summary>
        <div className={css.levelRows}>
          {THINKING_LEVELS.map(level => {
            const draft = draftFor(level)
            return (
              <label key={level} className={css.levelRow}>
                <input type="checkbox" checked={draft.offered} onChange={() => toggle(level)} />
                <span className={css.levelName}>{level}</span>
                {level !== 'off' && (
                  <input
                    type="text"
                    className={css.wireInput}
                    value={draft.wire}
                    disabled={!draft.offered}
                    onChange={e => setWire(level, e.target.value)}
                  />
                )}
              </label>
            )
          })}
        </div>
      </details>
    </div>
  )
}
