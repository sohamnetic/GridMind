import type { RaceLog, RaceState } from './engine'

/**
 * Replaying a finished race.
 *
 * The lap-level engine only knows when each car crossed the line. That is
 * enough to put every car on the track at any moment: between two of its
 * crossings a car is that share of the way round. Gaps on the road are then
 * the gaps on the timing screen, and a safety car shows as the field closing
 * up into a train. A lap that ends in a pit stop is driven at racing speed
 * and the stop is spent at the end of it, crawling up to the line.
 */

export interface RaceReplay {
  /** For each car, the race time at which it finished each lap, starting with 0 at the start. */
  crossings: Float64Array[]
  /** For each car, the time its stop took at the end of each lap it completed (s); 0 for a lap with no stop. */
  pits: Float32Array[]
  /** The lap each car retired on, or 0. */
  outLap: number[]
  /** Grid slot of each car, 1 = pole. */
  grid: number[]
  laps: number
  /** Race time when the last running car took the flag (s). */
  duration: number
  /** Race time when the winner took the flag (s). */
  winnerTime: number
}

/** A car that has retired stays on screen for this share of a lap before it is taken away. */
const RETIRE_SHARE = 0.5
/** Share of a lap covered by the time a stopping car reaches the pits; the rest it crawls during the stop. */
const PIT_ENTRY = 0.985

/** Builds the replay of a finished race. The race must have been run with its history recorded. */
export function buildReplay(race: RaceState): RaceReplay {
  const crossings = race.cars.map((car) => {
    const times = new Float64Array(car.lapTimes.length + 1)
    for (let i = 0; i < car.lapTimes.length; i++) times[i + 1] = times[i] + car.lapTimes[i]
    return times
  })
  const pits = race.cars.map((car) => new Float32Array(car.lapTimes.length))
  for (const entry of race.log) {
    if (entry.type !== 'pit' || entry.car === undefined) continue
    const stops = pits[entry.car]
    // Never the whole lap: a car that stops still has to drive round to do it.
    if (entry.lap >= 1 && entry.lap <= stops.length) {
      stops[entry.lap - 1] = Math.min(entry.value ?? 0, race.cars[entry.car].lapTimes[entry.lap - 1] * 0.6)
    }
  }
  let duration = 0
  let winnerTime = Infinity
  race.cars.forEach((car, i) => {
    if (!car.running) return
    const end = crossings[i][crossings[i].length - 1]
    duration = Math.max(duration, end)
    winnerTime = Math.min(winnerTime, end)
  })
  if (!Number.isFinite(winnerTime)) winnerTime = duration
  return {
    crossings,
    pits,
    outLap: race.cars.map((car) => car.outLap),
    grid: race.cars.map((car) => car.grid),
    laps: race.totalLaps,
    duration,
    winnerTime,
  }
}

