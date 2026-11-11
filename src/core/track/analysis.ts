import { wrap, wrapIndex } from '../math/util'
import { TRACK_LIMITS, type BuiltTrack } from './types'

export interface Corner {
  /** 1-based turn number, counted from the start/finish line. */
  number: number
  /** Distances from the start/finish line (m). */
  entry: number
  apex: number
  exit: number
  minRadius: number
  direction: 'L' | 'R'
  /** Total change of direction through the corner (degrees). */
  angle: number
}

export interface TrackAnalysis {
  length: number
  corners: Corner[]
  /** Longest stretch without a corner (m) and where it begins, from the start line. */
  longestStraight: number
  longestStraightStart: number
  minRadius: number
  averageWidth: number
  /** Share of the lap spent in corners (0..1). */
  cornerFraction: number
}

/** Anything gentler than this radius is treated as straight. */
const CORNER_RADIUS = 300
/** Runs of straight shorter than this inside a same-direction bend do not split it. */
const MERGE_GAP = 12
/** Bends turning less than this are kinks, not corners. */
const MIN_ANGLE_DEG = 12

export function analyseTrack(track: BuiltTrack): TrackAnalysis {
  const { n, step, curvature, startIndex } = track
  const threshold = 1 / CORNER_RADIUS

  // Classify each sample, walking forward from the start/finish line.
  // sign: 0 straight, +1 right, -1 left.
  const sign = new Int8Array(n)
  for (let k = 0; k < n; k++) {
    const c = curvature[wrapIndex(startIndex + k, n)]
    sign[k] = Math.abs(c) > threshold ? (c > 0 ? 1 : -1) : 0
  }

  // Fill short straight gaps between two bends of the same direction.
  const gap = Math.max(1, Math.round(MERGE_GAP / step))
  for (let k = 0; k < n; k++) {
    if (sign[k] !== 0) continue
    let run = 0
    while (run < n && sign[(k + run) % n] === 0) run++
    if (run >= n) break
    const before = sign[wrapIndex(k - 1, n)]
    const after = sign[(k + run) % n]
    if (run <= gap && before !== 0 && before === after) {
      for (let r = 0; r < run; r++) sign[(k + r) % n] = before
    }
    k += run - 1
  }

  // Start scanning at a boundary so no run is split across the array end.
  let origin = 0
  for (let k = 0; k < n; k++) {
    if (sign[k] !== sign[wrapIndex(k - 1, n)]) {
      origin = k
      break
    }
  }

  // Split the lap into runs of constant direction and decide which are corners.
  interface Run {
    samples: number
    corner: Corner | null
    start: number
  }
  const runs: Run[] = []
  let k = 0
  while (k < n) {
    const at = (origin + k) % n
    const s = sign[at]
    let samples = 1
    while (k + samples < n && sign[(origin + k + samples) % n] === s) samples++

    let corner: Corner | null = null
    if (s !== 0) {
      let angle = 0
      let peak = 0
      let apexOffset = 0
      for (let r = 0; r < samples; r++) {
        const c = Math.abs(curvature[wrapIndex(startIndex + at + r, n)])
        angle += c * step
        if (c > peak) {
          peak = c
          apexOffset = r
        }
      }
      const angleDeg = (angle * 180) / Math.PI
      if (angleDeg >= MIN_ANGLE_DEG) {
        corner = {
          number: 0,
          entry: wrap(at * step, track.length),
          apex: wrap((at + apexOffset) * step, track.length),
          exit: wrap((at + samples) * step, track.length),
          minRadius: 1 / peak,
          direction: s > 0 ? 'R' : 'L',
          angle: angleDeg,
        }
      }
    }
    runs.push({ samples, corner, start: at })
    k += samples
  }

  const corners: Corner[] = []
  let cornerSamples = 0
  for (const run of runs) {
    if (run.corner) {
      corners.push(run.corner)
      cornerSamples += run.samples
    }
  }

  // Longest straight: join consecutive non-corner runs, walking the lap once
  // starting just after a corner so a straight across the array end stays whole.
  let longestStraight = track.length
  let longestStraightStart = 0
  const firstCorner = runs.findIndex((r) => r.corner !== null)
  if (firstCorner >= 0) {
    longestStraight = 0
    let current = 0
    let currentStart = 0
    for (let i = 1; i <= runs.length; i++) {
      const run = runs[(firstCorner + i) % runs.length]
      if (run.corner) {
        if (current * step > longestStraight) {
          longestStraight = current * step
          longestStraightStart = wrap(currentStart * step, track.length)
        }
        current = 0
      } else {
        if (current === 0) currentStart = run.start
        current += run.samples
      }
    }
  }

  corners.sort((a, b) => a.apex - b.apex)
  corners.forEach((c, i) => (c.number = i + 1))

  let peakCurvature = 0
  let widthSum = 0
  for (let i = 0; i < n; i++) {
    peakCurvature = Math.max(peakCurvature, Math.abs(curvature[i]))
    widthSum += track.halfWidth[i] * 2
  }

  return {
    length: track.length,
    corners,
    longestStraight,
    longestStraightStart,
    minRadius: peakCurvature > 0 ? 1 / peakCurvature : Infinity,
    averageWidth: widthSum / n,
    cornerFraction: cornerSamples / n,
  }
}

