import { sound } from '../../audio/sound'
import { clamp } from '../../core/math/util'
import { createCar, DEFAULT_CAR, stepCar, topSpeed, type CarInput, type CarState } from '../../core/physics/car'
import {
  createLapTimer,
  relativePosition,
  updateLapTimer,
  type LapTimer,
} from '../../core/physics/lapTimer'
import type { TrackAnalysis } from '../../core/track/analysis'
import { fractionToIndex, locateGlobal, lateralOffset, poseAt } from '../../core/track/build'
import { strokeToControlPoints } from '../../core/track/simplify'
import { SURFACE_NAMES, TRACK_LIMITS, type BuiltTrack, type TrackDef } from '../../core/track/types'
import { applyCamera, fitCamera, screenToWorld, worldToScreen, zoomAt, type Camera } from '../../render/camera'
import { drawCar } from '../../render/carRenderer'
import { drawTrack, TRACK_COLORS, type TrackPaths } from '../../render/trackRenderer'
import { useStudioStore, type StudioTool } from '../../state/studioStore'

/** Top speed of the test-drive car, for the pitch of its engine note. */
const TOP_SPEED = topSpeed(DEFAULT_CAR)

export interface HudState {
  speedKmh: number
  surface: string
  crashed: boolean
  laps: number
  /** Time of the lap in progress, or null before the first crossing of the line. */
  lapTime: number | null
  sector: number
  currentSectors: number[]
  lastLap: number | null
  bestLap: number | null
}

export interface StudioScene {
  track: BuiltTrack | null
  paths: TrackPaths | null
  analysis: TrackAnalysis | null
  drivable: boolean
}

interface Callbacks {
  onHud: (hud: HudState | null) => void
  onMessage: (text: string) => void
}

interface Pt {
  x: number
  y: number
}

type Gesture =
  | { type: 'pan'; sx: number; sy: number; camX: number; camY: number }
  | { type: 'point'; index: number; sx: number; sy: number; moved: boolean }
  | { type: 'stroke'; sx: number; sy: number; freehand: boolean; points: Pt[] }

const PHYSICS_DT = 1 / 120
const POINT_HIT_PX = 10
const MARKER_TOOLS: readonly StudioTool[] = ['start', 'sector1', 'sector2', 'drs', 'pit']
const TOOL_COLOR: Partial<Record<StudioTool, string>> = {
  start: TRACK_COLORS.startLine,
  sector1: TRACK_COLORS.sector,
  sector2: TRACK_COLORS.sector,
  drs: TRACK_COLORS.drs,
  pit: '#4aa8ff',
}
const CAR_COLOR = '#ff5a36'

/**
 * Owns the Track Studio canvas: camera, pointer and keyboard gestures, the
 * drawing, and the test-drive loop. Deliberately plain TypeScript rather than
 * React: it runs every frame and mutates state that React should not re-render for.
 */
export class StudioController {
  private readonly ctx: CanvasRenderingContext2D
  private cam: Camera = { x: 0, y: 0, zoom: 1 }
  private w = 1
  private h = 1
  private dpr = 1
  private scene: StudioScene = { track: null, paths: null, analysis: null, drivable: false }
  private tool: StudioTool = 'edit'

  private gesture: Gesture | null = null
  private hoverPoint: number | null = null
  private hoverIndex: number | null = null
  /** First click of a two-click marker (DRS zone start, pit entry), as a lap fraction. */
  private pending: number | null = null
  private spaceHeld = false
  private drawQueued = false
  private needsFit = true
  /** True once the user has panned or zoomed; until then the view follows the canvas size. */
  private userView = false

  // Test drive.
  private car: CarState | null = null
  private timer: LapTimer | null = null
  private readonly input: CarInput = { steer: 0, throttle: 0, brake: 0 }
  private readonly keys = new Set<string>()
  private raf = 0
  private lastFrame = 0
  private accumulator = 0
  private crashClock = 0
  private hudClock = 0
  private editorCam: Camera | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: Callbacks,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not available')
    this.ctx = ctx

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  destroy(): void {
    this.stopDrive()
    const c = this.canvas
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerUp)
    c.removeEventListener('pointerleave', this.onPointerLeave)
    c.removeEventListener('wheel', this.onWheel)
    c.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  // ---------------------------------------------------------------- inputs

