import { clamp } from '../math/util'
import type { CarState } from '../physics/car'
import { gapAlong } from '../physics/traffic'
import type { BuiltTrack } from '../track/types'
import { SENSOR_COUNT } from './sensors'

const DEG = Math.PI / 180

/** Directions of the car-detecting rays, relative to the heading. */
const CAR_RAY_ANGLES: readonly number[] = [-45, -15, 0, 15, 45].map((d) => d * DEG)
const CAR_RAY_COS = CAR_RAY_ANGLES.map(Math.cos)
const CAR_RAY_SIN = CAR_RAY_ANGLES.map(Math.sin)
const CAR_RAY_RANGE = 60

/** Each car is seen as two discs, one over each axle. */
const DISC_OFFSET = 1.4
const DISC_RADIUS = 1.3

const AHEAD_RANGE = 60
const BEHIND_RANGE = 30

/**
 * Extra inputs for racing in traffic, appended after the solo sensors:
 *   car rays (5)   closeness of the nearest car along each ray, 0 = none .. 1 = touching
 *   closing        speed difference to the car ahead in the same lane (+ = catching it)
 *   behind         closeness of the nearest car behind
 *   behind side    which side that car is on (+ = left), scaled by its closeness
 *
 * Every one of these is 0 on an empty road. A network that learned to drive
 * alone therefore behaves exactly as before until its new weights are trained.
 */
export const TRAFFIC_SENSOR_COUNT = CAR_RAY_ANGLES.length + 3
export const RACE_SENSOR_COUNT = SENSOR_COUNT + TRAFFIC_SENSOR_COUNT

export function readTrafficSensors(
  self: number,
  cars: readonly CarState[],
  active: Uint8Array,
  track: BuiltTrack,
  out: Float32Array,
  offset: number,
): void {
  const car = cars[self]
  const rays = CAR_RAY_ANGLES.length
  const ch = Math.cos(car.heading)
  const sh = Math.sin(car.heading)

  let k = offset
  for (let r = 0; r < rays; r++) out[k + r] = CAR_RAY_RANGE

  let aheadGap = AHEAD_RANGE
  let closing = 0
  let behindGap = BEHIND_RANGE
  let behindSide = 0

  for (let j = 0; j < cars.length; j++) {
    if (j === self || !active[j]) continue
    const other = cars[j]
    const gap = gapAlong(track, car, other)
    if (gap > CAR_RAY_RANGE + 6 || gap < -BEHIND_RANGE) continue
    const side = other.lateral - car.lateral

    if (gap > 0 && gap < aheadGap && Math.abs(side) < 3) {
      aheadGap = gap
      closing = car.speed - other.speed
    }
    if (gap < 0 && -gap < behindGap) {
      behindGap = -gap
      behindSide = side
    }

    // Ray against the two discs of the other car.
    const oc = Math.cos(other.heading) * DISC_OFFSET
    const os = Math.sin(other.heading) * DISC_OFFSET
    for (let disc = -1; disc <= 1; disc += 2) {
      const cx = other.x + oc * disc - car.x
      const cy = other.y + os * disc - car.y
      for (let r = 0; r < rays; r++) {
        const dx = ch * CAR_RAY_COS[r] - sh * CAR_RAY_SIN[r]
        const dy = sh * CAR_RAY_COS[r] + ch * CAR_RAY_SIN[r]
        const along = cx * dx + cy * dy
        if (along <= 0) continue
        const miss2 = cx * cx + cy * cy - along * along
        if (miss2 >= DISC_RADIUS * DISC_RADIUS) continue
        const hit = along - Math.sqrt(DISC_RADIUS * DISC_RADIUS - miss2)
        if (hit < out[k + r]) out[k + r] = Math.max(0, hit)
      }
    }
  }

  for (let r = 0; r < rays; r++) out[k + r] = 1 - out[k + r] / CAR_RAY_RANGE
  k += rays
  out[k++] = aheadGap < AHEAD_RANGE ? clamp(closing / 30, -1, 1) : 0
  const closeness = 1 - behindGap / BEHIND_RANGE
  out[k++] = closeness
  out[k++] = clamp(behindSide / 4, -1, 1) * closeness
}
