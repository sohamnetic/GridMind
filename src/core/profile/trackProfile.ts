import { wrap, wrapAngle, wrapIndex } from '../math/util'
import { DEFAULT_CAR, gripLimit, topSpeed, type CarParams } from '../physics/car'
import { maxCornerSpeed } from '../physics/referenceDriver'
import type { TrackAnalysis } from '../track/analysis'
import { fractionToIndex, locateGlobal, projectIndex } from '../track/build'
import type { BuiltTrack } from '../track/types'

/**
 * What the lap-level race engine needs to know about a circuit. It is derived
 * from how cars actually drive the track, which is how the Circuit Lab and
 * the Pit Wall connect: a tight layout yields slower laps, harder overtaking
 * and a different pit-stop cost than a fast one.
 */
export interface TrackProfile {
  length: number
  /** Clean-air lap time of the quickest driver (s). */
  baseLapTime: number
  /** 'drivers' when measured from a trained AI lap, 'estimate' when computed from geometry. */
  source: 'drivers' | 'estimate'
  topSpeed: number
  averageSpeed: number
  /** Share of the lap spent accelerating or flat out (0..1). */
  fullThrottle: number
  /** Tyre load relative to a typical circuit (1 = average, higher wears tyres faster). */
  tyreStress: number
  /** Length of the pit lane (m) and the time lost driving it at the limit instead of racing. */
  pitLaneLength: number
  pitLossTime: number
  /** 0 = passing is easy, 1 = nearly impossible. */
  overtakingDifficulty: number
  /** Heavy braking zones at the end of a straight. */
  passingZones: number
}

/** Pit lane speed limit (80 km/h). */
export const PIT_SPEED = 80 / 3.6
/** Assumed pit lane length when a circuit has none drawn (m). */
const DEFAULT_PIT_LENGTH = 350
/** Mean squared lateral load (in g) of a typical lap, used to normalise tyre stress. */
const TYPICAL_LOAD = 3.2
const GRAVITY = 9.81

/** Speed and lateral acceleration at every centreline sample over one lap. */
export interface LapTrace {
  speed: Float64Array
  lateral: Float64Array
}

/**
 * Lap trace from first principles: the fastest a point-mass car can go along
 * the centreline, limited by cornering grip, traction and braking. It needs
 * no trained driver, and is slower than a real racing line.
 */
export function estimateTrace(track: BuiltTrack, params: CarParams = DEFAULT_CAR): LapTrace {
  const { n, step, curvature } = track
  const vTop = topSpeed(params)
  const speed = new Float64Array(n)
  for (let i = 0; i < n; i++) speed[i] = Math.min(vTop, maxCornerSpeed(params, Math.abs(curvature[i]), 0.95))

  // Two laps of each pass so the start of the array sees what comes before and after it.
  for (let k = 0; k < 2 * n; k++) {
    const i = k % n
    const j = (i + 1) % n
    const v = Math.max(speed[i], 1)
    const drive = Math.min(params.maxDriveForce, params.power / v) / params.mass
    const drag = (params.dragCoef * v * v + params.rollingResistance) / params.mass
    const grip = gripLimit(params, v)
    const lat = v * v * Math.abs(curvature[i])
    const room = Math.sqrt(Math.max(0, grip * grip - lat * lat))
    const accel = Math.min(drive, room) - drag
    speed[j] = Math.min(speed[j], Math.sqrt(Math.max(1, v * v + 2 * accel * step)))
  }
  for (let k = 2 * n; k > 0; k--) {
    const i = k % n
    const j = wrapIndex(i - 1, n)
    const v = Math.max(speed[i], 1)
    const drag = (params.dragCoef * v * v + params.rollingResistance) / params.mass
    const grip = gripLimit(params, v)
    const lat = v * v * Math.abs(curvature[i])
    const brake = Math.sqrt(Math.max(0, grip * grip - lat * lat)) + drag
    speed[j] = Math.min(speed[j], Math.sqrt(v * v + 2 * brake * step))
  }

  const lateral = new Float64Array(n)
  for (let i = 0; i < n; i++) lateral[i] = speed[i] * speed[i] * Math.abs(curvature[i])
  return { speed, lateral }
}

/**
 * Lap trace from a recorded drive: `path` holds x, y, speed triplets sampled
 * every `dt` seconds over one lap (see simulateDriver's bestLapPath).
 * Returns null if the recording does not cover the whole lap.
 */
export function traceFromPath(track: BuiltTrack, path: Float32Array, dt = 0.1): LapTrace | null {
  const { n } = track
  const count = Math.floor(path.length / 3)
  if (count < 10) return null

  const speed = new Float64Array(n).fill(-1)
  const lateral = new Float64Array(n)
  let index = locateGlobal(track, path[0], path[1])
  let prevIndex = index
  let prevHeading = 0
  let covered = 0

  for (let k = 0; k < count; k++) {
    const x = path[k * 3]
    const y = path[k * 3 + 1]
    const v = path[k * 3 + 2]
    index = projectIndex(track, x, y, index, 4)

    // Lateral acceleration from how fast the direction of travel is turning.
    let lat = 0
    if (k + 1 < count) {
      const heading = Math.atan2(path[(k + 1) * 3 + 1] - y, path[(k + 1) * 3] - x)
      if (k > 0) lat = (Math.abs(wrapAngle(heading - prevHeading)) / dt) * v
      prevHeading = heading
    }

    // Fill every centreline sample passed since the previous path sample.
    const gap = k === 0 ? 0 : wrap(index - prevIndex, n)
    if (gap < n / 2) {
      for (let d = 0; d <= gap; d++) {
        const i = wrapIndex(prevIndex + d, n)
        if (speed[i] < 0) covered++
        speed[i] = v
        lateral[i] = lat
      }
    }
    prevIndex = index
  }

  if (covered < n * 0.97) return null
  // Patch the few samples the recording skipped with their neighbours.
  for (let i = 0; i < 2 * n; i++) {
    const a = i % n
    if (speed[a] < 0) {
      const b = wrapIndex(a - 1, n)
      if (speed[b] >= 0) {
        speed[a] = speed[b]
        lateral[a] = lateral[b]
      }
    }
  }
  for (let i = 0; i < n; i++) if (speed[i] < 1) speed[i] = 1
  return { speed, lateral }
}

