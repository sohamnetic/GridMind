import { clamp, wrapAngle } from '../math/util'
import type { CarState } from '../physics/car'
import { lateralOffset, meanCurvature, projectIndex } from '../track/build'
import type { BuiltTrack } from '../track/types'

const DEG = Math.PI / 180

/** Ray directions relative to the car's heading; negative = to the left. */
export const RAY_ANGLES: readonly number[] = [-75, -40, -18, 0, 18, 40, 75].map((d) => d * DEG)
const RAY_COS = RAY_ANGLES.map(Math.cos)
const RAY_SIN = RAY_ANGLES.map(Math.sin)
/** Rays report distances up to this far (m). */
export const RAY_RANGE = 160

/** Look-ahead windows (m) over which upcoming curvature is averaged. */
const CURVATURE_WINDOWS: readonly (readonly [number, number])[] = [
  [0, 25],
  [25, 70],
  [70, 150],
]

/**
 * What a driver perceives, in this order:
 *   rays (7)      distance to the edge of the road along each ray, 0..1
 *   speed         0..~1
 *   heading       angle between the car and the track direction
 *   lateral       position across the road, -1 (right edge) .. +1 (left edge)
 *   curvature (3) average curvature of the next three stretches of track
 */
export const SENSOR_COUNT = RAY_ANGLES.length + 3 + CURVATURE_WINDOWS.length

export function readSensors(car: CarState, track: BuiltTrack, out: Float32Array): void {
  let k = 0
  const ch = Math.cos(car.heading)
  const sh = Math.sin(car.heading)
  for (let r = 0; r < RAY_ANGLES.length; r++) {
    // Direction of heading + ray angle, from the angle-sum identities.
    const dx = ch * RAY_COS[r] - sh * RAY_SIN[r]
    const dy = sh * RAY_COS[r] + ch * RAY_SIN[r]
    out[k++] = castRay(track, car.x, car.y, dx, dy, car.index) / RAY_RANGE
  }
  out[k++] = car.speed / 90
  out[k++] = clamp(wrapAngle(car.heading - track.heading[car.index]), -2, 2)
  out[k++] = clamp(car.lateral / track.halfWidth[car.index], -2, 2)

  const { step } = track
  for (let w = 0; w < CURVATURE_WINDOWS.length; w++) {
    const from = car.index + Math.round(CURVATURE_WINDOWS[w][0] / step)
    const to = car.index + Math.max(1, Math.round(CURVATURE_WINDOWS[w][1] / step))
    // A 30 m radius corner reads as 1.
    out[k++] = clamp(meanCurvature(track, from, to) * 30, -1.5, 1.5)
  }
}

/**
 * Distance from (x0, y0) along the unit direction (dx, dy) to the edge of the
 * racing surface.
 *
 * The ray is marched in steps proportional to the room left to the nearest
 * edge, carrying the centreline sample along by projection, and the crossing
 * is then refined by bisection. No edge geometry is needed and a ray costs a
 * few dozen multiplications.
 */
export function castRay(
  track: BuiltTrack,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  hint: number,
): number {
  const { halfWidth } = track
  let index = hint
  let d = 0
  let stride = 2.5

  while (d < RAY_RANGE) {
    const next = Math.min(RAY_RANGE, d + stride)
    const px = x0 + dx * next
    const py = y0 + dy * next
    index = projectIndex(track, px, py, index)
    const room = halfWidth[index] - Math.abs(lateralOffset(track, index, px, py))
    if (room < 0) {
      let lo = d
      let hi = next
      for (let i = 0; i < 3; i++) {
        const mid = (lo + hi) / 2
        const mx = x0 + dx * mid
        const my = y0 + dy * mid
        const mi = projectIndex(track, mx, my, index)
        if (Math.abs(lateralOffset(track, mi, mx, my)) > halfWidth[mi]) hi = mid
        else lo = mid
      }
      return (lo + hi) / 2
    }
    d = next
    // The edge is about `room` away or more, so stride in proportion to it. A
    // slightly generous stride can only miss a sliver of grass at a corner.
    stride = room * 1.6
    if (stride < 2.5) stride = 2.5
    else if (stride > 14) stride = 14
  }
  return RAY_RANGE
}
