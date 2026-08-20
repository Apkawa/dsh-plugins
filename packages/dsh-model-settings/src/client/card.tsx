/**
 * The model-settings card: a list of the OpenAI-compatible routes' models, each
 * showing its current contextWindow and a «Fetch props» control. Fetching probes
 * the model's /props on the Host (rounded-down n_ctx preview); Apply writes it.
 *
 * The component is deliberately dumb — every value comes from the injected
 * snapshot store and every action delegates to the controller face, so this file
 * holds no settings or fetch logic of its own.
 */

import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { FetchPreview, ModelRow, ModelSettingsCardFace } from './controller.ts'

/** The composed props the slot dispatcher hands the card. */
type CardProps = InjectFace<ModelSettingsCardFace>

export function ModelSettingsCard(props: CardProps) {
  const state = props.useModelSettingsCard(snapshot => snapshot)

  if (state.phase === 'loading') return <p>Loading models…</p>

  if (state.phase === 'error') {
    return (
      <div role="alert">
        <span>{state.error ?? 'Failed to load models.'}</span>{' '}
        <button type="button" onClick={() => props.loadModels()}>Retry</button>
      </div>
    )
  }

  if (state.models.length === 0) return <p>No OpenAI-compatible routes configured.</p>

  return (
    <ul>
      {state.models.map(model => (
        <li key={`${model.routeId}:${model.modelId}`}>
          <ModelRowBody model={model} preview={state.previews[model.modelId]} props={props} />
        </li>
      ))}
    </ul>
  )
}

/** One row: the model id, its current contextWindow, and the fetch/apply control. */
function ModelRowBody({
  model,
  preview,
  props,
}: {
  model: ModelRow
  preview: FetchPreview | undefined
  props: CardProps
}) {
  const applying = preview?.status === 'applying'

  return (
    <div>
      <span>{model.modelId}</span>{' '}
      <span>ctx: {model.contextWindow ?? '—'}</span>{' '}
      {preview?.status === 'fetching' && <span>Fetching…</span>}
      {preview?.status === 'error' && (
        <span role="alert">{preview.error ?? 'Fetch failed.'}</span>
      )}
      {(preview?.status === 'preview' || applying) && preview.rounded !== undefined && (
        <>
          <span>n_ctx={preview.nCtx} → {preview.rounded}</span>{' '}
          <button
            type="button"
            disabled={applying}
            onClick={() => props.applyContextWindow(model.routeId, model.modelId, preview.rounded ?? 0)}
          >
            Apply
          </button>
        </>
      )}
      {preview?.status !== 'fetching' && (
        <button type="button" onClick={() => props.fetchProps(model.routeId, model.modelId)}>
          Fetch props
        </button>
      )}
    </div>
  )
}
