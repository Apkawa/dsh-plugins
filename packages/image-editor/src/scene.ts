/** Annotation tools; a shape kind is the tool that produced it. `select` is a pointer
 * tool and never produces a shape, so no shape kind carries it. */
export type EditorTool = 'select' | 'marker' | 'highlighter' | 'arrow' | 'rect' | 'text' | 'step' | 'speech' | 'leader'

/** Image-space point. */
export type Point = { x: number; y: number }

/**
 * Image-space bbox: origin corner, size, rotation in radians about the bbox
 * center. Shape payloads are stored in local coords relative to the origin, so
 * a transform moves, stretches and rotates them.
 */
export type Transform = { x: number; y: number; w: number; h: number; rotation: number }

export type SceneDefaults = { color: string; width: number }

/** Scene defaults plus the opacity a kind draws with. */
export type ResolvedDefaults = SceneDefaults & { opacity: number }

type ShapeBase = {
  id: string
  kind: EditorTool
  color: string
  width: number
  opacity: number
  transform: Transform
}

export type FreehandShape = ShapeBase & { kind: 'marker' | 'highlighter'; points: number[] }
export type ArrowShape = ShapeBase & { kind: 'arrow'; from: [number, number]; to: [number, number] }
export type RectShape = ShapeBase & { kind: 'rect'; fill?: string }
export type TextShape = ShapeBase & { kind: 'text'; text: string; fontSize: number }
/** A numbered badge: the digit is derived from scene order at draw time, so the shape stores no payload. */
export type StepShape = ShapeBase & { kind: 'step' }
/** A speech balloon: an ellipse filling the bbox plus a tail converging on `anchor`, which is bbox-local like an arrow endpoint and may lie outside the bbox. */
export type SpeechShape = ShapeBase & { kind: 'speech'; anchor: Point; text: string; fontSize: number }

/**
 * A callout: a dot at `from`, a shaft to `to`, a fixed-length horizontal shelf running from `to`
 * away from the shaft and a label anchored at the shelf's far tip.
 * Endpoints are bbox-local like arrow endpoints; the box is the dot-to-shelf geometry, never the label.
 */
export type LeaderShape = ShapeBase & { kind: 'leader'; from: [number, number]; to: [number, number]; text: string; fontSize: number }

export type Shape = FreehandShape | ArrowShape | RectShape | TextShape | StepShape | SpeechShape | LeaderShape

/** Shape without a minted id yet; an explicit `id` is honoured over the counter. */
export type ShapeDraft =
  | (Omit<FreehandShape, 'id'> & { id?: string })
  | (Omit<ArrowShape, 'id'> & { id?: string })
  | (Omit<RectShape, 'id'> & { id?: string })
  | (Omit<TextShape, 'id'> & { id?: string })
  | (Omit<StepShape, 'id'> & { id?: string })
  | (Omit<SpeechShape, 'id'> & { id?: string })
  | (Omit<LeaderShape, 'id'> & { id?: string })

/** Injectable ID minting — deterministic in tests, never crypto. */
export type IdSource = { nextId(): string }

export type Scene = {
  shapes: readonly Shape[]
  defaults: SceneDefaults
  nextId: () => string
}

export const DEFAULT_COLOR = '#E5484D'
export const HIGHLIGHTER_COLOR = '#FFD666'
export const DEFAULT_WIDTH = 8
export const HIGHLIGHTER_WIDTH = 14
export const DEFAULT_OPACITY = 1
export const HIGHLIGHTER_OPACITY = 0.4
export const DEFAULT_FONT_SIZE = 18
/** A step badge must stay readable: drawStep paints the digit at diameter/2, so the smallest badge is 2× the default font. */
export const MIN_STEP_SIZE = 2 * DEFAULT_FONT_SIZE
export const FONT_SIZE_PRESETS: readonly number[] = [12, 14, 18, 24, 32, 48]

/** Estimated glyph metrics: the pure model has no font engine, so a text box is an estimate the renderer corrects. */
export const GLYPH_WIDTH = 0.6
export const LINE_HEIGHT = 1.5

export const COLOR_PRESETS: readonly string[] = [
  DEFAULT_COLOR,
  HIGHLIGHTER_COLOR,
  '#F5A623',
  '#2F80ED',
  '#27AE60',
  '#9B51E0',
  '#1A1A1A',
  '#FFFFFF',
]

export const WIDTH_PRESETS: readonly number[] = [2, 4, 8, 14]

/** Starting color of each tool: select keeps the yellow highlight color, drawing tools start red. */
export const TOOL_DEFAULT_COLORS: Record<EditorTool, string> = {
  select: HIGHLIGHTER_COLOR,
  marker: DEFAULT_COLOR,
  highlighter: DEFAULT_COLOR,
  arrow: DEFAULT_COLOR,
  rect: DEFAULT_COLOR,
  text: DEFAULT_COLOR,
  step: DEFAULT_COLOR,
  speech: DEFAULT_COLOR,
  leader: DEFAULT_COLOR,
}

