/**
 * One commit for the fields the v2 settings section edits together: a model's
 * `contextWindow` (explicit overwrite), its `reasoningEfforts` mapping, and its
 * `input` modality list. Composes the pure planners — {@link planContextWindowOverwrite},
 * {@link planReasoningWrite}, and {@link planInputOverwrite} — into a single
 * planned models list, so one Save is one revision-fenced write. Lives in its
 * own module (rather than in settings-io) because it depends on both siblings;
 * the store seam, the fencing and the retry rule are the same as everywhere
 * else in this package.
 */

import { planReasoningWrite, type ReasoningEfforts } from './efforts.ts'
import { planContextWindowOverwrite, planInputOverwrite, type LlmModelEntry, type SettingsStore } from './settings-io.ts'

/** The parts of one model a Save may commit; an absent part is left untouched. */
export interface ModelSaveParts {
  /** The mapping to replace (only offered levels); omitted leaves the stored mapping as-is. An empty mapping clears it. */
  efforts?: ReasoningEfforts
  /** The contextWindow to store (explicit overwrite); omitted leaves the stored value as-is. `null` clears it. */
  contextWindow?: number | null
  /** The `input` modality list to store (explicit overwrite); omitted leaves the stored list as-is. */
  input?: string[]
}

/** The outcome of planning one model's combined save. */
export interface ModelSavePlanResult {
  /** The next models list (a copy; input is never mutated). */
  models: LlmModelEntry[]
  /** Whether a write is needed at all; false means every provided part already matches. */
  changed: boolean
}

/**
 * Plan one model's combined save without touching the store. Each provided part
 * is planned in turn against the running models list, so an absent model ends
 * up as a single merged entry. `changed` is false only when every provided part
 * already matches, so a no-op Save does not churn the revision.
 * @param models - the route's current models list.
 * @param modelId - the model to edit.
 * @param parts - which fields to commit; at least one is expected by callers.
 */
export function planModelSave(models: readonly LlmModelEntry[], modelId: string, parts: ModelSaveParts): ModelSavePlanResult {
  let current = [...models]
  let changed = false
  if (parts.contextWindow !== undefined) {
    // `null` is the clear: drop the key so dsh falls back to its own resolution.
    const ctx = parts.contextWindow === null ? clearContextWindow(current, modelId) : planContextWindowOverwrite(current, modelId, parts.contextWindow)
    current = ctx.models
    changed = changed || ctx.changed
  }
  if (parts.efforts !== undefined) {
    const efforts = planReasoningWrite(current, modelId, parts.efforts)
    current = efforts.models
    changed = changed || efforts.changed
  }
  if (parts.input !== undefined) {
    const input = planInputOverwrite(current, modelId, parts.input)
    current = input.models
    changed = changed || input.changed
  }
  return { models: current, changed }
}

/** Plan the context-window clear: drop the stored key (an absent model has nothing to clear). */
function clearContextWindow(models: readonly LlmModelEntry[], modelId: string): ModelSavePlanResult {
  const index = models.findIndex(m => m.id === modelId)
  if (index === -1 || models[index]?.contextWindow === undefined) return { models: [...models], changed: false }
  const next = models.map((m, i) => {
    if (i !== index) return m
    const { contextWindow: _dropped, ...rest } = m
    return rest
  })
  return { models: next, changed: true }
}

/** True when a thrown error is a settings revision conflict. */
function isConflict(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === 'SETTINGS_CONFLICT'
}

/**
 * Write one model's combined save through the store with revision fencing.
 * Reads the section, plans the write, and persists it; on a single
 * `SettingsConflictError` it re-reads and retries once, then gives up. A route
 * that is absent from the section, or a save where every part already matches,
 * is skipped quietly. Any other error — including a second conflict or a schema
 * rejection — propagates.
 * @param store - the injected settings seam.
 * @param routeId - the provider route key to write under.
 * @param modelId - the model to edit.
 * @param parts - which fields to commit.
 */
export async function persistModelSave(
  store: SettingsStore,
  routeId: string,
  modelId: string,
  parts: ModelSaveParts,
): Promise<void> {
  let retried = false
  for (;;) {
    const { value: section, revision } = store.read()
    const route = section.providers?.[routeId]
    if (route === undefined) return // the route is not in the section; skip quietly
    const models = Array.isArray(route.models) ? [...route.models] : []
    const plan = planModelSave(models, modelId, parts)
    if (!plan.changed) return // every part already matches; do not churn the revision
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
