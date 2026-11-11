import { deriveSeed } from '../math/rng'
import type { TrackProfile } from '../profile/trackProfile'
import { createRace, stepLap, type RaceSetup } from '../race/engine'
import { raceParams, rankStrategies, type Strategy } from '../race/strategy'

/**
 * Monte Carlo evaluation of one car's strategy.
 *
 * Race number k of a study always uses the same seed, whatever strategy is
 * being tried, so every strategy meets the same grids, the same weather and
 * the same safety cars. The differences between two strategies' results are
 * then down to the strategies, not to one of them having drawn kinder races.
 */

export interface StudySetup {
  profile: TrackProfile
  laps: number
  rainChance: number
  /** Field size. */
  cars: number
  /** The car whose strategy is being chosen (index into DRIVERS). */
  driver: number
  seed: number
}

/** Results of a batch of races for one strategy, one entry per race. */
export interface Outcomes {
  /** Classified finishing position, 1 = won. */
  positions: Uint8Array
  /** Race time in seconds; 0 when the car retired. */
  times: Float32Array
  /** FLAG_* bits. */
  flags: Uint8Array
  /** Pit stops the car actually made. */
  stops: Uint8Array
}

/** A safety car or virtual safety car came out. */
export const FLAG_SAFETY = 1
/** It rained at some point. */
export const FLAG_RAIN = 2
/** The car did not finish. */
export const FLAG_RETIRED = 4

/** What the rest of the field chooses from: the leading plans on a clear track. */
export function rivalPlans(setup: StudySetup): Strategy[] {
  return rankStrategies(raceParams(setup.profile, setup.laps)).map((r) => r.strategy)
}

/**
 * Races `count` times with the study's car on `strategy`, starting at race
 * number `from`.
 */
export function simulate(
  setup: StudySetup,
  plans: Strategy[],
  strategy: Strategy,
  from: number,
  count: number,
): Outcomes {
  const positions = new Uint8Array(count)
  const times = new Float32Array(count)
  const flags = new Uint8Array(count)
  const stops = new Uint8Array(count)
  for (let k = 0; k < count; k++) {
    const race: RaceSetup = {
      profile: setup.profile,
      laps: setup.laps,
      seed: deriveSeed(setup.seed, from + k),
      rainChance: setup.rainChance,
      cars: setup.cars,
      plans,
      player: { driver: setup.driver, strategy },
      record: false,
    }
    const state = createRace(race)
    let flag = state.weather.plan.some((rain) => rain > 0) ? FLAG_RAIN : 0
    while (!state.finished) {
      stepLap(state, race)
      if (state.safetyCar !== 'none') flag |= FLAG_SAFETY
    }
    const car = state.cars[setup.driver]
    positions[k] = car.position
    stops[k] = car.stops
    if (car.running) times[k] = car.time
    else flag |= FLAG_RETIRED
    flags[k] = flag
  }
  return { positions, times, flags, stops }
}

/** Joins batches for the same strategy end to end. */
export function mergeOutcomes(parts: readonly Outcomes[]): Outcomes {
  const total = parts.reduce((n, p) => n + p.positions.length, 0)
  const positions = new Uint8Array(total)
  const times = new Float32Array(total)
  const flags = new Uint8Array(total)
  const stops = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    positions.set(p.positions, at)
    times.set(p.times, at)
    flags.set(p.flags, at)
    stops.set(p.stops, at)
    at += p.positions.length
  }
  return { positions, times, flags, stops }
}