/** Time to drive `count` samples forward from sample `from` at the trace's speeds (s). */
function traceTime(track: BuiltTrack, trace: LapTrace, from: number, count: number): number {
  let t = 0
  for (let d = 0; d < count; d++) t += track.step / trace.speed[wrapIndex(from + d, track.n)]
  return t
}

/**
 * Builds the profile from a lap trace.
 *
 * @param baseLapTime measured lap time; when omitted it is integrated from the trace.
 * @param pitLaneLength drawn pit lane length (m), or 0 if the circuit has none.
 */
export function buildProfile(
  track: BuiltTrack,
  analysis: TrackAnalysis,
  trace: LapTrace,
  source: TrackProfile['source'],
  { baseLapTime = 0, pitLaneLength = 0 } = {},
): TrackProfile {
  const { n, step } = track
  const { speed, lateral } = trace
  const lapTime = baseLapTime > 0 ? baseLapTime : traceTime(track, trace, 0, n)

  let top = 0
  let throttleTime = 0
  let loadTime = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const v = speed[i]
    const dt = step / v
    total += dt
    top = Math.max(top, v)
    // Accelerating or holding speed: the driver is on the throttle.
    const next = speed[(i + 1) % n]
    if ((next * next - v * v) / (2 * step) > -1) throttleTime += dt
    const g = lateral[i] / GRAVITY
    loadTime += g * g * dt
  }

  // Pit lane: time at the speed limit, against racing through the same stretch.
  const pit = track.def.pit
  const lane = pitLaneLength > 0 ? pitLaneLength : DEFAULT_PIT_LENGTH
  let racingTime: number
  if (pit && pitLaneLength > 0) {
    const from = fractionToIndex(pit.entry, n)
    racingTime = traceTime(track, trace, from, Math.round(wrap(pit.exit - pit.entry, 1) * n))
  } else {
    // No pit lane drawn: assume one alongside the start/finish straight.
    const count = Math.round(lane / step)
    racingTime = traceTime(track, trace, wrapIndex(track.startIndex - Math.round(count / 2), n), count)
  }
  const pitLossTime = Math.max(5, lane / PIT_SPEED - racingTime)

  // Passing zones: a straight that ends in a big stop. These come from the
  // physics-limit trace rather than the recorded lap, so the answer describes
  // the circuit and not how hard one particular driver happens to brake.
  const limit = source === 'estimate' ? speed : estimateTrace(track).speed
  const startS = track.def.startFraction * track.length
  let zones = 0
  let zoneWeight = 0
  for (let c = 0; c < analysis.corners.length; c++) {
    const corner = analysis.corners[c]
    const previous = analysis.corners[(c - 1 + analysis.corners.length) % analysis.corners.length]
    const straight = analysis.corners.length > 1 ? wrap(corner.entry - previous.exit, track.length) : track.length
    if (straight < 200) continue
    const apex = fractionToIndex((startS + corner.apex) / track.length, n)
    let approach = 0
    for (let d = 0; d < Math.round(200 / step); d++) approach = Math.max(approach, limit[wrapIndex(apex - d, n)])
    let slowest = Infinity
    for (let d = -5; d <= 5; d++) slowest = Math.min(slowest, limit[wrapIndex(apex + d, n)])
    // Heavy braking: the corner is taken at under two thirds of the approach speed.
    if (slowest > approach * 0.65) continue
    zones++
    // A longer run-up gives the car behind more time in the tow.
    zoneWeight += Math.min(1, Math.max(0.4, (straight - 100) / 400))
  }
  const drs = Math.min(3, track.def.drsZones.length)
  const difficulty = 0.95 - 0.22 * zoneWeight - 0.06 * drs - 0.04 * (analysis.averageWidth - 12)

  return {
    length: track.length,
    baseLapTime: lapTime,
    source,
    topSpeed: top,
    averageSpeed: track.length / lapTime,
    fullThrottle: throttleTime / total,
    tyreStress: Math.min(1.6, Math.max(0.6, Math.sqrt(loadTime / total / TYPICAL_LOAD))),
    pitLaneLength: lane,
    pitLossTime,
    overtakingDifficulty: Math.min(0.95, Math.max(0.15, difficulty)),
    passingZones: zones,
  }
}

/** Profile from geometry alone, for circuits whose drivers have not been trained yet. */
export function estimateProfile(track: BuiltTrack, analysis: TrackAnalysis, pitLaneLength = 0): TrackProfile {
  return buildProfile(track, analysis, estimateTrace(track), 'estimate', { pitLaneLength })
}

/** Profile from the best trained driver's lap; falls back to the estimate if the recording is unusable. */
export function measureProfile(
  track: BuiltTrack,
  analysis: TrackAnalysis,
  bestLapPath: Float32Array,
  bestLap: number,
  pitLaneLength = 0,
): TrackProfile {
  const trace = traceFromPath(track, bestLapPath)
  if (!trace) return estimateProfile(track, analysis, pitLaneLength)
  return buildProfile(track, analysis, trace, 'drivers', { baseLapTime: bestLap, pitLaneLength })
}
