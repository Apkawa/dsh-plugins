/** Public API of the standalone editor: pure scene model + drawing tools. */

export type { EditorTool, IdSource, Point, Scene, SceneDefaults, Transform } from './scene.ts'
export type { ArrowShape, FreehandShape, LeaderShape, RectShape, ResolvedDefaults, Shape, ShapeDraft, SpeechShape, StepShape, TextShape } from './scene.ts'
export type { DrawingTool, Gesture, TextGesture, TextTool, ToolRegistry } from './tools.ts'
export type { EndpointEnd, Handle, HandleId, ResizeHandle } from './transform.ts'
export type { ShapeHit } from './hit.ts'
export type { History } from './undo.ts'
export type { View, ViewBounds, Viewport } from './view.ts'
export type { ImageSource } from './render.ts'
export type { InputApi } from './input.ts'
export type { EditorDebugState, ImageEditorController, ImageEditorOptions } from './editor.ts'

export {
  COLOR_PRESETS,
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_OPACITY,
  DEFAULT_WIDTH,
  FONT_SIZE_PRESETS,
  GLYPH_WIDTH,
  HIGHLIGHTER_COLOR,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTH,
  LEADER_LABEL_GAP,
  LEADER_SHELF_LENGTH,
  LINE_HEIGHT,
  TOOL_DEFAULT_COLORS,
  TOOL_DEFAULT_WIDTHS,
  WIDTH_PRESETS,
  addShape,
  counterIds,
  createScene,
  defaultToolColor,
  defaultToolWidth,
  defaultsFor,
  leaderShelfSpan,
  removeShape,
  replaceShape,
  shapeOf,
  shapesOf,
  setDefaults,
  textExtent,
} from './scene.ts'

export { EDITOR_TOOLS, toolRegistry } from './tools.ts'

export {
  MIN_SHAPE_SIZE,
  ROTATE_HANDLE_GAP,
  cursorFor,
  editEndpoint,
  handlePoints,
  localToWorld,
  moveShape,
  resizeShape,
  rotateShape,
  withFontSize,
  worldToLocal,
} from './transform.ts'

export { hitHandle, hitShape, shapesWithin, topShapeAt } from './hit.ts'

export { createHistory } from './undo.ts'

export { MAX_SCALE, MIN_SCALE, clampView, clampToWorld, createView, fitView, pan, screenToWorld, worldToScreen, zoomAt } from './view.ts'

export { drawScene, resizeCanvas } from './render.ts'

export { renderPng } from './export.ts'

export { attachInput } from './input.ts'

export { mountImageEditor } from './editor.ts'
