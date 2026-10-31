import { DEFAULT_FONT_SIZE, MIN_STEP_SIZE, defaultsFor, textExtent } from './scene.ts'
import type { EditorTool, Point, ResolvedDefaults, SceneDefaults, ShapeDraft, Transform } from './scene.ts'

/** One drawing gesture: plain state, driven by `{x, y}` points from the input layer. */
export type Gesture = { extend(point: Point): void; finish(): ShapeDraft }

/** Text content comes from the UI, not from the drag — the drag only places the anchor. Embedded newlines are kept as separate lines. */
export type TextGesture = Gesture & { withText(text: string, fontSize?: number): void }

export type DrawingTool = { kind: EditorTool; begin(point: Point, defaults: SceneDefaults): Gesture }
/** A placed label or balloon: the gesture only positions it, the content arrives through `withText`. */
export type TextTool<K extends EditorTool = EditorTool> = { kind: K; begin(point: Point, defaults: SceneDefaults): TextGesture }

export type ToolRegistry = {
  marker: DrawingTool
  highlighter: DrawingTool
  arrow: DrawingTool
  rect: DrawingTool
  text: TextTool<'text'>
  step: DrawingTool
  speech: TextTool<'speech'>
  leader: DrawingTool
}

/** Toolbar order. `select` is a pointer tool: it has no gesture in the drawing registry. */
export const EDITOR_TOOLS: readonly EditorTool[] = ['select', 'marker', 'highlighter', 'arrow', 'rect', 'text', 'step', 'speech', 'leader']

export const toolRegistry: ToolRegistry = {
  marker: { kind: 'marker', begin: (point, base) => freehand('marker', point, defaultsFor('marker', base)) },
  highlighter: {
    kind: 'highlighter',
    begin: (point, base) => freehand('highlighter', point, defaultsFor('highlighter', base)),
  },
  arrow: { kind: 'arrow', begin: (point, base) => arrow(point, defaultsFor('arrow', base)) },
  rect: { kind: 'rect', begin: (point, base) => box('rect', point, defaultsFor('rect', base)) },
  text: { kind: 'text', begin: (point, base) => text(point, defaultsFor('text', base)) },
  // A step stores no payload: the badge's digit is derived from scene order at draw time.
  step: { kind: 'step', begin: (point, base) => box('step', point, defaultsFor('step', base)) },
  speech: { kind: 'speech', begin: (point, base) => speech(point, defaultsFor('speech', base)) },
  leader: { kind: 'leader', begin: (point, base) => leader(point, defaultsFor('leader', base)) },
}

// No font engine in the pure model: the text box is scene.ts's estimate that keeps
// a placed label selectable and stretchable; the renderer measures real glyphs.
function freehand(kind: 'marker' | 'highlighter', point: Point, defaults: ResolvedDefaults): Gesture {
  const points = [point.x, point.y]
  return {
    extend: (next) => {
      points.push(next.x, next.y)
    },
    finish: () => {
      const transform = boxOf(points)
      return {
        kind,
        color: defaults.color,
        width: defaults.width,
        opacity: defaults.opacity,
        transform,
        points: toLocal(points, transform),
      }
    },
  }
}

function arrow(from: Point, defaults: ResolvedDefaults): Gesture {
  let to = from
  return {
    extend: (next) => {
      to = next
    },
    finish: () => {
      const transform = boxOf([from.x, from.y, to.x, to.y])
      return {
        kind: 'arrow',
        color: defaults.color,
        width: defaults.width,
        opacity: defaults.opacity,
        transform,
        from: [from.x - transform.x, from.y - transform.y],
        to: [to.x - transform.x, to.y - transform.y],
      }
    },
  }
}

