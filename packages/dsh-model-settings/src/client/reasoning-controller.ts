/**
 * The reasoning section controller (browser half): it owns the settings section's
 * state and every action, all of which reach the Host through the connection's
 * generic RPC channel — the same seam as the v1 card controller. The section
 * component only renders this store and calls the face's actions; it never
 * touches settings or fetch itself.
 *
 * The Host half serves three endpoints on the shared `/model-settings` channel:
 * `listReasoningRows` (candidate routes' models with their current mapping and
 * contextWindow), `saveModel` (one validated, revision-fenced write of the model's
 * mapping and/or context window) and `refreshContextWindow` (a force-write read from
 * the route's live listing). The channel name is
 * spelled here rather than imported: a client package must not depend on a Host
 * package (client bundle purity).
 *
 * The store is injected (type-only import of the runtime barrel) so this module
 * has no runtime dependency on the client bundle and stays unit-testable in node.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The thinking levels dsh offers, in escalation order (mirrors the Host `efforts` module). */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** A level → wire-value mapping the section edits; only offered levels are present. */
export interface ReasoningEfforts {
  [level: string]: string | null
}

/** One candidate model row the section renders. */
export interface ReasoningRow {
  /** The llm-pi-ai route id this model lives under. */
  routeId: string
  /** The model identifier shown to the user. */
  modelId: string
  /** The current context window, when one is stored; absent means none set yet. */
  contextWindow?: number
  /** The current mapping, when one is set; absent means no levels offered yet. */
  efforts?: ReasoningEfforts
}

/** Section-level load phase. */
export type SectionPhase = 'loading' | 'ready' | 'error'

/** Everything the section renders, held in one snapshot store. */
export interface ReasoningSectionState {
  phase: SectionPhase
  error?: string
  rows: readonly ReasoningRow[]
}

/** The registration-side face the section's slot entry injects. */
export interface ReasoningSectionFace {
  hooks: {
    /** Section snapshot bound by the renderer as `useReasoningSection`. */
    reasoningSection: SnapshotStore<ReasoningSectionState>
  }
  /** (Re)load the candidate model list from the Host. */
  loadRows(): void
  /** Save one model's mapping and/or context window through the Host; throws on an RPC failure. An empty `efforts` clears the mapping, a `null` contextWindow clears its value. */
  save(routeId: string, modelId: string, efforts?: ReasoningEfforts, contextWindow?: number | null): Promise<void>
  /** Re-read one model's context window from its live listing and force-write it; throws on failure. */
  refreshContextWindow(routeId: string, modelId: string): Promise<void>
}

/** The logical RPC channel this plugin owns on the connection transport. */
const CHANNEL = '/model-settings'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One instance per section; created in `apply` (which supplies the store) and
 * passed to the slot entry. The store is injected so the controller's logic is
 * unit-testable without loading the client runtime barrel.
 */
export class ReasoningSectionController {
  readonly store: SnapshotStore<ReasoningSectionState>

  constructor(private readonly connection: ConnectionHandle, store: SnapshotStore<ReasoningSectionState>) {
    this.store = store
  }

  /** The face object the slot registration injects into the section. */
  inject(): ReasoningSectionFace {
    return {
      hooks: { reasoningSection: this.store },
      loadRows: () => { void this.loadRows() },
      save: (routeId, modelId, efforts, contextWindow) => this.save(routeId, modelId, efforts, contextWindow),
      refreshContextWindow: (routeId, modelId) => this.refreshContextWindow(routeId, modelId),
    }
  }

  async loadRows(): Promise<void> {
    this.store.update(draft => {
      draft.phase = 'loading'
    })
    try {
      const rows = await this.call<ReasoningRow[]>('listReasoningRows', {})
      this.store.update(draft => {
        draft.phase = 'ready'
        draft.rows = rows
      })
    } catch (error) {
      this.store.update(draft => {
        draft.phase = 'error'
        draft.error = messageOf(error)
        draft.rows = []
      })
    }
  }

  async save(routeId: string, modelId: string, efforts?: ReasoningEfforts, contextWindow?: number | null): Promise<void> {
    // `null` is the clear part; an absent part (undefined) leaves the stored value untouched.
    const payload: { routeId: string; modelId: string; efforts?: ReasoningEfforts; contextWindow?: number | null } = { routeId, modelId }
    if (efforts !== undefined) payload.efforts = efforts
    if (contextWindow !== undefined) payload.contextWindow = contextWindow
    try {
      await this.call('saveModel', payload)
      // The mapping and/or context window change on the Host; refresh the listing.
      // Rows are preserved across a failed save (the catch leaves them untouched).
      await this.loadRows()
    } catch (error) {
      throw error instanceof Error ? error : new Error(messageOf(error))
    }
  }

  async refreshContextWindow(routeId: string, modelId: string): Promise<void> {
    try {
      await this.call('refreshContextWindow', { routeId, modelId })
      // The context window changes on the Host; refresh the listing. Rows are
      // preserved across a failed refresh (the catch leaves them untouched).
      await this.loadRows()
    } catch (error) {
      throw error instanceof Error ? error : new Error(messageOf(error))
    }
  }

  /** One unary call over the plugin-owned channel, unwrapping the RPC result. */
  private async call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await this.connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }
}
