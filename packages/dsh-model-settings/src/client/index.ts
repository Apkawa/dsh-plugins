/**
 * Model-settings plugin, browser half: registers one card in the configurable
 * plugins tab's `settings.plugin.item` slot, keyed by this plugin's namespace.
 * The card appears only when the Host serves that namespace (stage 5 wires it);
 * a deployment without the host half renders nothing here.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ModelSettingsCardController } from './controller.ts'
import { ModelSettingsCard } from './card.tsx'

/** The settings namespace this plugin owns; the card's slot key. */
const NS = 'model-settings'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'connection']

/**
 * Register the model-settings card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ModelSettingsCardController(connection)
  // Populate on mount; the card surfaces a Retry control if this fails early.
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
