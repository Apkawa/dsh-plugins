import { drawScene } from './render.ts'
import type { Scene } from './scene.ts'

/**
 * Exports the annotated image at its natural size: a canvas kept out of the DOM
 * with a view that fits exactly (scale 1, offset 0), independent of live zoom/pan.
 * `toBlob` on an HTMLCanvasElement is the encoding path the browser type libs
 * expose; an OffscreenCanvas would need extra plumbing for the same result.
 */
export async function renderPng(image: HTMLImageElement, scene: Scene): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  drawScene(ctx, scene, image, { scale: 1, offsetX: 0, offsetY: 0 })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('png encoding failed'))
    }, 'image/png')
  })
}
