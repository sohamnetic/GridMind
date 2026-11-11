import { clamp, wrapAngle } from '../math/util'
import { arcPosition, lateralOffset, locateGlobal, locateNear, poseAt, surfaceAt } from '../track/build'
import { Surface, type BuiltTrack } from '../track/types'

/**
 * Simplified 2D "bicycle" model with a friction circle.
 *
 * It is a kinematic model: the car follows the path its front wheels ask for
 * until that path needs more grip than the tyres have, at which point it runs
 * wide (understeer) and scrubs speed. Downforce grows with speed squared, so
 * fast corners carry far more lateral load than slow ones.
 */
export interface CarParams {
  mass: number // kg
  power: number // W
  maxDriveForce: number // N, traction-limited launch force
  dragCoef: number // 0.5 * rho * Cd * A  (N per (m/s)^2)
  downforceCoef: number // 0.5 * rho * Cl * A (N per (m/s)^2)
  rollingResistance: number // N
  tyreMu: number // peak friction coefficient on clean track
  brakeDecel: number // m/s^2 requested at full pedal (tyres permitting)
  wheelbase: number // m
  maxSteer: number // rad at the front wheels
  steerRate: number // rad/s
  length: number // m
  width: number // m
}

export const DEFAULT_CAR: CarParams = {
  mass: 800,
  power: 720_000,
  maxDriveForce: 11_500,
  dragCoef: 0.85,
  downforceCoef: 2.6,
  rollingResistance: 300,
  tyreMu: 1.5,
  brakeDecel: 60,
  wheelbase: 3.4,
  maxSteer: 0.42,
  steerRate: 2.6,
  length: 5.4,
  width: 1.9,
}

const GRAVITY = 9.81

/** Grip multiplier and extra drag for each surface, indexed by Surface. */
const SURFACE_GRIP = [1, 0.9, 0.5, 0]
const SURFACE_DRAG_BASE = [0, 0.4, 4, 0] // m/s^2
const SURFACE_DRAG_SPEED = [0, 0, 0.1, 0] // 1/s

export interface CarInput {
  /** -1 (full left) .. +1 (full right). */
  steer: number
  /** 0 .. 1 */
  throttle: number
  /** 0 .. 1 */
  brake: number
}

export interface CarState {
  x: number
  y: number
  heading: number
  /** Forward speed (m/s), never negative. */
  speed: number
  /** Current front wheel angle (rad). */
  steer: number
  /** Nearest centreline sample. */
  index: number
  /** Distance along the centreline from sample 0 (m). */
  s: number
  /** Offset from the centreline; positive = left. */
  lateral: number
  surface: Surface
  crashed: boolean
  /** 0..1: how far the last step exceeded the available lateral grip. */
  sliding: number
  /** Net progress along the track since spawn (m); negative when reversing direction. */
  progress: number
  /** Simulated time since spawn (s). */
  time: number
}

export function createCar(track: BuiltTrack, s: number, lateral = 0): CarState {
  const pose = poseAt(track, s, lateral)
  const index = locateGlobal(track, pose.x, pose.y)
  return {
    x: pose.x,
    y: pose.y,
    heading: pose.heading,
    speed: 0,
    steer: 0,
    index,
    s: arcPosition(track, index, pose.x, pose.y),
    lateral: lateralOffset(track, index, pose.x, pose.y),
    surface: Surface.Track,
    crashed: false,
    sliding: 0,
    progress: 0,
    time: 0,
  }
}

/** Total tyre grip available as an acceleration (m/s^2) at a given speed. */
export function gripLimit(params: CarParams, speed: number, gripMult = 1): number {
  return params.tyreMu * gripMult * (GRAVITY + (params.downforceCoef * speed * speed) / params.mass)
}

/**
 * Advances one car by `dt` seconds.
 *
 * @param gripMult extra grip multiplier (tyre state, wet track); 1 = fresh dry tyres.
 * @param dragMult drag multiplier (slipstream, DRS); 1 = clean air.
 */
export function stepCar(
  car: CarState,
  input: CarInput,
  track: BuiltTrack,
  params: CarParams,
  dt: number,
  gripMult = 1,
  dragMult = 1,
): void {
  if (car.crashed) return
  car.time += dt

  const v = car.speed
  const surface = car.surface
  const aMax = Math.max(0.5, gripLimit(params, v, gripMult * SURFACE_GRIP[surface]))

  // --- Longitudinal forces through the tyres (friction-limited) ---
  const throttle = clamp(input.throttle, 0, 1)
  const brake = clamp(input.brake, 0, 1)
  const drive = (throttle * Math.min(params.maxDriveForce, params.power / Math.max(v, 1))) / params.mass
  const aTyre = clamp(drive - brake * params.brakeDecel, -aMax, aMax)

  // --- Friction circle: what is left for cornering ---
  const latAvail = Math.sqrt(Math.max(aMax * aMax - aTyre * aTyre, 0.04 * aMax * aMax))

  // --- Steering ---
  // Full lock asks for slightly more than the available grip, so the wheel
  // stays usable at every speed while the limit can still be overstepped.
  const v2 = Math.max(v * v, 1)
  const steerLimit = Math.min(params.maxSteer, Math.atan((params.wheelbase * latAvail * 1.1) / v2))
  const target = clamp(input.steer, -1, 1) * steerLimit
  const maxDelta = params.steerRate * dt
  car.steer += clamp(target - car.steer, -maxDelta, maxDelta)

  let kappa = Math.tan(car.steer) / params.wheelbase
  const latDemand = v * v * Math.abs(kappa)
  let scrub = 0
  if (latDemand > latAvail) {
    // Understeer: the car cannot follow the wheels and loses speed sliding.
    car.sliding = Math.min(1, latDemand / latAvail - 1)
    kappa = (Math.sign(kappa) * latAvail) / v2
    scrub = car.sliding * aMax * 0.5
  } else {
    car.sliding = 0
  }

  // --- Resistive forces ---
  const drag = (params.dragCoef * dragMult * v * v + params.rollingResistance) / params.mass
  const surfaceDrag = SURFACE_DRAG_BASE[surface] + SURFACE_DRAG_SPEED[surface] * v
  const resist = v > 0.01 ? drag + surfaceDrag + scrub : 0

  // --- Integrate ---
  car.speed = Math.max(0, v + (aTyre - resist) * dt)
  const vMid = (v + car.speed) / 2
  car.heading = wrapAngle(car.heading + vMid * kappa * dt)
  car.x += Math.cos(car.heading) * vMid * dt
  car.y += Math.sin(car.heading) * vMid * dt

  // --- Re-locate on the track ---
  const prevS = car.s
  car.index = locateNear(track, car.x, car.y, car.index, 3)
  car.s = arcPosition(track, car.index, car.x, car.y)
  car.lateral = lateralOffset(track, car.index, car.x, car.y)
  car.surface = surfaceAt(track, car.index, car.lateral)

  let ds = car.s - prevS
  if (ds > track.length / 2) ds -= track.length
  else if (ds < -track.length / 2) ds += track.length
  car.progress += ds

  if (car.surface === Surface.Wall) {
    car.crashed = true
    car.speed = 0
  }
}

/** Theoretical top speed on a straight in clean air (m/s). */
export function topSpeed(params: CarParams): number {
  // Solve power = (drag * v^2 + rolling) * v by fixed-point iteration.
  let v = Math.cbrt(params.power / params.dragCoef)
  for (let i = 0; i < 20; i++) {
    v = Math.cbrt((params.power - params.rollingResistance * v) / params.dragCoef)
  }
  return v
}
