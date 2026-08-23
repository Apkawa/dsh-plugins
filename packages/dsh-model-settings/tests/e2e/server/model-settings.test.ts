import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startDsh, stopDsh, rpc, warmModel, findRow, ROUTE_ID, MODEL_ID, type DshHandle, type ModelRow } from '../dsh-fixture.ts'

describe('model-settings e2e (live dsh web)', () => {
  let handle: DshHandle | undefined

  beforeAll(async () => {
    handle = await startDsh()
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    const result = await stopDsh(handle)
    expect(result.code).toBe(0)
    expect(result.rootRemoved).toBe(true)
  }, 60_000)

  it('cold: a clean home lists no models and no reasoning rows', async () => {
    const models = await rpc<ModelRow[]>(handle!, 'listModels', {})
    expect(models.ok).toBe(true)
    expect(models.value ?? []).toHaveLength(0)
    const rows = await rpc<ModelRow[]>(handle!, 'listReasoningRows', {})
    expect(rows.ok).toBe(true)
    expect(rows.value ?? []).toHaveLength(0)
  })

  it('warm: saveModel roundtrips efforts + contextWindow through the host', async () => {
    await warmModel(handle!, ROUTE_ID, MODEL_ID)
    const saved = await rpc(handle!, 'saveModel', { routeId: ROUTE_ID, modelId: MODEL_ID, efforts: { low: 'low' }, contextWindow: 16000 })
    expect(saved.ok).toBe(true)
    const rowsRes = await rpc<ModelRow[]>(handle!, 'listReasoningRows', {})
    const row = findRow(rowsRes.value, ROUTE_ID, MODEL_ID)
    expect(row).toBeDefined()
    expect(row?.contextWindow).toBe(16000)
    expect(row?.efforts?.low).toBe('low')
  })
})
