import { wrap, wrapIndex } from '../core/math/util'
import { fractionToIndex } from '../core/track/build'
import { buildPitLane, PIT_LANE_WIDTH } from '../core/track/pit'
import type { BuiltTrack } from '../core/track/types'

export const TRACK_COLORS = {
  ground: '#0c1210',
  wall: '#8c96aa',
  gravel: '#4d4534',
  verge: '#1b2a20',
  asphalt: '#2c313c',
  kerbRed: '#d8413a',
  kerbWhite: '#eef0f4',
  edgeLine: 'rgba(238, 240, 244, 0.55)',
  centreLine: 'rgba(238, 240, 244, 0.22)',
  startLine: '#ffffff',
  sector: '#ffc247',
  drs: '#3ddc97',
  pit: '#3a4050',
  pitLine: 'rgba(238, 240, 244, 0.7)',
}

/** Corners sharper than this radius get painted kerbs. */
const KERB_RADIUS = 160

/**
 * Pre-built drawing paths for one track. Building these once per track edit
 * keeps the per-frame cost to a handful of strokes.
 */
export interface TrackPaths {
  track: BuiltTrack
  centre: Path2D
  left: Path2D
  right: Path2D
  kerbRed: Path2D
  kerbWhite: Path2D
  pit: Path2D | null
  pitLength: number
}

export function buildTrackPaths(track: BuiltTrack): TrackPaths {
  const { n, x, y, tx, ty, halfWidth, curvature } = track

  const centre = new Path2D()
  const left = new Path2D()
  const right = new Path2D()
  for (let i = 0; i < n; i++) {
    const lx = x[i] + ty[i] * halfWidth[i]
    const ly = y[i] - tx[i] * halfWidth[i]
    const rx = x[i] - ty[i] * halfWidth[i]
    const ry = y[i] + tx[i] * halfWidth[i]
    if (i === 0) {
      centre.moveTo(x[i], y[i])
      left.moveTo(lx, ly)
      right.moveTo(rx, ry)
    } else {
      centre.lineTo(x[i], y[i])
      left.lineTo(lx, ly)
      right.lineTo(rx, ry)
    }
  }
  centre.closePath()
  left.closePath()
  right.closePath()

  // Kerbs: mark corner samples, widen each zone a little, then paint 4 m blocks.
  const inCorner = new Uint8Array(n)
  const margin = Math.round(10 / track.step)
  for (let i = 0; i < n; i++) {
    if (Math.abs(curvature[i]) > 1 / KERB_RADIUS) {
      for (let d = -margin; d <= margin; d++) inCorner[wrapIndex(i + d, n)] = 1
    }
  }
  const kerbRed = new Path2D()
  const kerbWhite = new Path2D()
  const block = Math.max(1, Math.round(4 / track.step))
  for (let i = 0; i < n; i++) {
    if (!inCorner[i]) continue
    const j = (i + 1) % n
    const path = Math.floor(i / block) % 2 === 0 ? kerbRed : kerbWhite
    // Extend each piece slightly so neighbouring blocks leave no hairline gap.
    path.moveTo(x[i] - tx[i] * 0.15, y[i] - ty[i] * 0.15)
    path.lineTo(x[j] + tx[j] * 0.15, y[j] + ty[j] * 0.15)
  }

  const pit = buildPitPath(track)
  return { track, centre, left, right, kerbRed, kerbWhite, pit: pit?.path ?? null, pitLength: pit?.length ?? 0 }
}

function buildPitPath(track: BuiltTrack): { path: Path2D; length: number } | null {
  const lane = buildPitLane(track)
  if (!lane) return null
  const path = new Path2D()
  for (let k = 0; k < lane.x.length; k++) {
    if (k === 0) path.moveTo(lane.x[k], lane.y[k])
    else path.lineTo(lane.x[k], lane.y[k])
  }
  return { path, length: lane.length }
}

export interface DrawTrackOptions {
  /** Draw the dashed centreline (editor) or leave the surface clean (driving). */
  showCentreLine?: boolean
  /** Pixels per metre, used to keep hairlines visible when zoomed out. */
  zoom: number
}

/**
 * Draws the track into a context whose transform is already in world metres.
 * Each surface is one thick stroke of the centreline: wall, gravel, kerb,
 * asphalt, from widest to narrowest.
 */
export function drawTrack(ctx: CanvasRenderingContext2D, paths: TrackPaths, options: DrawTrackOptions): void {
  const { track } = paths
  const { kerbWidth, runoffWidth } = track.def
  const px = 1 / options.zoom // one screen pixel in metres

  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'
  ctx.setLineDash([])

  strokeBand(ctx, paths, kerbWidth + runoffWidth + Math.max(0.8, 1.5 * px), TRACK_COLORS.wall)
  strokeBand(ctx, paths, kerbWidth + runoffWidth, TRACK_COLORS.gravel)

  if (paths.pit) {
    ctx.lineWidth = PIT_LANE_WIDTH
    ctx.strokeStyle = TRACK_COLORS.pit
    ctx.stroke(paths.pit)
  }

  strokeBand(ctx, paths, kerbWidth, TRACK_COLORS.verge)
  if (track.uniformWidth) {
    ctx.lineWidth = 2 * (track.halfWidth[0] + kerbWidth)
    ctx.strokeStyle = TRACK_COLORS.kerbRed
    ctx.stroke(paths.kerbRed)
    ctx.strokeStyle = TRACK_COLORS.kerbWhite
    ctx.stroke(paths.kerbWhite)
  } else {
    strokeKerbsVariable(ctx, paths)
  }
  strokeBand(ctx, paths, 0, TRACK_COLORS.asphalt)

  // Painted lines.
  ctx.lineWidth = Math.max(0.25, px)
  ctx.strokeStyle = TRACK_COLORS.edgeLine
  ctx.stroke(paths.left)
  ctx.stroke(paths.right)

  if (paths.pit) {
    ctx.lineWidth = Math.max(0.3, px)
    ctx.strokeStyle = TRACK_COLORS.pitLine
    ctx.setLineDash([6, 6])
    ctx.stroke(paths.pit)
    ctx.setLineDash([])
  }

  if (options.showCentreLine) {
    ctx.lineWidth = Math.max(0.3, px)
    ctx.strokeStyle = TRACK_COLORS.centreLine
    ctx.setLineDash([8, 10])
    ctx.stroke(paths.centre)
    ctx.setLineDash([])
  }

  drawMarkers(ctx, track, px)
}

