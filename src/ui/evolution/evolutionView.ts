import { CarStatus } from '../../core/evolution/episode'
import type { BuiltTrack } from '../../core/track/types'
import { applyCamera, fitCamera, worldToScreen, zoomAt, type Camera } from '../../render/camera'
import { drawTrack, TRACK_COLORS, type TrackPaths } from '../../render/trackRenderer'
import { liveFrame } from '../../state/evolutionStore'
import { FRAME_STRIDE } from '../../workers/trainingProtocol'

const LEADER_COLOR = '#ff5a36'
const CAR_COLOR = 'rgba(233, 237, 245, 0.75)'
const OUT_COLOR = 'rgba(216, 65, 58, 0.55)'

/** Car positions to draw: the object is mutated in place by whoever receives worker frames. */
export interface FrameSource {
  seq: number
  leader: number
  cars: Float32Array | null
}

/** Per-car colours and labels, for races where each car is somebody. */
export interface CarStyle {
  colors: readonly string[]
  labels: readonly string[]
}

/**
 * Draws the training view: the track and ghost line on a cached layer, and
 * the whole population on top, every animation frame.
 */
export class EvolutionView {
  private readonly ctx: CanvasRenderingContext2D
  private readonly layer = document.createElement('canvas')
  private layerDirty = true
  private cam: Camera = { x: 0, y: 0, zoom: 1 }
  private w = 1
  private h = 1
  private dpr = 1
  private track: BuiltTrack | null = null
  private paths: TrackPaths | null = null
  private ghost: Float32Array | null = null
  private userView = false
  private raf = 0
  private lastSeq = -1
  private drag: { sx: number; sy: number; camX: number; camY: number } | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly source: FrameSource = liveFrame,
    private readonly style: CarStyle | null = null,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not available')
    this.ctx = ctx
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('dblclick', this.onDoubleClick)
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    const c = this.canvas
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerUp)
    c.removeEventListener('wheel', this.onWheel)
    c.removeEventListener('dblclick', this.onDoubleClick)
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
    this.dpr = dpr
    this.canvas.width = this.layer.width = Math.round(this.w * dpr)
    this.canvas.height = this.layer.height = Math.round(this.h * dpr)
    if (!this.userView) this.fit()
    this.layerDirty = true
  }

  setTrack(track: BuiltTrack | null, paths: TrackPaths | null): void {
    this.track = track
    this.paths = paths
    this.userView = false
    this.fit()
    this.layerDirty = true
  }

  setGhost(ghost: Float32Array | null): void {
    this.ghost = ghost
    this.layerDirty = true
  }

  private fit(): void {
    if (this.track && this.w > 1) this.cam = fitCamera(this.track.bounds, this.w, this.h, 36)
    this.userView = false
    this.layerDirty = true
  }

  // ---------------------------------------------------------------- input

  private local(e: PointerEvent | WheelEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    const p = this.local(e)
    this.drag = { sx: p.x, sy: p.y, camX: this.cam.x, camY: this.cam.y }
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture is optional.
    }
    this.canvas.style.cursor = 'grabbing'
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return
    const p = this.local(e)
    this.cam.x = this.drag.camX - (p.x - this.drag.sx) / this.cam.zoom
    this.cam.y = this.drag.camY - (p.y - this.drag.sy) / this.cam.zoom
    this.userView = true
    this.layerDirty = true
  }

  private readonly onPointerUp = (): void => {
    this.drag = null
    this.canvas.style.cursor = 'grab'
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const p = this.local(e)
    this.cam = zoomAt(this.cam, this.w, this.h, p.x, p.y, Math.exp(-e.deltaY * 0.0015))
    this.userView = true
    this.layerDirty = true
  }

  private readonly onDoubleClick = (): void => this.fit()

  // -------------------------------------------------------------- drawing

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame)
    const source = this.source
    if (!this.layerDirty && source.seq === this.lastSeq) return
    this.lastSeq = source.seq
    if (this.layerDirty) this.drawLayer()

    const { ctx, dpr, cam } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(this.layer, 0, 0)
    const cars = source.cars
    if (!cars || !this.track) return

    applyCamera(ctx, cam, this.w, this.h, dpr)
    // Cars are tiny at full-track zoom, so never draw them under ~7 px long.
    const size = Math.max(5.4, 7 / cam.zoom)
    const count = cars.length / FRAME_STRIDE

    // Retired cars first, as faint marks where they stopped.
    ctx.fillStyle = OUT_COLOR
    for (let i = 0; i < count; i++) {
      const o = i * FRAME_STRIDE
      const status = cars[o + 3]
      if (status === CarStatus.Running || status === CarStatus.Finished || status === CarStatus.TimedOut) continue
      ctx.beginPath()
      ctx.arc(cars[o], cars[o + 1], size * 0.22, 0, Math.PI * 2)
      ctx.fill()
    }

    const style = this.style
    if (style) {
      // A race: every car in its team colour, outlined so it reads on any surface.
      ctx.strokeStyle = '#0b0e14'
      ctx.lineWidth = size * 0.1
      for (let i = 0; i < count; i++) {
        const o = i * FRAME_STRIDE
        if (cars[o + 3] !== CarStatus.Running) continue
        ctx.fillStyle = style.colors[i] ?? CAR_COLOR
        this.arrow(cars[o], cars[o + 1], cars[o + 2], size * 1.25)
        ctx.stroke()
      }
    } else {
      ctx.fillStyle = CAR_COLOR
      for (let i = 0; i < count; i++) {
        const o = i * FRAME_STRIDE
        if (cars[o + 3] !== CarStatus.Running || i === source.leader) continue
        this.arrow(cars[o], cars[o + 1], cars[o + 2], size)
      }
    }

    // The leader gets a ring (and, in training, the accent colour).
    const lo = source.leader * FRAME_STRIDE
    if (lo < cars.length && cars[lo + 3] === CarStatus.Running) {
      if (!style) {
        ctx.fillStyle = LEADER_COLOR
        this.arrow(cars[lo], cars[lo + 1], cars[lo + 2], size * 1.35)
      }
      ctx.strokeStyle = style ? '#ffffff' : LEADER_COLOR
      ctx.lineWidth = size * 0.12
      ctx.beginPath()
      ctx.arc(cars[lo], cars[lo + 1], size * 1.6, 0, Math.PI * 2)
      ctx.stroke()
    }

    if (style) {
      // Driver codes beside the cars, in screen space so they stay readable.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = '600 10px ui-monospace, Consolas, monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < count; i++) {
        const o = i * FRAME_STRIDE
        if (cars[o + 3] !== CarStatus.Running) continue
        const p = worldToScreen(cam, this.w, this.h, cars[o], cars[o + 1])
        ctx.fillStyle = 'rgba(11, 14, 20, 0.7)'
        ctx.fillRect(p.x + 7, p.y - 13, 24, 11)
        ctx.fillStyle = style.colors[i] ?? '#e9edf5'
        ctx.fillText(style.labels[i] ?? '', p.x + 9, p.y - 7)
      }
    }
  }

  private arrow(x: number, y: number, heading: number, size: number): void {
    const { ctx } = this
    const c = Math.cos(heading)
    const s = Math.sin(heading)
    const half = size / 2
    const wide = size * 0.3
    ctx.beginPath()
    ctx.moveTo(x + c * half, y + s * half)
    ctx.lineTo(x - c * half - s * wide, y - s * half + c * wide)
    ctx.lineTo(x - c * half + s * wide, y - s * half - c * wide)
    ctx.closePath()
    ctx.fill()
  }

  /** Track and ghost line change rarely, so they are drawn once and reused. */
  private drawLayer(): void {
    this.layerDirty = false
    const ctx = this.layer.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = TRACK_COLORS.ground
    ctx.fillRect(0, 0, this.layer.width, this.layer.height)
    if (!this.paths) return

    applyCamera(ctx, this.cam, this.w, this.h, this.dpr)
    drawTrack(ctx, this.paths, { showCentreLine: false, zoom: this.cam.zoom })

    const ghost = this.ghost
    if (!ghost || ghost.length < 6) return
    // Colour the line by speed: blue in slow corners through to yellow flat out.
    let top = 1
    for (let i = 2; i < ghost.length; i += 3) top = Math.max(top, ghost[i])
    ctx.lineWidth = Math.max(1.2, 2.5 / this.cam.zoom)
    ctx.lineCap = 'round'
    for (let i = 0; i + 5 < ghost.length; i += 3) {
      const t = ghost[i + 2] / top
      ctx.strokeStyle = `hsl(${Math.round(215 - 165 * t)} 95% ${Math.round(58 + 6 * t)}%)`
      ctx.beginPath()
      ctx.moveTo(ghost[i], ghost[i + 1])
      ctx.lineTo(ghost[i + 3], ghost[i + 4])
      ctx.stroke()
    }
  }
}
