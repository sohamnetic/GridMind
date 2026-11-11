import type { ControlPoint } from './types'

interface Pt {
  x: number
  y: number
}

/**
 * Converts a freehand stroke (a dense, wobbly loop of world positions) into a
 * small set of spline control points.
 * Returns null when the stroke is too small to be a circuit.
 */
export function strokeToControlPoints(
  stroke: readonly Pt[],
  { tolerance = 8, minSpacing = 30, maxPoints = 40 } = {},
): ControlPoint[] | null {
  // Drop near-duplicate samples from slow pointer movement.
  const clean: Pt[] = []
  for (const p of stroke) {
    const last = clean[clean.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 2) clean.push({ x: p.x, y: p.y })
  }
  if (clean.length < 8) return null

  let tol = tolerance
  let simplified = rdp(clean, tol)
  while (simplified.length > maxPoints && tol < 200) {
    tol *= 1.3
    simplified = rdp(clean, tol)
  }

  // Enforce a minimum spacing so the spline has no tight wiggles.
  const spaced: Pt[] = []
  for (const p of simplified) {
    const last = spaced[spaced.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minSpacing) spaced.push(p)
  }
  // The loop closes itself: remove an end point that sits on top of the start.
  while (
    spaced.length > 3 &&
    Math.hypot(spaced[0].x - spaced[spaced.length - 1].x, spaced[0].y - spaced[spaced.length - 1].y) <
      minSpacing
  ) {
    spaced.pop()
  }

  if (spaced.length < 4) return null
  return spaced.map((p) => ({ x: round(p.x), y: round(p.y) }))
}

function round(v: number): number {
  return Math.round(v * 10) / 10
}

/** Ramer–Douglas–Peucker polyline simplification (iterative). */
function rdp(points: readonly Pt[], tolerance: number): Pt[] {
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    let worst = -1
    let worstD = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i], points[a], points[b])
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}
