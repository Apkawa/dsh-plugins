import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin identity used by the composition row in `cordis.yml`. */
export const name = 'model-settings'

/**
 * Stage-0 apply is intentionally empty. Later v1 stages add, in order:
 * the settings namespace registration, the `/props` probe service, and the
 * new-model watcher that autofills `contextWindow`.
 * @param _ctx - Host context; unused until a later stage wires services.
 */
export function apply(_ctx: Context): void {
  // Intentionally empty in stage 0.
}
