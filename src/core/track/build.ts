import { wrap, wrapAngle, wrapIndex } from '../math/util'
import { sampleClosedSpline } from './spline'
import { Surface, TRACK_LIMITS, type BuiltTrack, type TrackDef } from './types'

/** Target arc length between centreline samples (m). */
export const SAMPLE_STEP = 2

/**
 * Turns a track definition into uniformly sampled geometry.
 * Returns null while the track has too few points to form a loop.
 */
export function buildTrack(def: TrackDef): BuiltTrack | null {
  if (def.points.length < TRACK_LIMITS.minPoints) return null

  const dense = sampleClosedSpline(def.points, def.width)
  const m = dense.x.length
  if (m < 8) return null

  // Cumulative arc length along the dense closed polyline.
  const cum = new Float64Array(m + 1)
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m
    cum[i + 1] = cum[i] + Math.hypot(dense.x[j] - dense.x[i], dense.y[j] - dense.y[i])
  }
  const length = cum[m]
  if (!(length > 1)) return null

  const n = Math.max(16, Math.round(length / SAMPLE_STEP))
  const step = length / n

  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const halfWidth = new Float64Array(n)
  const ctrlSegment = new Int32Array(n)

  let seg = 0
  for (let k = 0; k < n; k++) {
    const target = k * step
    while (seg < m - 1 && cum[seg + 1] <= target) seg++
    const span = cum[seg + 1] - cum[seg]
    const f = span > 0 ? (target - cum[seg]) / span : 0
    const j = (seg + 1) % m
    x[k] = dense.x[seg] + (dense.x[j] - dense.x[seg]) * f
    y[k] = dense.y[seg] + (dense.y[j] - dense.y[seg]) * f
    halfWidth[k] = (dense.width[seg] + (dense.width[j] - dense.width[seg]) * f) / 2
    ctrlSegment[k] = dense.segment[seg]
  }

  const tx = new Float64Array(n)
  const ty = new Float64Array(n)
  const heading = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const a = wrapIndex(k - 1, n)
    const b = wrapIndex(k + 1, n)
    const dx = x[b] - x[a]
    const dy = y[b] - y[a]
    const len = Math.hypot(dx, dy) || 1
    tx[k] = dx / len
    ty[k] = dy / len
    heading[k] = Math.atan2(dy, dx)
  }

  // Raw curvature from heading change, then a short moving average to remove
  // sampling noise without flattening real corners.
  const raw = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const a = wrapIndex(k - 1, n)
    const b = wrapIndex(k + 1, n)
    raw[k] = wrapAngle(heading[b] - heading[a]) / (2 * step)
  }
  const curvature = new Float64Array(n)
  const R = 2
  for (let k = 0; k < n; k++) {
    let sum = 0
    for (let d = -R; d <= R; d++) sum += raw[wrapIndex(k + d, n)]
    curvature[k] = sum / (2 * R + 1)
  }

  const curvaturePrefix = new Float64Array(n + 1)
  for (let k = 0; k < n; k++) curvaturePrefix[k + 1] = curvaturePrefix[k] + curvature[k]

  const ctrlSample = new Int32Array(def.points.length)
  for (let i = 0; i < def.points.length; i++) {
    ctrlSample[i] = Math.round(cum[dense.segmentStart[i]] / step) % n
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let k = 0; k < n; k++) {
    const pad = halfWidth[k] + def.kerbWidth + def.runoffWidth
    minX = Math.min(minX, x[k] - pad)
    minY = Math.min(minY, y[k] - pad)
    maxX = Math.max(maxX, x[k] + pad)
    maxY = Math.max(maxY, y[k] + pad)
  }

  return {
    def,
    n,
    step,
    length,
    x,
    y,
    tx,
    ty,
    heading,
    curvature,
    curvaturePrefix,
    halfWidth,
    uniformWidth: def.points.every((p) => p.width === undefined),
    ctrlSegment,
    ctrlSample,
    startIndex: fractionToIndex(def.startFraction, n),
    bounds: { minX, minY, maxX, maxY },
  }
}

export function fractionToIndex(fraction: number, n: number): number {
  return Math.floor(wrap(fraction, 1) * n) % n
}