export interface TrackIssue {
  level: 'error' | 'warning'
  message: string
}

/**
 * Checks that a track can actually be driven: long enough, no corner tighter
 * than the road is wide, and no two sections on top of each other.
 */
export function validateTrack(track: BuiltTrack): TrackIssue[] {
  const issues: TrackIssue[] = []
  const { n, step, x, y, halfWidth, curvature } = track

  if (track.length < TRACK_LIMITS.minLength) {
    issues.push({
      level: 'error',
      message: `Track is ${Math.round(track.length)} m long; it needs at least ${TRACK_LIMITS.minLength} m.`,
    })
  }

  // Inside edge folds over itself when the corner radius is below the half width.
  let tight = 0
  for (let i = 0; i < n; i++) {
    const c = Math.abs(curvature[i])
    if (c > 0 && 1 / c < halfWidth[i] + 1.5) tight++
  }
  if (tight > 0) {
    issues.push({
      level: 'error',
      message: 'A corner is tighter than the track is wide. Move the points apart or narrow the track.',
    })
  }

  // Overlap test with a uniform grid over the centreline samples.
  const cell = 24
  const grid = new Map<number, number[]>()
  const key = (cx: number, cy: number) => cx * 73856093 + cy * 19349663
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(x[i] / cell), Math.floor(y[i] / cell))
    const bucket = grid.get(k)
    if (bucket) bucket.push(i)
    else grid.set(k, [i])
  }

  let overlap = false
  let close = false
  for (let i = 0; i < n && !overlap; i++) {
    const cx = Math.floor(x[i] / cell)
    const cy = Math.floor(y[i] / cell)
    for (let ox = -1; ox <= 1 && !overlap; ox++) {
      for (let oy = -1; oy <= 1 && !overlap; oy++) {
        const bucket = grid.get(key(cx + ox, cy + oy))
        if (!bucket) continue
        for (const j of bucket) {
          if (j <= i) continue
          const reach = halfWidth[i] + halfWidth[j]
          // Samples that are neighbours along the lap are allowed to be close.
          const arc = Math.min(j - i, n - (j - i)) * step
          if (arc < 3 * reach + 20) continue
          const d = Math.hypot(x[i] - x[j], y[i] - y[j])
          if (d < reach) {
            overlap = true
            break
          }
          if (d < reach + 2 * track.def.kerbWidth + 2) close = true
        }
      }
    }
  }
  if (overlap) {
    issues.push({
      level: 'error',
      message: 'Two parts of the track overlap or cross. Circuits must not intersect themselves.',
    })
  } else if (close) {
    issues.push({
      level: 'warning',
      message: 'Two parts of the track run very close together; their run-off areas overlap.',
    })
  }

  return issues
}

export function isDrivable(issues: readonly TrackIssue[]): boolean {
  return !issues.some((i) => i.level === 'error')
}
