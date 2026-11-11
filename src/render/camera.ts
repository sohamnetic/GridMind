import { clamp } from '../core/math/util'

/** 2D camera: world position at the centre of the view and pixels per metre. */
export interface Camera {
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 30

export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number) {
  return { x: cam.x + (sx - w / 2) / cam.zoom, y: cam.y + (sy - h / 2) / cam.zoom }
}

export function worldToScreen(cam: Camera, w: number, h: number, wx: number, wy: number) {
  return { x: (wx - cam.x) * cam.zoom + w / 2, y: (wy - cam.y) * cam.zoom + h / 2 }
}

/** Sets the canvas transform so drawing happens in world metres. */
export function applyCamera(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  dpr: number,
): void {
  const k = cam.zoom * dpr
  ctx.setTransform(k, 0, 0, k, (w / 2 - cam.x * cam.zoom) * dpr, (h / 2 - cam.y * cam.zoom) * dpr)
}

/** Camera that shows the whole bounding box with some padding (in pixels). */
export function fitCamera(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  w: number,
  h: number,
  padding = 40,
): Camera {
  const bw = Math.max(1, bounds.maxX - bounds.minX)
  const bh = Math.max(1, bounds.maxY - bounds.minY)
  const zoom = clamp(
    Math.min((w - 2 * padding) / bw, (h - 2 * padding) / bh),
    MIN_ZOOM,
    MAX_ZOOM,
  )
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom }
}

/** Zooms by `factor` keeping the world point under the cursor fixed. */
export function zoomAt(cam: Camera, w: number, h: number, sx: number, sy: number, factor: number): Camera {
  const before = screenToWorld(cam, w, h, sx, sy)
  const zoom = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  return {
    zoom,
    x: before.x - (sx - w / 2) / zoom,
    y: before.y - (sy - h / 2) / zoom,
  }
}
