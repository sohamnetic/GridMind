import { clamp, wrapAngle, wrapIndex } from '../math/util'
import { poseAt } from '../track/build'
import type { BuiltTrack } from '../track/types'
import { gripLimit, type CarInput, type CarParams, type CarState } from './car'

const GRAVITY = 9.81

/**
 * Hand-written centreline follower.
 *
 * It is not the AI: it knows the whole track and simply steers at a point
 * ahead (pure pursuit) while braking for upcoming curvature. It gives tests a
 * way to complete laps, and gives the learned drivers a baseline lap time to
 * beat.
 *
 * @param aggression fraction of the grip limit used for corner speed (0..1).
 */
export function referenceDriver(
  car: CarState,
  track: BuiltTrack,
  params: CarParams,
  out: CarInput,
  aggression = 0.8,
): void {
  const v = car.speed

  // --- Steering: aim at a point further ahead the faster we go ---
  const lookahead = 9 + v * 0.22
  const target = poseAt(track, car.s + lookahead)
  const dx = target.x - car.x
  const dy = target.y - car.y
  const dist = Math.hypot(dx, dy) || 1
  const alpha = wrapAngle(Math.atan2(dy, dx) - car.heading)
  const kappa = (2 * Math.sin(alpha)) / dist
  const wheelAngle = Math.atan(params.wheelbase * kappa)
  const steerLimit = Math.min(
    params.maxSteer,
    Math.atan((params.wheelbase * gripLimit(params, v) * 1.1) / Math.max(v * v, 1)),
  )
  out.steer = clamp(wheelAngle / steerLimit, -1, 1)

  // --- Speed: the fastest we may go now and still make every corner ahead ---
  const brakeDecel = 0.75 * params.tyreMu * GRAVITY * 1.6
  const horizon = (v * v) / (2 * brakeDecel) + 40
  const samples = Math.ceil(horizon / track.step)
  let limit = Infinity
  for (let k = 0; k <= samples; k++) {
    const c = Math.abs(track.curvature[wrapIndex(car.index + k, track.n)])
    const cornerSpeed = maxCornerSpeed(params, c, aggression)
    if (cornerSpeed === Infinity) continue
    const d = k * track.step
    limit = Math.min(limit, Math.sqrt(cornerSpeed * cornerSpeed + 2 * brakeDecel * d))
  }

  if (v > limit) {
    out.throttle = 0
    out.brake = clamp((v - limit) / 4, 0.15, 1)
  } else {
    out.throttle = clamp((limit - v) / 3, 0.2, 1)
    out.brake = 0
  }
}

/** Speed at which a corner of the given curvature uses `usage` of the grip limit. */
export function maxCornerSpeed(params: CarParams, curvature: number, usage = 1): number {
  // v^2 * k = usage * mu * (g + c * v^2 / m)  =>  v^2 = usage*mu*g / (k - usage*mu*c/m)
  const denom = curvature - (usage * params.tyreMu * params.downforceCoef) / params.mass
  if (denom <= 0) return Infinity
  return Math.sqrt((usage * params.tyreMu * GRAVITY) / denom)
}
