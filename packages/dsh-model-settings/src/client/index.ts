/**
 * Model-settings plugin, browser half. It registers three things:
 *  - the v2 reasoning SECTION — a top-level settings page that edits each model's
 *    per-level thinking mapping (the primary feature; always on);
 *  - the v2 composer EFFORT BUTTON in `conversation.input.right` (always on; reads
 *    the session's shared model directory, provided by ui-model-selection);
 *  - the v1 contextWindow CARD in the plugins tab (disabled while host autofill is
 *    the only writer; kept verbatim below).
 * A deployment without the Host half renders nothing useful here.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ModelSettingsCardController } from './controller.ts'
import { ModelSettingsCard } from './card.tsx'
import { ReasoningSectionController } from './reasoning-controller.ts'
import { ReasoningSection } from './ReasoningSection.tsx'
import { EffortButton, type EffortButtonFace } from './EffortButton.tsx'
import type { DirectoryState, Selection } from './effort-button.ts'

/** The settings namespace this plugin owns; the card's slot key. */
const NS = 'model-settings'

/**
 * The v1 card is disabled while the host autofill is the only contextWindow writer:
 * it fills the provider's models in settings, and the existing Models UI displays
 * them. Flip to true to re-enable the manual-trigger card (kept verbatim below).
 */
const CLIENT_ENABLED = false

/**
 * The model-directory service as ui-model-selection exposes it. This plugin cannot
 * import `ModelDirectoryResolver` (not a declared peer), so the structural mirrors
 * name only what the button reads; the live objects satisfy them.
 */
interface ModelDirectory {
  store: SnapshotStore<DirectoryState>
  load(): Promise<unknown>
  select(selection: Selection): Promise<unknown>
}

interface ModelDirectoriesResolver {
  directoryFor(sessionId: string): ModelDirectory
}

/** The client-side forwarded-event seam (the `remote` service from dsh-api-gateway), as this plugin consumes it. Structural mirror: the client bundle must not depend on dsh-api-remotes, so only the subscription this plugin uses is named here. */
interface RemoteEvents {
  $on(event: 'settings/document-updated', listener: (ns: string, revision: number) => void): () => void
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'connection', 'remote']

/**
 * Register the reasoning section + composer effort button (v2) and, when enabled,
 * the v1 card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle

  // The reasoning section: a top-level settings page editing per-model mappings.
  // It owns its store (created here, injected into the controller) and one face.
  const reasoningController = new ReasoningSectionController(
    connection,
    createSnapshotStore({ phase: 'loading', rows: [] }),
  )
  // Populate on mount; the section surfaces a Retry control if this fails early.
  void reasoningController.loadRows()

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: NS, order: 15, label: 'Model settings', inject: () => reasoningController.inject() },
      ReasoningSection,
    ),
  )

  // The llm-pi-ai section changes outside this section too: the standard Models
  // UI or a settings-file edit commits it on the Host, which then forwards
  // settings/document-updated. Re-list silently so the section tracks the change
  // without a loading flash. The ns string mirrors the Host LLM_NS: the client
  // bundle must not import the Host half, and rows derive only from that section.
  const remote = ctx.get('remote') as RemoteEvents
  ctx.effect(
    () =>
      remote.$on('settings/document-updated', (ns) => {
        if (ns !== 'llm-pi-ai') return
        void reasoningController.refreshRows()
      }),
    'model-settings: external model refresh',
  )

  if (!CLIENT_ENABLED) return
  // The composer effort button: sits in `conversation.input.right` (left of the
  // model seat) over the SAME shared directory ModelSelect uses. The directory is
  // provided by ui-model-selection; read it defensively so a deployment without
  // that package simply has no button rather than failing to load.

  // WARNING: Я отключил EffortButton, оно пока нам ни к чему,
  // но удалять пока жалко, может быть мы придумаем какую то функциональность
  ctx.inject(['slots', 'modelDirectories'], scope => {
    const models = (scope as unknown as { modelDirectories?: ModelDirectoriesResolver }).modelDirectories
    if (models === undefined) return
    scope.slots.inject('conversation.input.right', () =>
      scope.slots.register(
        {
          name: 'conversation.input.right',
          id: 'reasoning-effort',
          order: 0,
          inject: (sessionId): EffortButtonFace => {
            const directory = models.directoryFor(sessionId)
            return {
              hooks: { directory: directory.store },
              load: () => {
                void directory.load()
              },
              select: selection => directory.select(selection).then(() => true, () => false),
            }
          },
        },
        EffortButton,
      ),
    )
  })

  // The v1 card (disabled while autofill is the only contextWindow writer).
  const controller = new ModelSettingsCardController(connection)
  void controller.loadModels()

  // The callback is a generator yielding the registration disposer, so fiber
  // unload cascades the card entry out of the slot (see SlotRegistry.inject).
  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register(
      { name: 'settings.plugin.item', key: NS, inject: () => controller.inject() },
      ModelSettingsCard,
    )
  })
}
