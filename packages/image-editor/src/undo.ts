import type { Scene } from './scene.ts'

export type History = {
  push(scene: Scene): void
  undo(): Scene | null
  current(): Scene | null
  canUndo(): boolean
}

/** Snapshot history over immutable scenes — the scene reference itself is stored. */
export function createHistory(limit = 100): History {
  const snapshots: Scene[] = []
  return {
    push: (scene) => {
      if (snapshots.length >= limit) snapshots.shift()
      snapshots.push(scene)
    },
    // Undo drops the newest snapshot and reveals the one below it; a lone
    // snapshot has nothing to revert to, so it stays put.
    undo: () => {
      if (snapshots.length <= 1) return null
      snapshots.pop()
      return snapshots.at(-1) ?? null
    },
    current: () => snapshots.at(-1) ?? null,
    canUndo: () => snapshots.length > 1,
  }
}