/** Drag-defined box gesture, shared by rect and step: the drag only sets the bbox; a step clamps it to the minimum badge. */
function box(kind: 'rect' | 'step', origin: Point, defaults: ResolvedDefaults): Gesture {
  let corner = origin
  return {
    extend: (next) => {
      corner = next
    },
    finish: () => ({
      kind,
      color: defaults.color,
      width: defaults.width,
      opacity: defaults.opacity,
      transform: kind === 'step' ? stepBadge(origin, corner) : boxOf([origin.x, origin.y, corner.x, corner.y]),
    }),
  }
}

/** Step bbox clamp: a dragless press is a badge, not a degenerate box, so the diameter never drops below MIN_STEP_SIZE and the badge stays centred on the drag midpoint. */
function stepBadge(origin: Point, corner: Point): Transform {
  const w = Math.max(Math.abs(corner.x - origin.x), MIN_STEP_SIZE)
  const h = Math.max(Math.abs(corner.y - origin.y), MIN_STEP_SIZE)
  const center = { x: (origin.x + corner.x) / 2, y: (origin.y + corner.y) / 2 }
  return { x: center.x - w / 2, y: center.y - h / 2, w, h, rotation: 0 }
}

function text(origin: Point, defaults: ResolvedDefaults): TextGesture {
  let content = ''
  let fontSize = DEFAULT_FONT_SIZE
  return {
    // Dragging places nothing: the label is committed through withText.
    extend: () => {},
    withText: (next, size) => {
      content = next
      fontSize = size ?? DEFAULT_FONT_SIZE
    },
    finish: () => ({
      kind: 'text',
      color: defaults.color,
      width: defaults.width,
      opacity: defaults.opacity,
      text: content,
      fontSize,
      transform: { x: origin.x, y: origin.y, ...textExtent(content, fontSize), rotation: 0 },
    }),
  }
}

/**
 * Speech balloon gesture, mirroring `text`: the click is the tail tip, so the bbox is
 * placed above it (origin = click − (w/2, h)) and the tip is stored bbox-local at
 * (w/2, h). The box follows the text extent, so it grows with the content and font size.
 */
function speech(origin: Point, defaults: ResolvedDefaults): TextGesture {
  let content = ''
  let fontSize = DEFAULT_FONT_SIZE
  return {
    // Dragging places nothing: the balloon is committed through withText, tip at the click.
    extend: () => {},
    withText: (next, size) => {
      content = next
      fontSize = size ?? DEFAULT_FONT_SIZE
    },
    finish: () => {
      const extent = textExtent(content, fontSize)
      return {
        kind: 'speech',
        color: defaults.color,
        width: defaults.width,
        opacity: defaults.opacity,
        text: content,
        fontSize,
        anchor: { x: extent.w / 2, y: extent.h },
        transform: { x: origin.x - extent.w / 2, y: origin.y - extent.h, ...extent, rotation: 0 },
      }
    },
  }
}
/**
 * Callout gesture, like `arrow`: the press pins the dot, the release pins the shelf end.
 * The label is typed after the drag by the UI, so the draft starts with empty text.
 */
function leader(from: Point, defaults: ResolvedDefaults): Gesture {
  let to = from
  return {
    extend: (next) => {
      to = next
    },
    finish: () => {
      const transform = boxOf([from.x, from.y, to.x, to.y])
      return {
        kind: 'leader',
        color: defaults.color,
        width: defaults.width,
        opacity: defaults.opacity,
        transform,
        from: [from.x - transform.x, from.y - transform.y],
        to: [to.x - transform.x, to.y - transform.y],
        text: '',
        fontSize: DEFAULT_FONT_SIZE,
      }
    },
  }
}

function boxOf(points: number[]): Transform {
  const xs = points.filter((_, index) => index % 2 === 0)
  const ys = points.filter((_, index) => index % 2 === 1)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, rotation: 0 }
}

/** Payload slots are flat x,y pairs; even slots are x, odd slots are y. */
function toLocal(points: number[], origin: Transform): number[] {
  return points.map((value, index) => value - (index % 2 === 0 ? origin.x : origin.y))
}