  resize(w: number, h: number, dpr: number): void {
    this.w = Math.max(1, w)
    this.h = Math.max(1, h)
    this.dpr = dpr
    this.canvas.width = Math.round(this.w * dpr)
    this.canvas.height = Math.round(this.h * dpr)
    if (this.needsFit || !this.userView) this.fit()
    this.requestDraw()
  }

  setScene(scene: StudioScene): void {
    const trackChanged = scene.track !== this.scene.track
    this.scene = scene
    this.hoverIndex = null
    if (trackChanged && this.car) {
      // The circuit changed under the car: end the drive rather than teleport it.
      useStudioStore.getState().setTool('edit')
    }
    if (this.needsFit) this.fit()
    this.requestDraw()
  }

  setTool(tool: StudioTool): void {
    if (tool === this.tool) return
    const wasDriving = this.tool === 'drive'
    this.tool = tool
    this.pending = null
    this.hoverIndex = null
    this.hoverPoint = null
    this.gesture = null
    if (wasDriving) this.stopDrive()
    if (tool === 'drive') this.startDrive()
    this.updateCursor()
    this.requestDraw()
  }

  /** Re-centres the view on the track at the next opportunity. */
  requestFit(): void {
    this.needsFit = true
    this.fit()
    this.requestDraw()
  }

  private fit(): void {
    if (this.w <= 1 || this.car) return
    this.userView = false
    const { track } = this.scene
    if (track) {
      this.cam = fitCamera(track.bounds, this.w, this.h, 48)
      this.needsFit = false
      return
    }
    const points = useStudioStore.getState().def.points
    if (points.length >= 2) {
      const xs = points.map((p) => p.x)
      const ys = points.map((p) => p.y)
      this.cam = fitCamera(
        {
          minX: Math.min(...xs) - 100,
          minY: Math.min(...ys) - 100,
          maxX: Math.max(...xs) + 100,
          maxY: Math.max(...ys) + 100,
        },
        this.w,
        this.h,
      )
    } else {
      // Empty canvas: show roughly 1.6 km across.
      this.cam = { x: 0, y: 0, zoom: this.w / 1600 }
    }
    this.needsFit = false
  }

  // --------------------------------------------------------------- pointer

