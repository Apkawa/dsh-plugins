/**
 * The `settings.plugin.item` slot type this card registers into.
 *
 * Declared here (type-only) so the client half can reference the slot without a
 * value import of the container plugin — mirroring how the container ships its
 * own copy beside its declaration. The augmentation is erased at bundle time;
 * nothing in `index.ts` imports this file, so it never rides the artifact.
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the configurable-plugins tab, keyed by namespace. */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: ModelSettingsItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface ModelSettingsItemOwnerProps {
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** A top-level settings page; the shell renders these as ordered nav rows. */
    'settings.section': { kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps }
    /** The composer's trailing accessory row, rendered just left of the model seat (session-scoped). */
    'conversation.input.right': { kind: 'list'; scope: 'session' }
  }
}

/** Owner share of a settings section (the shell supplies `close`; this section does not use it). */
export interface SettingsSectionOwnerProps {
  close: () => void
}