export function defaultToolColor(tool: EditorTool): string {
  return TOOL_DEFAULT_COLORS[tool]
}

/** Starting thickness of each tool: the highlighter starts at its own 14 px, the thin-line tools — arrow, rect, leader — plus the step ring at 4 px, every other tool at the default width. */
export const TOOL_DEFAULT_WIDTHS: Record<EditorTool, number> = {
  select: DEFAULT_WIDTH,
  marker: DEFAULT_WIDTH,
  highlighter: HIGHLIGHTER_WIDTH,
  arrow: 4,
  rect: 4,
  text: DEFAULT_WIDTH,
  step: 4,
  speech: DEFAULT_WIDTH,
  leader: 4,
}

export function defaultToolWidth(tool: EditorTool): number {
  return TOOL_DEFAULT_WIDTHS[tool]
}

/** Extent of a label: the widest line sets the width, every line is LINE_HEIGHT tall. */
export function textExtent(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split('\n')
  return {
    w: lines.reduce((widest, line) => Math.max(widest, line.length * GLYPH_WIDTH * fontSize), 0),
    h: lines.length * fontSize * LINE_HEIGHT,
  }
}

/** Callout dot radius as a multiple of the stroke width: thicker than the shaft, so hit and render draw and catch the same dot. */
export const LEADER_DOT_RADIUS_FACTOR = 1.5

/** Fixed shelf length in world px, text-independent: the old text-derived default span. */
export const LEADER_SHELF_LENGTH = 43

/** Gap between the shelf's far tip and the label ink, world px: the label sits past the tip so its ink never overlaps the shelf's. */
export const LEADER_LABEL_GAP = 12

/**
 * Span of a callout shelf: it starts at the shaft tip `to` and runs away from the shaft — rightward
 * on a right drag, leftward on a left drag — for the fixed length, at the shelf's own y. A vertical
 * drag (dx === 0) has no direction to flip on, so it keeps the right span.
 */
export function leaderShelfSpan(from: readonly [number, number], to: readonly [number, number]): { x0: number; x1: number; y: number } {
  if (to[0] - from[0] < 0) return { x0: to[0] - LEADER_SHELF_LENGTH, x1: to[0], y: to[1] }
  return { x0: to[0], x1: to[0] + LEADER_SHELF_LENGTH, y: to[1] }
}

export function counterIds(start = 1): IdSource {
  let n = start
  return { nextId: () => `shape-${n++}` }
}

export function createScene(initial: readonly Shape[] = [], ids: IdSource = counterIds()): Scene {
  return Object.freeze({
    shapes: Object.freeze([...initial]),
    defaults: { color: DEFAULT_COLOR, width: DEFAULT_WIDTH },
    nextId: ids.nextId,
  })
}

/** Kind-specific overrides; the highlighter keeps the chosen color and thickness and overrides only opacity. */
export function defaultsFor(kind: EditorTool, base: SceneDefaults): ResolvedDefaults {
  if (kind === 'highlighter') {
    return { color: base.color, width: base.width, opacity: HIGHLIGHTER_OPACITY }
  }
  return { color: base.color, width: base.width, opacity: DEFAULT_OPACITY }
}

export function addShape(scene: Scene, draft: ShapeDraft): Scene {
  return withShapes(scene, [...scene.shapes, { ...draft, id: draft.id ?? scene.nextId() }])
}

export function removeShape(scene: Scene, id: string): Scene {
  return withShapes(scene, scene.shapes.filter((shape) => shape.id !== id))
}

/** Swap one shape in place; the stacking order is preserved. */
export function replaceShape(scene: Scene, id: string, shape: Shape): Scene {
  return withShapes(scene, scene.shapes.map((existing) => (existing.id === id ? shape : existing)))
}

export function shapesOf(scene: Scene): readonly Shape[] {
  return scene.shapes
}

export function shapeOf(scene: Scene, id: string): Shape | undefined {
  return scene.shapes.find((shape) => shape.id === id)
}

export function setDefaults(scene: Scene, patch: Partial<SceneDefaults>): Scene {
  return Object.freeze({
    shapes: scene.shapes,
    defaults: { color: patch.color ?? scene.defaults.color, width: patch.width ?? scene.defaults.width },
    nextId: scene.nextId,
  })
}

function withShapes(scene: Scene, shapes: readonly Shape[]): Scene {
  return Object.freeze({ shapes: Object.freeze(shapes), defaults: scene.defaults, nextId: scene.nextId })
}