  private local(e: PointerEvent | WheelEvent): Pt {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private world(sx: number, sy: number): Pt {
    return screenToWorld(this.cam, this.w, this.h, sx, sy)
  }

  private pointAt(sx: number, sy: number): number | null {
    const points = useStudioStore.getState().def.points
    let best: number | null = null
    let bestD = POINT_HIT_PX
    for (let i = 0; i < points.length; i++) {
      const s = worldToScreen(this.cam, this.w, this.h, points[i].x, points[i].y)
      const d = Math.hypot(s.x - sx, s.y - sy)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  /** Nearest centreline sample if the position is on or near the circuit. */
  private trackIndexAt(wx: number, wy: number, slackPx: number): number | null {
    const { track } = this.scene
    if (!track) return null
    const i = locateGlobal(track, wx, wy)
    const d = Math.hypot(track.x[i] - wx, track.y[i] - wy)
    return d <= track.halfWidth[i] + slackPx / this.cam.zoom ? i : null
  }

  private startPan(sx: number, sy: number): void {
    this.gesture = { type: 'pan', sx, sy, camX: this.cam.x, camY: this.cam.y }
    this.canvas.style.cursor = 'grabbing'
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.tool === 'drive') return
    const { x: sx, y: sy } = this.local(e)
    try {
      // Keeps a drag alive when the pointer leaves the canvas.
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nicety; some pointer types (and synthetic events) cannot be captured.
    }
    const store = useStudioStore.getState()

    if (e.button !== 0 || this.spaceHeld) {
      this.startPan(sx, sy)
      return
    }

    const w = this.world(sx, sy)

    if (this.tool === 'edit') {
      const hit = this.pointAt(sx, sy)
      if (hit !== null) {
        store.select(hit)
        this.gesture = { type: 'point', index: hit, sx, sy, moved: false }
        return
      }
      const index = this.trackIndexAt(w.x, w.y, 4)
      const { track } = this.scene
      if (index !== null && track) {
        if (store.def.points.length >= TRACK_LIMITS.maxPoints) {
          this.callbacks.onMessage(`A track can have at most ${TRACK_LIMITS.maxPoints} points.`)
          return
        }
        // Insert on the centreline so the shape barely changes until it is dragged.
        const at = track.ctrlSegment[index] + 1
        const points = store.def.points.slice()
        points.splice(at, 0, { x: round1(track.x[index]), y: round1(track.y[index]) })
        store.update({ ...store.def, points }, 'push')
        store.select(at)
        this.gesture = { type: 'point', index: at, sx, sy, moved: true }
        return
      }
      store.select(null)
      this.startPan(sx, sy)
      return
    }

    if (this.tool === 'draw') {
      this.gesture = { type: 'stroke', sx, sy, freehand: false, points: [w] }
      return
    }

    if (MARKER_TOOLS.includes(this.tool)) {
      const index = this.trackIndexAt(w.x, w.y, 30)
      if (index === null) {
        this.startPan(sx, sy)
        return
      }
      this.placeMarker(index, w)
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.tool === 'drive') return
    const { x: sx, y: sy } = this.local(e)
    const w = this.world(sx, sy)
    const g = this.gesture
    const store = useStudioStore.getState()

    if (g?.type === 'pan') {
      this.cam.x = g.camX - (sx - g.sx) / this.cam.zoom
      this.cam.y = g.camY - (sy - g.sy) / this.cam.zoom
      this.userView = true
    } else if (g?.type === 'point') {
      const wasMoved = g.moved
      if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) > 3) g.moved = true
      if (g.moved) {
        const points = store.def.points.slice()
        points[g.index] = { ...points[g.index], x: round1(w.x), y: round1(w.y) }
        // Only the first frame of a drag is recorded, so one undo reverts the whole move.
        store.update({ ...store.def, points }, wasMoved ? 'none' : 'push')
      }
    } else if (g?.type === 'stroke') {
      if (!g.freehand && Math.hypot(sx - g.sx, sy - g.sy) > 6) g.freehand = true
      if (g.freehand) g.points.push(w)
    } else if (this.tool === 'edit') {
      this.hoverPoint = this.pointAt(sx, sy)
      this.hoverIndex = this.hoverPoint === null ? this.trackIndexAt(w.x, w.y, 4) : null
      this.updateCursor()
    } else if (MARKER_TOOLS.includes(this.tool)) {
      this.hoverIndex = this.trackIndexAt(w.x, w.y, 30)
      this.updateCursor()
    }
    this.requestDraw()
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    const g = this.gesture
    this.gesture = null
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (g?.type === 'stroke') this.finishStroke(g)
    this.updateCursor()
    this.requestDraw()
  }

  private readonly onPointerLeave = (): void => {
    if (this.gesture) return
    this.hoverPoint = null
    this.hoverIndex = null
    this.requestDraw()
  }

  private finishStroke(g: Extract<Gesture, { type: 'stroke' }>): void {
    const store = useStudioStore.getState()
    if (g.freehand) {
      const points = strokeToControlPoints(g.points)
      if (!points) {
        this.callbacks.onMessage('That loop is too small. Draw a larger circuit.')
        return
      }
      store.update({ ...store.def, points }, 'push')
      store.select(null)
      store.setTool('edit')
      this.needsFit = true
      return
    }
    // A plain click adds one control point to the end of the loop.
    if (store.def.points.length >= TRACK_LIMITS.maxPoints) return
    const p = g.points[0]
    const points = [...store.def.points, { x: round1(p.x), y: round1(p.y) }]
    store.update({ ...store.def, points }, 'push')
    store.select(points.length - 1)
  }

