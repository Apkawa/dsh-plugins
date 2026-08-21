/**
 * Reading and writing a model's `reasoningEfforts` in the `llm-pi-ai` section.
 * Sibling of {@link settings-io} — the same injected {@link SettingsStore} seam,
 * the same revision-fenced write — but for the per-model reasoning mapping the
 * v2 settings section edits. Unlike contextWindow (an autofill that respects a
 * user override), an `reasoningEfforts` edit is always deliberate: the section
 * shows the current mapping and Save writes exactly what it holds.
 *
 * The module stays pure: it plans against the read value, validates against
 * dsh's rules, and persists through the store; orchestration never touches the
 * dsh settings seam directly (SOLID).
 */

import { type LlmModelEntry, type SettingsStore } from './settings-io.ts'

/** The thinking levels dsh offers, in escalation order (mirrors `llm-pi-ai` catalog). */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One offered thinking level. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * A level → wire-value mapping: the on-disk `reasoningEfforts` shape. Only the
 * levels a model offers are present; absent levels are pinned unsupported by dsh.
 * A value of `null` is legal only for `off` (the "send nothing" option).
 */
export type ReasoningEfforts = Partial<Record<ThinkingLevel, string | null>>

/** The outcome of planning one model's reasoningEfforts write. */
export interface EffortsPlanResult {
  /** The next models list (a copy; input is never mutated). */
  models: LlmModelEntry[]
  /** Whether a write is needed at all; false means the mapping is already identical. */
  changed: boolean
}

/** True when two mappings carry the same levels with the same wire values. */
function sameMapping(a: ReasoningEfforts, b: ReasoningEfforts): boolean {
  const ak = (Object.keys(a) as ThinkingLevel[]).slice().sort()
  const bk = (Object.keys(b) as ThinkingLevel[]).slice().sort()
  if (ak.length !== bk.length) return false
  if (!ak.every((k, i) => k === bk[i])) return false
  return ak.every(k => a[k] === b[k])
}

/**
 * Plan how one model's `reasoningEfforts` changes, without touching the store.
 * A model absent from the list is created as `{ id, reasoningEfforts }`; an
 * existing entry has its mapping replaced (an explicit edit always wins); a
 * sibling field (name, contextWindow, …) and every other model are preserved.
 * `changed` is false when the target already carries an identical mapping, so a
 * no-op Save does not churn the revision. An empty mapping is the clear: it
 * writes dsh's explicit non-reasoning spelling (`reasoningEfforts: false`).
 * @param models - the route's current models list.
 * @param modelId - the model to edit.
 * @param efforts - the mapping the section holds (only offered levels; empty = clear).
 */
export function planReasoningWrite(models: readonly LlmModelEntry[], modelId: string, efforts: ReasoningEfforts): EffortsPlanResult {
  const index = models.findIndex(m => m.id === modelId)
  if (Object.keys(efforts).length === 0) return planClear(models, index, modelId)
  if (index === -1) return { models: [...models, { id: modelId, reasoningEfforts: { ...efforts } }], changed: true }
  const existing = models[index]
  const current = existing?.reasoningEfforts as ReasoningEfforts | undefined
  if (current !== undefined && sameMapping(current, efforts)) return { models: [...models], changed: false }
  const next = models.map((m, i) => (i === index ? { ...m, reasoningEfforts: { ...efforts } } : m))
  return { models: next, changed: true }
}

/** Plan a clear: the entry gains dsh's explicit non-reasoning spelling (`reasoningEfforts: false`). */
function planClear(models: readonly LlmModelEntry[], index: number, modelId: string): EffortsPlanResult {
  if (index !== -1 && models[index]?.reasoningEfforts === false) return { models: [...models], changed: false }
  const next = index === -1 ? [...models, { id: modelId, reasoningEfforts: false }] : models.map((m, i) => (i === index ? { ...m, reasoningEfforts: false } : m))
  return { models: next, changed: true }
}

/**
 * Validate an efforts mapping against dsh's resolution rules. Returns one error
 * string per problem; an empty array means the mapping is acceptable. Mirrors
 * `llm-pi-ai`'s `resolveModelReasoning`: at least one thinking level beyond
 * `off`; a `null` wire value only for `off`; no empty-string wire values. An
 * empty mapping is legal on its own — it is the clear (a deliberate
 * non-reasoning model, stored as `reasoningEfforts: false`).
 * @param efforts - the mapping to judge (only offered levels present; empty = clear).
 */
export function validateEfforts(efforts: ReasoningEfforts): string[] {
  if (Object.keys(efforts).length === 0) return [] // the clear is legal even though it offers nothing
  const errors: string[] = []
  let offersNonOff = false
  for (const level of THINKING_LEVELS) {
    const wire = efforts[level]
    if (wire === undefined) continue
    if (wire === null) {
      if (level !== 'off') errors.push(`"${level}" cannot be empty; only "off" may send nothing`)
    } else if (typeof wire === 'string' && wire.length === 0) {
      errors.push(`"${level}" must not be an empty string`)
    } else {
      offersNonOff = true
    }
  }
  if (!offersNonOff) errors.push('offers no thinking level beyond "off"')
  return errors
}

/** True when a thrown error is a settings revision conflict. */
function isConflict(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === 'SETTINGS_CONFLICT'
}

/**
 * Write one model's `reasoningEfforts` through the store with revision fencing.
 * Reads the section, plans the write, and persists it; on a single
 * `SettingsConflictError` it re-reads and retries once, then gives up. A route
 * that is absent from the section, or a mapping already held identical, is
 * skipped quietly. Any other error — including a second conflict or a schema
 * rejection — propagates.
 * @param store - the injected settings seam.
 * @param routeId - the provider route key to write under.
 * @param modelId - the model to edit.
 * @param efforts - the mapping to set (only offered levels).
 */
export async function persistReasoning(
  store: SettingsStore,
  routeId: string,
  modelId: string,
  efforts: ReasoningEfforts,
): Promise<void> {
  let retried = false
  for (;;) {
    const { value, revision } = store.read()
    const route = value.providers?.[routeId]
    if (route === undefined) return // the route is not in the section; skip quietly
    const models = Array.isArray(route.models) ? [...route.models] : []
    const plan = planReasoningWrite(models, modelId, efforts)
    if (!plan.changed) return // the mapping is already correct; do not churn the revision
    try {
      await store.setRouteModels(routeId, plan.models, revision)
      return
    } catch (err) {
      if (isConflict(err) && !retried) {
        retried = true
        continue // re-read and retry once
      }
      throw err
    }
  }
}
