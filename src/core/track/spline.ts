import type { ControlPoint } from './types'

/** Dense polyline produced from the control points, before uniform resampling. */
export interface DensePath {
  x: number[]
  y: number[]
  /** Full track width at each dense vertex (m). */
  width: number[]
  /** Control segment index each vertex belongs to. */
  segment: number[]
  /** Dense vertex index where each control segment starts. */
  segmentStart: number[]
}

const EPS = 1e-4

/**
 * Closed centripetal Catmull-Rom spline through the control points.
 *
 * The centripetal parameterisation (alpha = 0.5) never forms cusps or loops
 * inside a segment, which matters for freehand input where point spacing is
 * very uneven.
 */
export function sampleClosedSpline(
  points: readonly ControlPoint[],
  defaultWidth: number,
  spacing = 1,
): DensePath {
  const n = points.length
  const out: DensePath = { x: [], y: [], width: [], segment: [], segmentStart: [] }
  if (n < 3) return out

  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]

    const t0 = 0
    const t1 = t0 + knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)

    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const subdivisions = Math.min(600, Math.max(8, Math.ceil(chord / spacing)))
    const w1 = p1.width ?? defaultWidth
    const w2 = p2.width ?? defaultWidth

    out.segmentStart.push(out.x.length)
    for (let k = 0; k < subdivisions; k++) {
      const u = k / subdivisions
      const t = t1 + u * (t2 - t1)

      const a1x = mix(p0.x, p1.x, t0, t1, t)
      const a1y = mix(p0.y, p1.y, t0, t1, t)
      const a2x = mix(p1.x, p2.x, t1, t2, t)
      const a2y = mix(p1.y, p2.y, t1, t2, t)
      const a3x = mix(p2.x, p3.x, t2, t3, t)
      const a3y = mix(p2.y, p3.y, t2, t3, t)

      const b1x = mix(a1x, a2x, t0, t2, t)
      const b1y = mix(a1y, a2y, t0, t2, t)
      const b2x = mix(a2x, a3x, t1, t3, t)
      const b2y = mix(a2y, a3y, t1, t3, t)

      out.x.push(mix(b1x, b2x, t1, t2, t))
      out.y.push(mix(b1y, b2y, t1, t2, t))
      // Smooth width blend so overrides do not create a visible kink.
      const s = u * u * (3 - 2 * u)
      out.width.push(w1 + (w2 - w1) * s)
      out.segment.push(i)
    }
  }
  return out
}

function knot(a: ControlPoint, b: ControlPoint): number {
  return Math.max(EPS, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)))
}

function mix(a: number, b: number, ta: number, tb: number, t: number): number {
  return ((tb - t) / (tb - ta)) * a + ((t - ta) / (tb - ta)) * b
}