  private placeMarker(index: number, click: Pt): void {
    const { track } = this.scene
    if (!track) return
    const store = useStudioStore.getState()
    const def = store.def
    const fraction = index / track.n

    switch (this.tool) {
      case 'start':
        store.update({ ...def, startFraction: fraction }, 'push')
        break
      case 'sector1':
        store.update({ ...def, sectors: [fraction, def.sectors[1]] }, 'push')
        break
      case 'sector2':
        store.update({ ...def, sectors: [def.sectors[0], fraction] }, 'push')
        break
      case 'drs':
        if (this.pending === null) {
          if (def.drsZones.length >= 6) {
            this.callbacks.onMessage('A track can have at most 6 DRS zones.')
            return
          }
          this.pending = fraction
        } else {
          const zone = { start: this.pending, end: fraction }
          this.pending = null
          store.update({ ...def, drsZones: [...def.drsZones, zone] }, 'push')
        }
        break
      case 'pit':
        if (this.pending === null) {
          this.pending = fraction
        } else {
          // The side of the track that was clicked decides where the lane runs.
          const side = lateralOffset(track, index, click.x, click.y) >= 0 ? 'left' : 'right'
          const pit = { entry: this.pending, exit: fraction, side } as const
          this.pending = null
          store.update({ ...def, pit }, 'push')
        }
        break
    }
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    if (this.tool === 'drive') return
    const { x, y } = this.local(e)
    this.cam = zoomAt(this.cam, this.w, this.h, x, y, Math.exp(-e.deltaY * 0.0015))
    this.userView = true
    this.requestDraw()
  }

  private readonly onContextMenu = (e: Event): void => e.preventDefault()

  private updateCursor(): void {
    let cursor: string
    if (this.tool === 'drive') cursor = 'default'
    else if (this.spaceHeld) cursor = 'grab'
    else if (this.tool === 'draw') cursor = 'crosshair'
    else if (this.tool === 'edit') {
      cursor = this.hoverPoint !== null ? 'move' : this.hoverIndex !== null ? 'copy' : 'grab'
    } else cursor = this.hoverIndex !== null ? 'pointer' : 'grab'
    this.canvas.style.cursor = cursor
  }

  // -------------------------------------------------------------- keyboard

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    const store = useStudioStore.getState()
    const key = e.key.toLowerCase()

