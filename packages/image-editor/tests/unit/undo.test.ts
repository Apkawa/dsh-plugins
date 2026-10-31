import { describe, expect, it } from 'vitest'
import { createHistory } from '../../src/undo.ts'
import { createScene } from '../../src/scene.ts'
import type { Scene } from '../../src/scene.ts'

function sceneNamed(id: string): Scene {
  return createScene([
    {
      id,
      kind: 'rect',
      color: '#1A1A1A',
      width: 4,
      opacity: 1,
      transform: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
    },
  ])
}

describe('undo history', () => {
  it('returns null and cannot undo when empty', () => {
    const history = createHistory()
    expect(history.canUndo()).toBe(false)
    expect(history.undo()).toBeNull()
    expect(history.current()).toBeNull()
  })

  it('cannot undo a lone snapshot', () => {
    const history = createHistory()
    const first = sceneNamed('a')
    history.push(first)
    expect(history.current()).toBe(first)
    expect(history.canUndo()).toBe(false)
    expect(history.undo()).toBeNull()
    expect(history.current()).toBe(first)
  })

  it('undo restores the previously pushed scene by identity', () => {
    const history = createHistory()
    const first = sceneNamed('a')
    const second = sceneNamed('b')
    history.push(first)
    history.push(second)
    expect(history.canUndo()).toBe(true)
    expect(history.undo()).toBe(first)
    expect(history.current()).toBe(first)
  })

  it('unwinds multiple pushes in reverse order', () => {
    const history = createHistory()
    const scenes = [sceneNamed('a'), sceneNamed('b'), sceneNamed('c')]
    scenes.forEach((scene) => history.push(scene))
    expect(history.undo()).toBe(scenes[1])
    expect(history.undo()).toBe(scenes[0])
    expect(history.undo()).toBeNull()
    expect(history.canUndo()).toBe(false)
    expect(history.current()).toBe(scenes[0])
  })

  it('drops the oldest snapshots beyond the limit', () => {
    const history = createHistory(3)
    const scenes = [sceneNamed('a'), sceneNamed('b'), sceneNamed('c'), sceneNamed('d')]
    scenes.forEach((scene) => history.push(scene))
    expect(history.current()).toBe(scenes[3])
    expect(history.undo()).toBe(scenes[2])
    expect(history.undo()).toBe(scenes[1])
    expect(history.undo()).toBeNull()
    expect(history.current()).toBe(scenes[1])
  })

  it('defaults to a limit of 100 snapshots', () => {
    const history = createHistory()
    const scenes = Array.from({ length: 105 }, (_, index) => sceneNamed(`s${index}`))
    scenes.forEach((scene) => history.push(scene))
    let unwound = 0
    while (history.canUndo()) {
      history.undo()
      unwound += 1
    }
    // 100 kept snapshots unwind down to the single oldest surviving one.
    expect(unwound).toBe(99)
    expect(history.current()).toBe(scenes[5])
  })
})
