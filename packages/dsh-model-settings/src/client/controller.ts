/**
 * The model-settings card controller (browser half): it owns the card's state
 * and every action, all of which reach the Host through the connection's
 * generic RPC channel. The card component only renders this store and calls
 * the face's actions — it never touches settings or fetch itself.
 *
 * The Host half (stage 5) registers the `/model-settings` channel with three
 * endpoints: `listModels`, `fetchProps`, `applyContextWindow`. The channel name
 * is spelled here rather than imported: a client package must not depend on a
 * Host package (client bundle purity).
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** One candidate model row the card renders. */
export interface ModelRow {
  /** The llm-pi-ai route id this model lives under. */
  routeId: string
  /** The model identifier shown to the user. */
  modelId: string
  /** Current contextWindow, if one is set; absent means not captured yet. */
  contextWindow?: number
}

/** Card-level load phase. */
export type CardPhase = 'loading' | 'ready' | 'error'

/** Per-model fetch/apply progress for the «Fetch props» control. */
export interface FetchPreview {
  status: 'fetching' | 'preview' | 'applying' | 'error'
  /** The raw n_ctx reported by /props (informational). */
  nCtx?: number
  /** The rounded-down value that would be written on Apply. */
  rounded?: number
  error?: string
}

/** Everything the card renders, held in one snapshot store. */
export interface ModelSettingsCardState {
  phase: CardPhase
  error?: string
  models: readonly ModelRow[]
  /** Fetch/apply progress keyed by model id. */
  previews: Record<string, FetchPreview>
}

/** The registration-side face the card's slot entry injects. */
export interface ModelSettingsCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as `useModelSettingsCard`. */
    modelSettingsCard: SnapshotStore<ModelSettingsCardState>
  }
  /** (Re)load the candidate model list from the Host. */
  loadModels(): void
  /** Probe one model's /props and surface a rounded preview for Apply. */
  fetchProps(routeId: string, modelId: string): Promise<void>
  /** Write the rounded contextWindow into llm-pi-ai for one model. */
  applyContextWindow(routeId: string, modelId: string, rounded: number): Promise<void>
}

/** The logical RPC channel this plugin owns on the connection transport. */
const CHANNEL = '/model-settings'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Bridges the `/model-settings` Host channel onto the card's snapshot store.
 * One instance per card; created in `apply` and passed to the slot entry.
 */
export class ModelSettingsCardController {
  readonly store: SnapshotStore<ModelSettingsCardState>

  constructor(private readonly connection: ConnectionHandle) {
    this.store = createSnapshotStore({ phase: 'loading', models: [], previews: {} })
  }

  /** The face object the slot registration injects into the card. */
  inject(): ModelSettingsCardFace {
    return {
      hooks: { modelSettingsCard: this.store },
      loadModels: () => { void this.loadModels() },
      fetchProps: (routeId, modelId) => this.fetchProps(routeId, modelId),
      applyContextWindow: (routeId, modelId, rounded) =>
        this.applyContextWindow(routeId, modelId, rounded),
    }
  }

  private setPreview(modelId: string, preview: FetchPreview): void {
    this.store.update(draft => {
      draft.previews = { ...draft.previews, [modelId]: preview }
    })
  }

  async loadModels(): Promise<void> {
    // The phase alone gates the error display; a stale message is harmless.
    this.store.update(draft => {
      draft.phase = 'loading'
    })
    try {
      const models = await this.call<ModelRow[]>('listModels', {})
      this.store.update(draft => {
        draft.phase = 'ready'
        draft.models = models
      })
    } catch (error) {
      this.store.update(draft => {
        draft.phase = 'error'
        draft.error = messageOf(error)
        draft.models = []
      })
    }
  }

  async fetchProps(routeId: string, modelId: string): Promise<void> {
    this.setPreview(modelId, { status: 'fetching' })
    try {
      const preview = await this.call<{ nCtx: number; rounded: number }>('fetchProps', {
        routeId,
        modelId,
      })
      this.setPreview(modelId, {
        status: 'preview',
        nCtx: preview.nCtx,
        rounded: preview.rounded,
      })
    } catch (error) {
      this.setPreview(modelId, { status: 'error', error: messageOf(error) })
    }
  }

  async applyContextWindow(routeId: string, modelId: string, rounded: number): Promise<void> {
    const existing = this.store.getSnapshot().previews[modelId]
    if (existing === undefined || existing.rounded === undefined) return
    this.setPreview(modelId, { ...existing, status: 'applying' })
    try {
      await this.call('applyContextWindow', { routeId, modelId, rounded })
      // The list's contextWindow changes on the Host; refresh it.
      await this.loadModels()
    } catch (error) {
      this.setPreview(modelId, { ...existing, status: 'error', error: messageOf(error) })
    }
  }

  /** One unary call over the plugin-owned channel, unwrapping the RPC result. */
  private async call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await this.connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }
}