    if (this.tool === 'drive') {
      if (key === 'escape') store.setTool('edit')
      else if (key === 'r') this.resetCar()
      else if (isDriveKey(key)) this.keys.add(key)
      else return
      e.preventDefault()
      return
    }

    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
    } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault()
      store.redo()
    } else if (key === 'delete' || key === 'backspace') {
      if (store.selected !== null) {
        e.preventDefault()
        deleteSelectedPoint(this.callbacks.onMessage)
      }
    } else if (key === 'escape') {
      this.pending = null
      store.select(null)
      this.requestDraw()
    } else if (key === ' ') {
      e.preventDefault()
      this.spaceHeld = true
      this.updateCursor()
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase()
    this.keys.delete(key)
    if (key === ' ') {
      this.spaceHeld = false
      this.updateCursor()
    }
  }

  private readonly onBlur = (): void => {
    this.keys.clear()
    this.spaceHeld = false
  }

  // ------------------------------------------------------------ test drive

  private startDrive(): void {
    const { track, drivable } = this.scene
    if (!track || !drivable) {
      this.callbacks.onMessage('Fix the track problems before driving it.')
      useStudioStore.getState().setTool('edit')
      return
    }
    this.editorCam = { ...this.cam }
    this.spawnCar(track)
    this.keys.clear()
    this.lastFrame = performance.now()
    this.accumulator = 0
    this.hudClock = 0
    sound.engineStart()
    this.raf = requestAnimationFrame(this.tick)
  }

  private spawnCar(track: BuiltTrack): void {
    // Grid slot a few car lengths before the line, so timing starts on a flying crossing.
    this.car = createCar(track, track.def.startFraction * track.length - 15)
    this.timer = createLapTimer(track, this.car.s)
    this.input.steer = 0
    this.input.throttle = 0
    this.input.brake = 0
    this.crashClock = 0
  }

  private resetCar(): void {
    if (this.scene.track) this.spawnCar(this.scene.track)
  }

  private stopDrive(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    sound.engineStop()
    this.car = null
    this.timer = null
    this.keys.clear()
    this.callbacks.onHud(null)
    if (this.editorCam) {
      this.cam = this.editorCam
      this.editorCam = null
    }
  }

  private readonly tick = (now: number): void => {
    const { track } = this.scene
    const car = this.car
    const timer = this.timer
    if (!track || !car || !timer) return

    const frame = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.accumulator += frame
    while (this.accumulator >= PHYSICS_DT) {
      this.stepDrive(track, car, timer)
      this.accumulator -= PHYSICS_DT
    }

    // Chase camera: looks ahead of the car and pulls back with speed.
    const active = this.car ?? car
    if (active.crashed) sound.engineStop()
    else sound.engineUpdate(active.speed / TOP_SPEED, this.input.throttle)
    const lead = active.speed * 0.35
    const tx = active.x + Math.cos(active.heading) * lead
    const ty = active.y + Math.sin(active.heading) * lead
    const follow = 1 - Math.exp(-frame * 6)
    const targetZoom = 7 - 3.8 * Math.min(1, active.speed / 90)
    this.cam.x += (tx - this.cam.x) * follow
    this.cam.y += (ty - this.cam.y) * follow
    this.cam.zoom += (targetZoom - this.cam.zoom) * (1 - Math.exp(-frame * 2.5))

    this.hudClock += frame
    if (this.hudClock >= 0.08) {
      this.hudClock = 0
      const t = this.timer ?? timer
      this.callbacks.onHud({
        speedKmh: active.speed * 3.6,
        surface: SURFACE_NAMES[active.surface],
        crashed: active.crashed,
        laps: t.laps,
        lapTime: t.running ? active.time - t.lapStart : null,
        sector: t.sector,
        currentSectors: t.current.slice(),
        lastLap: t.lastLap,
        bestLap: t.bestLap,
      })
    }

    this.draw()
    this.raf = requestAnimationFrame(this.tick)
  }

  private stepDrive(track: BuiltTrack, car: CarState, timer: LapTimer): void {
    if (car.crashed) {
      if (this.crashClock === 0) sound.crash()
      // Sit in the wall for a moment, then put the car back on the road.
      this.crashClock += PHYSICS_DT
      if (this.crashClock > 1.2) {
        const best = timer.bestLap
        const bestSectors = timer.bestSectors
        const laps = timer.laps
        this.car = createCar(track, car.s)
        this.timer = createLapTimer(track, this.car.s)
        this.timer.bestLap = best
        this.timer.bestSectors = bestSectors
        this.timer.laps = laps
        this.timer.prev = relativePosition(track, this.car.s)
        this.crashClock = 0
        this.input.steer = 0
      }
      return
    }

    const k = this.keys
    const left = k.has('arrowleft') || k.has('a')
    const right = k.has('arrowright') || k.has('d')
    const target = (right ? 1 : 0) - (left ? 1 : 0)
    // Keys are digital; ease towards the target so the car is not twitchy.
    const rate = (target === 0 ? 7 : 4) * PHYSICS_DT
    this.input.steer += clamp(target - this.input.steer, -rate, rate)
    this.input.throttle = k.has('arrowup') || k.has('w') ? 1 : 0
    this.input.brake = k.has('arrowdown') || k.has('s') || k.has(' ') ? 1 : 0

    stepCar(car, this.input, track, DEFAULT_CAR, PHYSICS_DT)
    updateLapTimer(timer, track, car.s, car.speed, car.time)
  }

  // --------------------------------------------------------------- drawing

  requestDraw(): void {
    if (this.raf !== 0 || this.drawQueued) return // the drive loop draws every frame
    this.drawQueued = true
    requestAnimationFrame(() => {
      this.drawQueued = false
      this.draw()
    })
  }

  private draw(): void {
    const { ctx, w, h, dpr, cam } = this
    const { track, paths, analysis } = this.scene
    const store = useStudioStore.getState()
    const def = store.def
    const px = 1 / cam.zoom
    const driving = this.car !== null

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = TRACK_COLORS.ground
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    applyCamera(ctx, cam, w, h, dpr)
    if (!driving) this.drawGrid(px)

    if (paths) {
      drawTrack(ctx, paths, { showCentreLine: !driving, zoom: cam.zoom })
    } else if (def.points.length >= 2) {
      ctx.strokeStyle = 'rgba(233, 237, 245, 0.45)'
      ctx.lineWidth = 1.5 * px
      ctx.setLineDash([6 * px, 6 * px])
      ctx.beginPath()
      def.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (!driving) {
      if (track) {
        this.drawDirectionArrows(track, px)
        this.drawMarkerPreview(track, px)
      }
      this.drawFreehand(px)
      this.drawControlPoints(def, store.selected, px)
    }

    if (this.car) {
      drawCar(ctx, this.car.x, this.car.y, this.car.heading, DEFAULT_CAR, CAR_COLOR, this.car.steer)
    }

    // Screen-space labels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (track && analysis && !driving) this.drawCornerLabels(track, analysis)
    if (!driving) this.drawScaleBar()
  }

  private drawGrid(px: number): void {
    const { ctx, cam, w, h } = this
    const spacing = cam.zoom > 0.6 ? 100 : cam.zoom > 0.12 ? 500 : 2000
    const a = screenToWorld(cam, w, h, 0, 0)
    const b = screenToWorld(cam, w, h, w, h)
    ctx.strokeStyle = 'rgba(233, 237, 245, 0.045)'
    ctx.lineWidth = px
    ctx.beginPath()
    for (let x = Math.ceil(a.x / spacing) * spacing; x <= b.x; x += spacing) {
      ctx.moveTo(x, a.y)
      ctx.lineTo(x, b.y)
    }
    for (let y = Math.ceil(a.y / spacing) * spacing; y <= b.y; y += spacing) {
      ctx.moveTo(a.x, y)
      ctx.lineTo(b.x, y)
    }
    ctx.stroke()
  }

  private drawDirectionArrows(track: BuiltTrack, px: number): void {
    const { ctx } = this
    const size = Math.min(5 * px, track.halfWidth[0] * 0.6)
    const every = Math.max(1, Math.round(Math.max(120, 90 * px) / track.step))
    ctx.fillStyle = 'rgba(233, 237, 245, 0.4)'
    for (let i = Math.round(every / 2); i < track.n; i += every) {
      ctx.save()
      ctx.translate(track.x[i], track.y[i])
      ctx.rotate(track.heading[i])
      ctx.beginPath()
      ctx.moveTo(size, 0)
      ctx.lineTo(-size * 0.7, size * 0.7)
      ctx.lineTo(-size * 0.25, 0)
      ctx.lineTo(-size * 0.7, -size * 0.7)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  private drawMarkerPreview(track: BuiltTrack, px: number): void {
    const color = TOOL_COLOR[this.tool]
    if (!color) {
      // Edit tool: show where a click would insert a point.
      if (this.tool === 'edit' && this.hoverIndex !== null && this.hoverPoint === null && !this.gesture) {
        const i = this.hoverIndex
        this.ctx.strokeStyle = 'rgba(233, 237, 245, 0.8)'
        this.ctx.lineWidth = 1.5 * px
        this.ctx.beginPath()
        this.ctx.arc(track.x[i], track.y[i], 5 * px, 0, Math.PI * 2)
        this.ctx.stroke()
      }
      return
    }
    const line = (index: number, alpha: number) => {
      const reach = track.halfWidth[index] + track.def.kerbWidth + 4 * px
      this.ctx.globalAlpha = alpha
      this.ctx.strokeStyle = color
      this.ctx.lineWidth = Math.max(1, 3 * px)
      this.ctx.beginPath()
      this.ctx.moveTo(track.x[index] + track.ty[index] * reach, track.y[index] - track.tx[index] * reach)
      this.ctx.lineTo(track.x[index] - track.ty[index] * reach, track.y[index] + track.tx[index] * reach)
      this.ctx.stroke()
      this.ctx.globalAlpha = 1
    }
    if (this.pending !== null) line(fractionToIndex(this.pending, track.n), 1)
    if (this.hoverIndex !== null) line(this.hoverIndex, 0.7)
  }

  private drawFreehand(px: number): void {
    const g = this.gesture
    if (g?.type !== 'stroke' || !g.freehand) return
    const { ctx } = this
    ctx.strokeStyle = CAR_COLOR
    ctx.lineWidth = 2.5 * px
    ctx.lineJoin = 'round'
    ctx.beginPath()
    g.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  }

  private drawControlPoints(def: TrackDef, selected: number | null, px: number): void {
    const { ctx } = this
    def.points.forEach((p, i) => {
      const isSelected = i === selected
      const isHover = i === this.hoverPoint
      const r = (isSelected ? 6.5 : isHover ? 6 : 4.5) * px
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? CAR_COLOR : p.width !== undefined ? '#4aa8ff' : '#e9edf5'
      ctx.fill()
      ctx.lineWidth = 1.5 * px
      ctx.strokeStyle = '#0b0e14'
      ctx.stroke()
    })
  }

  private drawCornerLabels(track: BuiltTrack, analysis: TrackAnalysis): void {
    const { ctx, cam, w, h } = this
    if (cam.zoom < 0.12) return
    ctx.font = '600 11px ui-monospace, Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const startS = track.def.startFraction * track.length
    for (const corner of analysis.corners) {
      const i = fractionToIndex((startS + corner.apex) / track.length, track.n)
      // Label on the outside of the bend, clear of the run-off.
      const side = corner.direction === 'R' ? 1 : -1
      const reach = track.halfWidth[i] + track.def.kerbWidth + 16 / cam.zoom
      const pose = poseAt(track, i * track.step, side * reach)
      const s = worldToScreen(cam, w, h, pose.x, pose.y)
      ctx.fillStyle = 'rgba(11, 14, 20, 0.75)'
      ctx.beginPath()
      ctx.roundRect(s.x - 13, s.y - 8, 26, 16, 4)
      ctx.fill()
      ctx.fillStyle = '#c9d2e3'
      ctx.fillText(`T${corner.number}`, s.x, s.y + 0.5)
    }
  }

  private drawScaleBar(): void {
    const { ctx, cam, h } = this
    const options = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
    const metres = options.find((m) => m * cam.zoom >= 70) ?? 5000
    const len = metres * cam.zoom
    const x = 16
    const y = h - 18
    ctx.strokeStyle = 'rgba(233, 237, 245, 0.7)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, y - 4)
    ctx.lineTo(x, y)
    ctx.lineTo(x + len, y)
    ctx.lineTo(x + len, y - 4)
    ctx.stroke()
    ctx.font = '11px ui-monospace, Consolas, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = 'rgba(233, 237, 245, 0.7)'
    ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, x + 6, y - 4)
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function isDriveKey(key: string): boolean {
  return ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '].includes(key)
}

/** Removes the selected control point, keeping at least a triangle. */
export function deleteSelectedPoint(onMessage: (text: string) => void): void {
  const store = useStudioStore.getState()
  const { selected, def } = store
  if (selected === null) return
  if (def.points.length <= TRACK_LIMITS.minPoints) {
    onMessage(`A circuit needs at least ${TRACK_LIMITS.minPoints} points.`)
    return
  }
  const points = def.points.filter((_, i) => i !== selected)
  store.update({ ...def, points }, 'push')
  store.select(null)
}
