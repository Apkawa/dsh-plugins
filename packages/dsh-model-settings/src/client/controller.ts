/**
 * The model-settings card controller (browser half): it owns the card's state
 * and every action, all of which reach the Host through the connection's
 * generic RPC channel. The card component only renders this store and calls
 * the face's actions — it never touches settings or fetch itself.
 *
 * The Host half registers the `/model-settings` channel with three endpoints:
 * `listModels`, `fetchModels` (one `/v1/models` listing per route), and
 * `applyContextWindows` (a batch write for a route). The channel name is spelled
 * here rather than imported: a client package must not depend on a Host package
 * (client bundle purity).
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

/** Per-route listing progress for the «Fetch models» control. */
export interface RouteListing {
  status: 'fetching' | 'preview' | 'applying' | 'error'
  /** The context sizes fetched from `/v1/models`, keyed by model id. */
  sizes?: Record<string, number>
  error?: string
}

/** Everything the card renders, held in one snapshot store. */
export interface ModelSettingsCardState {
  phase: CardPhase
  error?: string
  models: readonly ModelRow[]
  /** Listing fetch progress keyed by route id. */
  listings: Record<string, RouteListing>
}

/** The registration-side face the card's slot entry injects. */
export interface ModelSettingsCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as `useModelSettingsCard`. */
    modelSettingsCard: SnapshotStore<ModelSettingsCardState>
  }
  /** (Re)load the candidate model list from the Host. */
  loadModels(): void
  /** Fetch a route's `/v1/models` listing and surface per-model sizes for Apply. */
  fetchModels(routeId: string): Promise<void>
  /** Write the fetched contextWindows into llm-pi-ai for a route in one batch. */
  applyContextWindows(routeId: string, windows: Array<{ modelId: string; rounded: number }>): Promise<void>
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
    this.store = createSnapshotStore({ phase: 'loading', models: [], listings: {} })
  }

  /** The face object the slot registration injects into the card. */
  inject(): ModelSettingsCardFace {
    return {
      hooks: { modelSettingsCard: this.store },
      loadModels: () => { void this.loadModels() },
      fetchModels: (routeId) => this.fetchModels(routeId),
      applyContextWindows: (routeId, windows) => this.applyContextWindows(routeId, windows),
    }
  }

  private setListing(routeId: string, listing: RouteListing): void {
    this.store.update(draft => {
      draft.listings = { ...draft.listings, [routeId]: listing }
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

  async fetchModels(routeId: string): Promise<void> {
    this.setListing(routeId, { status: 'fetching' })
    try {
      const result = await this.call<{ models: Array<{ id: string | null; contextWindow: number | null }> }>(
        'fetchModels',
        { routeId },
      )
      const sizes: Record<string, number> = {}
      for (const model of result.models) {
        if (model.id !== null && model.contextWindow !== null) sizes[model.id] = model.contextWindow
      }
      this.setListing(routeId, { status: 'preview', sizes })
    } catch (error) {
      this.setListing(routeId, { status: 'error', error: messageOf(error) })
    }
  }

  async applyContextWindows(routeId: string, windows: Array<{ modelId: string; rounded: number }>): Promise<void> {
    const existing = this.store.getSnapshot().listings[routeId]
    if (existing === undefined) return
    this.setListing(routeId, { ...existing, status: 'applying' })
    try {
      await this.call('applyContextWindows', { routeId, windows })
      // The list's contextWindow changes on the Host; refresh it.
      await this.loadModels()
    } catch (error) {
      this.setListing(routeId, { ...existing, status: 'error', error: messageOf(error) })
    }
  }

  /** One unary call over the plugin-owned channel, unwrapping the RPC result. */
  private async call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await this.connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }
}
