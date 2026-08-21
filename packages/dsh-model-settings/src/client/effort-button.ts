/**
 * Pure client logic for the composer effort button. The button sits in
 * `conversation.input.right` (just left of the model seat) and lets a user switch
 * the current model's reasoning effort without opening the full ModelSelect menu.
 * It reads the session's shared model directory (the same store ModelSelect uses)
 * and submits through it, so host stays the single fact source.
 *
 * The dsh types for the directory come from `@deepseek-ai/dsh-api-remotes`, which is
 * not a declared peer of this plugin; the structural mirrors below match what the
 * live directory store provides at runtime (see ui-model-selection/client/directory.ts).
 */

/** One offered effort level, as the catalog advertises it. */
export interface EffortOption {
  id: string
  name: string
  description?: string
}

/** A model's reasoning metadata (present only when the provider offers efforts). */
export interface ModelReasoningInfo {
  /** The offered effort levels; `off` is always included. */
  efforts: readonly EffortOption[]
  /** The effort used when a selection carries no explicit effort; absent = "provider default". */
  defaultEffort?: string
}

/** A catalog model (only the fields this button needs). */
export interface CatalogModel {
  id: string
  name?: string
  reasoning?: ModelReasoningInfo
}

/** A provider group of models. */
export interface ProviderGroup {
  id: string
  name?: string
  models: readonly CatalogModel[]
}

/** The selection a submit carries to the host. */
export interface Selection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The subset of the directory state this button reads (mirrors ModelDirectoryState). */
export interface DirectoryState {
  /** The current selection; null before the first load. */
  current: Selection | null
  /** Successfully loaded provider groups. */
  groups: readonly ProviderGroup[]
}

/** A row in the effort popup menu. */
export interface EffortChoice {
  key: string
  /** `undefined` = "provider default" (send nothing); otherwise an offered effort id. */
  effort: string | undefined
  label: string
}

/**
 * Find the current model's reasoning info. Returns `undefined` when there is no
 * current selection or the selected model advertises no reasoning — in which case
 * the button renders nothing.
 */
export function currentReasoning(state: DirectoryState): ModelReasoningInfo | undefined {
  const current = state.current
  if (current === null) return undefined
  for (const group of state.groups) {
    if (group.id !== current.provider) continue
    const model = group.models.find(m => m.id === current.model)
    return model?.reasoning
  }
  return undefined
}

/**
 * The effort rows to offer: a "provider default" row (only when the model has no
 * `defaultEffort`) followed by every offered level. Empty when there is no reasoning.
 */
export function effortChoices(reasoning?: ModelReasoningInfo): EffortChoice[] {
  if (reasoning === undefined) return []
  const rows: EffortChoice[] = []
  if (reasoning.defaultEffort === undefined) {
    rows.push({ key: 'provider-default', effort: undefined, label: 'Provider default' })
  }
  for (const effort of reasoning.efforts) {
    rows.push({ key: `effort:${effort.id}`, effort: effort.id, label: effort.name })
  }
  return rows
}

/**
 * The display label for the effective current effort. Falls back to the model's
 * `defaultEffort` when a selection carries no explicit effort; reports "Provider
 * default" when neither exists. Undefined when there is no reasoning.
 */
export function effortLabel(reasoning: ModelReasoningInfo | undefined, current?: Selection): string | undefined {
  if (reasoning === undefined) return undefined
  const effective = current?.reasoningEffort ?? reasoning.defaultEffort
  if (effective === undefined) return 'Provider default'
  return reasoning.efforts.find(e => e.id === effective)?.name ?? effective
}
