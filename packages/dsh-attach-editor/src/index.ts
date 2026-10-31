/**
 * The attach-editor plugin, host face. The row exists so the browser half can
 * register the "Annotate image" right-sidebar tab; the host keeps only the
 * scratch directory that later stages write staged edit artifacts into.
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export const name = 'attach-editor'

export interface Config {
  scratchDir: string
}

export const Config: z<Config> = z.object({
  /** Directory for staged edit artifacts (default: $DSH_HOME/attach-editor). */
  scratchDir: z.string().default(join(resolveDshHome(), 'attach-editor')),
})

/**
 * Activate the row. Nothing is mounted yet — the attachment-replacement host
 * half arrives with the rail stage.
 * @param _ctx - the host plugin context (unused this stage).
 * @param config - the validated row config.
 */
export async function apply(_ctx: Context, config: Config): Promise<() => void> {
  void config
  return () => {}
}
