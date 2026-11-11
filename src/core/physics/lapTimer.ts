import { wrap } from '../math/util'
import type { BuiltTrack } from '../track/types'

/**
 * Lap and sector timing for one car.
 *
 * A lap only counts when the car passes sector 1, sector 2 and the line in
 * order, so driving backwards over the line or cutting across the infield
 * never produces a lap time.
 */
export interface LapTimer {
  /** False until the car first crosses the start/finish line. */
  running: boolean
  /** Completed laps. */
  laps: number
  /** Sector the car is currently in (0, 1 or 2). */
  sector: number
  lapStart: number
  sectorStart: number
  /** Sector times of the lap in progress. */
  current: number[]
  lastLap: number | null
  lastSectors: number[] | null
  bestLap: number | null
  bestSectors: number[] | null
  /** Position relative to the line at the previous update (0..1). */
  prev: number
  /** Sector boundaries as lap fractions from the line, cached from the track. */
  b1: number
  b2: number
}

export interface LapEvent {
  type: 'start' | 'sector' | 'lap'
  /** Sector that just ended (0 or 1) for 'sector' events. */
  sector?: number
  time?: number
  /** True when a 'lap' event set a new best. */
  best?: boolean
}

export function createLapTimer(track: BuiltTrack, s: number): LapTimer {
  const [b1, b2] = sectorBoundaries(track)
  return {
    running: false,
    laps: 0,
    sector: 0,
    lapStart: 0,
    sectorStart: 0,
    current: [],
    lastLap: null,
    lastSectors: null,
    bestLap: null,
    bestSectors: null,
    prev: relativePosition(track, s),
    b1,
    b2,
  }
}

/** Lap fraction measured from the start/finish line. */
export function relativePosition(track: BuiltTrack, s: number): number {
  return wrap(s / track.length - track.def.startFraction, 1)
}

/** Sector boundaries as fractions from the start line, in driving order. */
export function sectorBoundaries(track: BuiltTrack): [number, number] {
  const start = track.def.startFraction
  const a = wrap(track.def.sectors[0] - start, 1)
  const b = wrap(track.def.sectors[1] - start, 1)
  return a <= b ? [a, b] : [b, a]
}

/**
 * Call once per physics step after the car has moved.
 * `time` is the car's clock after the step and `speed` its current speed; they
 * are used to interpolate the exact moment a line was crossed.
 */
export function updateLapTimer(
  timer: LapTimer,
  track: BuiltTrack,
  s: number,
  speed: number,
  time: number,
): LapEvent | null {
  const rel = relativePosition(track, s)
  const prev = timer.prev
  timer.prev = rel

  const delta = rel - prev
  if (delta > 0.5) return null // wrapped backwards over the line
  const crossedLine = delta < -0.5 // wrapped forwards over the line

  // This runs for every car on every physics step, so the common case (no
  // line crossed) must return without allocating anything.
  if (!crossedLine) {
    if (!timer.running) return null
    if (timer.sector === 0 && prev < timer.b1 && rel >= timer.b1) {
      return endSector(timer, crossingTime(track, rel, timer.b1, speed, time))
    }
    if (timer.sector === 1 && prev < timer.b2 && rel >= timer.b2) {
      return endSector(timer, crossingTime(track, rel, timer.b2, speed, time))
    }
    return null
  }

  const t = crossingTime(track, rel, 0, speed, time)
  if (!timer.running || timer.sector !== 2) {
    // First crossing, or the line was crossed without completing the sectors:
    // (re)start timing, no lap.
    timer.running = true
    timer.sector = 0
    timer.lapStart = t
    timer.sectorStart = t
    timer.current = []
    return { type: 'start' }
  }

  timer.current.push(t - timer.sectorStart)
  const lapTime = t - timer.lapStart
  const best = timer.bestLap === null || lapTime < timer.bestLap
  timer.lastLap = lapTime
  timer.lastSectors = timer.current
  if (best) {
    timer.bestLap = lapTime
    timer.bestSectors = timer.current
  }
  timer.laps++
  timer.sector = 0
  timer.lapStart = t
  timer.sectorStart = t
  timer.current = []
  return { type: 'lap', time: lapTime, best }
}

/** Time at which the boundary `at` (lap fraction) was crossed during the step that ended at `time`. */
function crossingTime(track: BuiltTrack, rel: number, at: number, speed: number, time: number): number {
  const overshoot = wrap(rel - at, 1) * track.length
  return speed > 0.1 ? time - Math.min(overshoot / speed, 1) : time
}

function endSector(timer: LapTimer, t: number): LapEvent {
  const sectorTime = t - timer.sectorStart
  timer.current.push(sectorTime)
  const ended = timer.sector
  timer.sector++
  timer.sectorStart = t
  return { type: 'sector', sector: ended, time: sectorTime }
}

/** Formats seconds as m:ss.mmm (or ss.mmm under a minute). */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–'
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  const secs = rest.toFixed(3).padStart(6, '0')
  return minutes > 0 ? `${minutes}:${secs}` : rest.toFixed(3)
}
