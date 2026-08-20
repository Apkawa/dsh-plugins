/**
 * The model-settings card: a list of the OpenAI-compatible routes, each showing
 * its models with their current contextWindow and a «Fetch models» control. Fetching
 * lists the route's `/v1/models` on the Host (each entry's `ctx-size`/`fit-ctx`
 * parsed to a size); Apply writes the sizes for the still-unsized models in one
 * batch. The autofill watcher already does this on model add/edit; the card is the
 * manual path.
 *
 * The component is deliberately dumb — every value comes from the injected snapshot
 * store and every action delegates to the controller face, so this file holds no
 * settings or fetch logic of its own.
 */

import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelRow, ModelSettingsCardFace, RouteListing } from './controller.ts'

/** The composed props the slot dispatcher hands the card. */
type CardProps = InjectFace<ModelSettingsCardFace>

/** A route's models grouped for display. */
interface RouteGroup {
  routeId: string
  models: readonly ModelRow[]
}

/** Group the flat model rows by their route, preserving first-seen order. */
function groupByRoute(models: readonly ModelRow[]): RouteGroup[] {
  const order: string[] = []
  const byRoute = new Map<string, ModelRow[]>()
  for (const model of models) {
    const bucket = byRoute.get(model.routeId)
    if (bucket === undefined) {
      order.push(model.routeId)
      byRoute.set(model.routeId, [model])
    } else {
      bucket.push(model)
    }
  }
  return order.map(routeId => ({ routeId, models: byRoute.get(routeId)! }))
}

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
      {groupByRoute(state.models).map(group => (
        <li key={group.routeId}>
          <RouteRow routeId={group.routeId} models={group.models} listing={state.listings[group.routeId]} props={props} />
        </li>
      ))}
    </ul>
  )
}

/** One route: its models, a «Fetch models» control, and a batch Apply. */
function RouteRow({
  routeId,
  models,
  listing,
  props,
}: {
  routeId: string
  models: readonly ModelRow[]
  listing: RouteListing | undefined
  props: CardProps
}) {
  // The models that would be written: a fetched size present but no contextWindow yet.
  const pending: Array<{ modelId: string; rounded: number }> = []
  if (listing?.sizes !== undefined) {
    for (const m of models) {
      const size = listing.sizes[m.modelId]
      if (size !== undefined && m.contextWindow === undefined) pending.push({ modelId: m.modelId, rounded: size })
    }
  }

  return (
    <div>
      <strong>{routeId}</strong>
      <ul>
        {models.map(model => (
          <li key={model.modelId}>
            <span>{model.modelId}</span>{' '}
            <span>ctx: {model.contextWindow ?? '—'}</span>
          </li>
        ))}
      </ul>

      {listing?.status === 'fetching' && <span>Fetching models…</span>}
      {listing?.status === 'error' && (
        <span role="alert">{listing.error ?? 'Fetch failed.'}</span>
      )}
      {listing?.status !== 'fetching' && listing?.status !== 'applying' && (
        <button type="button" onClick={() => props.fetchModels(routeId)}>
          Fetch models
        </button>
      )}
      {pending.length > 0 && (
        <>
          <span>{pending.length} to fill</span>{' '}
          <button
            type="button"
            disabled={listing?.status === 'applying'}
            onClick={() => props.applyContextWindows(routeId, pending)}
          >
            {listing?.status === 'applying' ? 'Applying…' : 'Apply'}
          </button>
        </>
      )}
    </div>
  )
}