/**
 * Nearest centreline sample to a world position, searching only around a
 * previous index. Cars move well under one window per step, so this is O(1)
 * and also keeps a car attached to its own piece of track where two sections
 * run close together.
 */
export function locateNear(
  track: BuiltTrack,
  px: number,
  py: number,
  hint: number,
  window = 12,
): number {
  const { x, y, n } = track
  let best = hint
  let bestD = Infinity
  for (let k = -window; k <= window; k++) {
    const i = wrapIndex(hint + k, n)
    const dx = px - x[i]
    const dy = py - y[i]
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * Follows a moving point along the centreline by projecting it onto the local
 * tangent, instead of comparing distances. A couple of iterations are enough
 * when the point moves a few metres at a time, which makes this several times
 * cheaper than locateNear for ray marching.
 */
export function projectIndex(track: BuiltTrack, px: number, py: number, hint: number, iterations = 2): number {
  const { x, y, tx, ty, n } = track
  const perMetre = 1 / track.step
  let i = hint
  for (let it = 0; it < iterations; it++) {
    const along = (px - x[i]) * tx[i] + (py - y[i]) * ty[i]
    const shift = Math.round(along * perMetre)
    if (shift === 0) break
    i = wrapIndex(i + shift, n)
  }
  return i
}

/** Nearest centreline sample over the whole track (used when there is no hint). */
export function locateGlobal(track: BuiltTrack, px: number, py: number): number {
  const { x, y, n } = track
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const dx = px - x[i]
    const dy = py - y[i]
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Signed distance from the centreline at sample `i`; positive = left of the driving direction. */
export function lateralOffset(track: BuiltTrack, i: number, px: number, py: number): number {
  // Left normal in y-down coordinates is (ty, -tx).
  return (px - track.x[i]) * track.ty[i] - (py - track.y[i]) * track.tx[i]
}

/** Distance along the centreline (m, in [0, length)) for a position near sample `i`. */
export function arcPosition(track: BuiltTrack, i: number, px: number, py: number): number {
  const along = (px - track.x[i]) * track.tx[i] + (py - track.y[i]) * track.ty[i]
  return wrap(i * track.step + along, track.length)
}

export function surfaceAt(track: BuiltTrack, i: number, lateral: number): Surface {
  const d = Math.abs(lateral)
  const hw = track.halfWidth[i]
  if (d <= hw) return Surface.Track
  if (d <= hw + track.def.kerbWidth) return Surface.Kerb
  if (d <= hw + track.def.kerbWidth + track.def.runoffWidth) return Surface.Gravel
  return Surface.Wall
}

export interface TrackPose {
  x: number
  y: number
  heading: number
}

/** World pose at arc position `s` (m), offset `lateral` metres to the left. */
export function poseAt(track: BuiltTrack, s: number, lateral = 0): TrackPose {
  const { n, step } = track
  const pos = wrap(s, track.length) / step
  const i = Math.floor(pos) % n
  const j = (i + 1) % n
  const f = pos - Math.floor(pos)
  const heading = track.heading[i] + wrapAngle(track.heading[j] - track.heading[i]) * f
  const cx = track.x[i] + (track.x[j] - track.x[i]) * f
  const cy = track.y[i] + (track.y[j] - track.y[i]) * f
  return {
    x: cx + Math.sin(heading) * lateral,
    y: cy - Math.cos(heading) * lateral,
    heading,
  }
}

/**
 * Mean signed curvature over samples [from, to) counted forward from sample 0;
 * both may run past the end of the lap. Constant time via the prefix sums.
 */
export function meanCurvature(track: BuiltTrack, from: number, to: number): number {
  const { n, curvaturePrefix: prefix } = track
  const total = prefix[n]
  const a = Math.floor(from / n) * total + prefix[from % n]
  const b = Math.floor(to / n) * total + prefix[to % n]
  return (b - a) / (to - from)
}

/** Forward arc distance from fraction `a` to fraction `b` (m), wrapping at the line. */
export function zoneLength(track: BuiltTrack, a: number, b: number): number {
  return wrap(b - a, 1) * track.length
}