/** Strokes the centreline `extra` metres wider than the racing surface on each side. */
function strokeBand(ctx: CanvasRenderingContext2D, paths: TrackPaths, extra: number, color: string): void {
  const { track } = paths
  ctx.strokeStyle = color
  if (track.uniformWidth) {
    ctx.lineWidth = 2 * (track.halfWidth[0] + extra)
    ctx.stroke(paths.centre)
    return
  }
  // Width varies along the lap: stroke short capsules, one per sample.
  const { n, x, y, halfWidth } = track
  ctx.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    ctx.lineWidth = 2 * (halfWidth[i] + extra)
    ctx.beginPath()
    ctx.moveTo(x[i], y[i])
    ctx.lineTo(x[j], y[j])
    ctx.stroke()
  }
  ctx.lineCap = 'butt'
}

function strokeKerbsVariable(ctx: CanvasRenderingContext2D, paths: TrackPaths): void {
  const { track } = paths
  const { n, x, y, tx, ty, halfWidth, curvature } = track
  const margin = Math.round(10 / track.step)
  const block = Math.max(1, Math.round(4 / track.step))
  for (let i = 0; i < n; i++) {
    let corner = false
    for (let d = -margin; d <= margin && !corner; d++) {
      corner = Math.abs(curvature[wrapIndex(i + d, n)]) > 1 / KERB_RADIUS
    }
    if (!corner) continue
    const j = (i + 1) % n
    ctx.strokeStyle = Math.floor(i / block) % 2 === 0 ? TRACK_COLORS.kerbRed : TRACK_COLORS.kerbWhite
    ctx.lineWidth = 2 * (halfWidth[i] + track.def.kerbWidth)
    ctx.beginPath()
    ctx.moveTo(x[i] - tx[i] * 0.15, y[i] - ty[i] * 0.15)
    ctx.lineTo(x[j] + tx[j] * 0.15, y[j] + ty[j] * 0.15)
    ctx.stroke()
  }
}

function drawMarkers(ctx: CanvasRenderingContext2D, track: BuiltTrack, px: number): void {
  const { n, def } = track

  // DRS zones: a green line along the right-hand edge.
  ctx.strokeStyle = TRACK_COLORS.drs
  ctx.lineWidth = Math.max(0.9, 2.5 * px)
  for (const zone of def.drsZones) {
    const from = fractionToIndex(zone.start, n)
    const count = Math.round(wrap(zone.end - zone.start, 1) * n)
    ctx.beginPath()
    for (let k = 0; k <= count; k++) {
      const i = (from + k) % n
      const off = track.halfWidth[i] - 0.8
      const qx = track.x[i] - track.ty[i] * off
      const qy = track.y[i] + track.tx[i] * off
      if (k === 0) ctx.moveTo(qx, qy)
      else ctx.lineTo(qx, qy)
    }
    ctx.stroke()
    crossLine(ctx, track, from, TRACK_COLORS.drs, Math.max(0.6, 1.5 * px))
  }

  crossLine(ctx, track, fractionToIndex(def.sectors[0], n), TRACK_COLORS.sector, Math.max(0.6, 2 * px))
  crossLine(ctx, track, fractionToIndex(def.sectors[1], n), TRACK_COLORS.sector, Math.max(0.6, 2 * px))

  // Start/finish: a chequered band two rows deep.
  const i = track.startIndex
  const hw = track.halfWidth[i]
  const cells = Math.max(4, Math.round((2 * hw) / 1.5))
  const cell = (2 * hw) / cells
  ctx.save()
  ctx.translate(track.x[i], track.y[i])
  ctx.rotate(track.heading[i])
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = (row + c) % 2 === 0 ? TRACK_COLORS.startLine : '#11141a'
      ctx.fillRect((row - 1) * cell, -hw + c * cell, cell + 0.02, cell + 0.02)
    }
  }
  ctx.restore()
}

/** A line across the racing surface at sample `i`. */
function crossLine(
  ctx: CanvasRenderingContext2D,
  track: BuiltTrack,
  i: number,
  color: string,
  width: number,
): void {
  const hw = track.halfWidth[i]
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(track.x[i] + track.ty[i] * hw, track.y[i] - track.tx[i] * hw)
  ctx.lineTo(track.x[i] - track.ty[i] * hw, track.y[i] + track.tx[i] * hw)
  ctx.stroke()
}
