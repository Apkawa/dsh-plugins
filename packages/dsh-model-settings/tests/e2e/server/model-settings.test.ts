import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  startDsh, stopDsh, rpc, warmModel, findRow, writeSettings, startJsonServer, sleep,
  ROUTE_ID, MODEL_ID,
  type DshHandle, type ModelRow,
} from '../dsh-fixture.ts'

/** A dedicated vision route so the autofill assertions never mix with the warm model's stored parts. */
const VISION_ROUTE_ID = 'e2e-vision'
const VISION_MODEL_ID = 'e2e-vision-model'

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

  it('warm: saveModel roundtrips the input part and the rows expose it', async () => {
    await warmModel(handle!, ROUTE_ID, MODEL_ID)
    const vision = await rpc(handle!, 'saveModel', { routeId: ROUTE_ID, modelId: MODEL_ID, input: ['text', 'image'] })
    expect(vision.ok).toBe(true)
    let rows = await rpc<ModelRow[]>(handle!, 'listReasoningRows', {})
    expect(findRow(rows.value, ROUTE_ID, MODEL_ID)?.input).toEqual(['text', 'image'])
    // the explicit text-only spelling (the checkbox's uncheck) also roundtrips
    const textOnly = await rpc(handle!, 'saveModel', { routeId: ROUTE_ID, modelId: MODEL_ID, input: ['text'] })
    expect(textOnly.ok).toBe(true)
    rows = await rpc<ModelRow[]>(handle!, 'listReasoningRows', {})
    expect(findRow(rows.value, ROUTE_ID, MODEL_ID)?.input).toEqual(['text'])
  })

  it('warm: autofill fills the input from a live listing for a model without an explicit input', async () => {
    const listing = await startJsonServer(JSON.stringify({
      data: [{ id: VISION_MODEL_ID, architecture: { input_modalities: ['text', 'image'] } }],
    }))
    try {
      // A fresh route + model with no stored parts, pointed at the live listing.
      writeSettings(handle!, [
        'llm-pi-ai:',
        '  providers:',
        `    ${VISION_ROUTE_ID}:`,
        '      api: openai-completions',
        `      baseURL: ${listing.url}/v1`,
        '      models:',
        `        - id: ${VISION_MODEL_ID}`,
        '',
      ].join('\n'))
      // The settings watcher schedules the autofill round; poll until the fill lands.
      const deadline = Date.now() + 30_000
      let row: ModelRow | undefined
      while (Date.now() < deadline) {
        const rows = await rpc<ModelRow[]>(handle!, 'listReasoningRows', {})
        row = findRow(rows.value, VISION_ROUTE_ID, VISION_MODEL_ID)
        if (row?.input !== undefined) break
        await sleep(500)
      }
      expect(row?.input).toEqual(['text', 'image'])
      expect(row?.contextWindow).toBeUndefined() // the listing carries no ctx-size
    } finally {
      await listing.stop()
    }
  })
})