/** Laps a car has completed at `clock`. */
function lapsDone(times: Float64Array, clock: number): number {
  // Binary search: the last crossing at or before the clock.
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (times[mid] <= clock) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Distance each car has covered at `clock`, in laps (3.25 = a quarter of the
 * way round its fourth lap), or -1 for a car that is out of the race.
 */
export function replayDistances(replay: RaceReplay, clock: number, out: Float32Array): void {
  const t = Math.max(0, clock)
  for (let c = 0; c < replay.crossings.length; c++) {
    const times = replay.crossings[c]
    const done = lapsDone(times, t)
    if (done < times.length - 1) {
      const lap = times[done + 1] - times[done]
      const into = t - times[done]
      const stop = replay.pits[c][done]
      if (stop > 0 && lap > stop) {
        // Round the lap at racing speed, then the stop.
        const driving = lap - stop
        out[c] =
          done +
          (into < driving ? (into / driving) * PIT_ENTRY : PIT_ENTRY + ((into - driving) / stop) * (1 - PIT_ENTRY))
      } else {
        out[c] = done + (lap > 0 ? into / lap : 0)
      }
      continue
    }
    // Past its last crossing: at the flag, or on the lap it retired on.
    if (replay.outLap[c] === 0) {
      out[c] = done
      continue
    }
    const previous = done > 0 ? times[done] - times[done - 1] : times[done] || 90
    const share = previous > 0 ? (t - times[done]) / previous : 1
    out[c] = share < RETIRE_SHARE ? done + share : -1
  }
}

/**
 * Where each car is on the lap at `clock`: its fraction of a lap from the
 * start line, or -1 if it is out of the race. Before the start the field is
 * lined up on the grid, and it strings out from there over the first lap.
 */
export function replayFractions(replay: RaceReplay, clock: number, out: Float32Array): void {
  replayDistances(replay, clock, out)
  for (let c = 0; c < out.length; c++) {
    const d = out[c]
    if (d < 0) continue
    let f = d - Math.floor(d)
    if (d < 1) {
      f -= (replay.grid[c] - 1) * 0.004 * (1 - d)
      f -= Math.floor(f)
    }
    out[c] = f
  }
}

/** Whether a car is making a pit stop at `clock`. */
export function replayInPit(replay: RaceReplay, car: number, clock: number): boolean {
  const times = replay.crossings[car]
  const done = lapsDone(times, Math.max(0, clock))
  if (done >= times.length - 1) return false
  const stop = replay.pits[car][done]
  return stop > 0 && clock >= times[done + 1] - stop
}

/** The lap the leader is on at `clock`, from 1 to the race distance. */
export function replayLap(replay: RaceReplay, clock: number): number {
  let most = 0
  for (const times of replay.crossings) most = Math.max(most, lapsDone(times, Math.max(0, clock)))
  return Math.min(replay.laps, most + 1)
}

/** The running order at `clock`: car indices by distance covered, cars out of the race last. */
export function replayOrder(replay: RaceReplay, clock: number): number[] {
  const distance = new Float32Array(replay.crossings.length)
  replayDistances(replay, clock, distance)
  /** When a car completed the last whole lap of the distance it has covered. */
  const reached = (car: number, covered: number): number => {
    const times = replay.crossings[car]
    return times[Math.min(times.length - 1, Math.floor(covered))]
  }
  return Array.from(distance.keys()).sort((a, b) => {
    const da = distance[a]
    const db = distance[b]
    if (da < 0 !== db < 0) return da < 0 ? 1 : -1
    if (da < 0) return replay.outLap[b] - replay.outLap[a] || a - b
    // Level on distance: whoever got there first is ahead. That settles the
    // flag, where every finisher has covered the same laps; on the grid nobody
    // has moved yet, and the grid order stands.
    return db - da || reached(a, da) - reached(b, db) || replay.grid[a] - replay.grid[b]
  })
}

export type MomentType = 'start' | 'overtake' | 'passed' | 'pit' | 'sc' | 'green' | 'rain' | 'dry' | 'out' | 'flag'

/** Something worth jumping to in a replay. */
export interface ReplayMoment {
  /** Race time to jump to (s): a little before it happens. */
  time: number
  lap: number
  type: MomentType
  /** The car it happened to, where it happened to one. */
  car?: number
  other?: number
}

/**
 * The moments of a race worth jumping to, in order: the start, the safety
 * cars, the weather, the retirements and the flag, and for the car being
 * followed its stops, the passes it made and the times it was passed.
 */
export function replayMoments(race: RaceState, replay: RaceReplay, focus: number): ReplayMoment[] {
  const out: ReplayMoment[] = [{ time: 0, lap: 1, type: 'start' }]
  const leader = replay.crossings[race.order[0]] ?? replay.crossings[0]
  /** When lap `lap` began for a car, falling back on the leader for one that never got there. */
  const lapStart = (car: number | undefined, lap: number): number => {
    const times = car !== undefined ? replay.crossings[car] : leader
    const index = Math.max(0, lap - 1)
    return index < times.length ? times[index] : (leader[Math.min(index, leader.length - 1)] ?? 0)
  }
  const add = (entry: RaceLog, type: MomentType, car?: number, into = 0.1) => {
    const start = lapStart(car, entry.lap)
    const end = lapStart(car, entry.lap + 1)
    // Events are logged by lap, so a jump lands early in the lap and lets it play out; a stop is near its end.
    const time = end > start ? start + (end - start) * into : start
    out.push({ time, lap: entry.lap, type, car, other: entry.other })
  }
  for (const entry of race.log) {
    switch (entry.type) {
      case 'overtake':
        if (entry.car === focus) add(entry, 'overtake', focus)
        else if (entry.other === focus)
          out.push({
            ...momentAt(entry, lapStart(focus, entry.lap), lapStart(focus, entry.lap + 1)),
            type: 'passed',
            car: focus,
            other: entry.car,
          })
        break
      case 'pit':
        if (entry.car === focus) add(entry, 'pit', focus, 0.6)
        break
      case 'sc':
      case 'vsc':
        // Deployed for the lap after the one it is logged on.
        add({ ...entry, lap: entry.lap + 1 }, 'sc', undefined, 0)
        break
      case 'green':
        add({ ...entry, lap: entry.lap + 1 }, 'green', undefined, 0)
        break
      case 'rain':
        add(entry, 'rain', undefined, 0)
        break
      case 'dry':
        add(entry, 'dry', undefined, 0)
        break
      case 'out':
        if (entry.car === focus) add(entry, 'out', focus, 0.1)
        break
      default:
        break
    }
  }
  out.push({ time: Math.max(0, replay.winnerTime - 8), lap: replay.laps, type: 'flag', car: race.order[0] })
  return out.sort((a, b) => a.time - b.time)
}

function momentAt(entry: RaceLog, start: number, end: number): { time: number; lap: number } {
  return { time: end > start ? start + (end - start) * 0.1 : start, lap: entry.lap }
}
