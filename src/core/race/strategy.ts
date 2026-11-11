import type { TrackProfile } from '../profile/trackProfile'
import {
  COMPOUNDS,
  degradation,
  DRY_COMPOUNDS,
  REFERENCE_LAP,
  wearPerLap,
  type Compound,
} from './tyres'

/** A stop at the END of lap `lap` (1-based), fitting `compound`. */
export interface PitStop {
  lap: number
  compound: Compound
}

export interface Strategy {
  start: Compound
  stops: PitStop[]
}

/** The constants of one race on one circuit, derived from its profile. */
export interface RaceParams {
  laps: number
  baseLap: number
  /** Converts reference-lap seconds into this circuit's seconds. */
  scale: number
  tyreStress: number
  /** Time lost driving the pit lane instead of racing (s). */
  pitLoss: number
  /** Typical time stationary in the box (s). */
  stationary: number
  fuelPerLap: number
  /** Fuel on board at the start (kg). */
  fuelStart: number
  /** Lap time cost of each kilogram of fuel (s). */
  fuelPenalty: number
  overtakingDifficulty: number
}

export const STATIONARY_TIME = 2.6
/** Shortest stint the planner will consider (laps). */
export const MIN_STINT = 3

export function raceParams(profile: TrackProfile, laps: number): RaceParams {
  const scale = profile.baseLapTime / REFERENCE_LAP
  // Consumption follows distance and how long the driver spends on the throttle.
  const fuelPerLap = 0.33 * (profile.length / 1000) * (0.7 + 0.6 * profile.fullThrottle)
  return {
    laps,
    baseLap: profile.baseLapTime,
    scale,
    tyreStress: profile.tyreStress,
    pitLoss: profile.pitLossTime,
    stationary: STATIONARY_TIME,
    fuelPerLap,
    fuelStart: fuelPerLap * laps,
    fuelPenalty: 0.03 * scale,
    overtakingDifficulty: profile.overtakingDifficulty,
  }
}

/** Short label such as "M-H" for a strategy's compound sequence. */
export function strategyLabel(strategy: Strategy): string {
  return [strategy.start, ...strategy.stops.map((s) => s.compound)].map((c) => COMPOUNDS[c].short).join('-')
}

/** The rules require two different dry compounds in a race that stays dry. */
export function usesTwoDryCompounds(compounds: readonly Compound[]): boolean {
  const dry = new Set(compounds.filter((c) => COMPOUNDS[c].dry))
  return dry.size >= 2
}

/**
 * Race time of a strategy on a dry track with no traffic, safety cars or
 * luck: every lap is base pace plus tyre and fuel effects, and every stop
 * costs the pit lane and the time in the box.
 */
export function cleanAirTime(strategy: Strategy, params: RaceParams): number {
  let total = 0
  let compound = strategy.start
  let wear = 0
  let fuel = params.fuelStart
  let next = 0
  for (let lap = 1; lap <= params.laps; lap++) {
    total +=
      params.baseLap +
      params.scale * (COMPOUNDS[compound].pace + degradation(compound, wear)) +
      fuel * params.fuelPenalty
    wear += wearPerLap(compound, params.tyreStress, 'normal', fuel / params.fuelStart, 0)
    fuel -= params.fuelPerLap
    const stop = strategy.stops[next]
    if (stop && stop.lap === lap) {
      total += params.pitLoss + params.stationary
      compound = stop.compound
      wear = 0
      next++
    }
  }
  return total
}

export interface RankedStrategy {
  strategy: Strategy
  /** Clean-air race time (s). */
  time: number
  label: string
}

/** Every order of `length` dry compounds that uses at least two different ones. */
export function compoundSequences(length: number): Compound[][] {
  let out: Compound[][] = [[]]
  for (let i = 0; i < length; i++) out = out.flatMap((seq) => DRY_COMPOUNDS.map((c) => [...seq, c]))
  return out.filter(usesTwoDryCompounds)
}

/** Finds the best stop laps for a fixed sequence of compounds. */
function bestStops(compounds: Compound[], params: RaceParams): RankedStrategy {
  const stops = compounds.length - 1
  const laps = params.laps
  const build = (at: number[]): Strategy => ({
    start: compounds[0],
    stops: at.map((lap, i) => ({ lap, compound: compounds[i + 1] })),
  })
  const valid = (at: number[]): boolean => {
    let prev = 0
    for (const lap of at) {
      if (lap - prev < MIN_STINT) return false
      prev = lap
    }
    return laps - prev >= MIN_STINT
  }

  // Start from evenly spaced stops, then walk each stop a lap at a time
  // while that keeps making the race shorter.
  let at = Array.from({ length: stops }, (_, i) => Math.round(((i + 1) * laps) / (stops + 1)))
  if (!valid(at)) return { strategy: build(at), time: Infinity, label: '' }
  let time = cleanAirTime(build(at), params)
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < stops; i++) {
      for (const step of [-4, -1, 1, 4]) {
        const trial = at.slice()
        trial[i] += step
        if (!valid(trial)) continue
        const t = cleanAirTime(build(trial), params)
        if (t < time - 1e-9) {
          at = trial
          time = t
          improved = true
        }
      }
    }
  }
  const strategy = build(at)
  return { strategy, time, label: strategyLabel(strategy) }
}

/**
 * Every legal dry strategy with up to `maxStops` stops, each with its stops
 * placed where the clean-air race time is lowest, fastest first.
 */
export function rankStrategies(params: RaceParams, { maxStops = 3, keep = 12 } = {}): RankedStrategy[] {
  const ranked: RankedStrategy[] = []
  for (let stops = 1; stops <= maxStops; stops++) {
    if ((stops + 1) * MIN_STINT > params.laps) break
    for (const compounds of compoundSequences(stops + 1)) {
      const best = bestStops(compounds, params)
      if (Number.isFinite(best.time)) ranked.push(best)
    }
  }
  ranked.sort((a, b) => a.time - b.time)
  return ranked.slice(0, keep)
}

/**
 * The best dry compound for running `remaining` laps to the flag from a stop
 * now. `mustDiffer` lists compounds to avoid when one of the others is
 * needed to satisfy the two-compound rule.
 */
export function bestDryCompound(
  remaining: number,
  fuel: number,
  params: RaceParams,
  mustDiffer: readonly Compound[] = [],
): Compound {
  let best: Compound = 'medium'
  let bestCost = Infinity
  for (const c of DRY_COMPOUNDS) {
    if (mustDiffer.includes(c) && mustDiffer.length < DRY_COMPOUNDS.length) continue
    let cost = 0
    let wear = 0
    let f = fuel
    for (let lap = 0; lap < remaining; lap++) {
      cost += COMPOUNDS[c].pace + degradation(c, wear)
      wear += wearPerLap(c, params.tyreStress, 'normal', f / params.fuelStart, 0)
      f -= params.fuelPerLap
    }
    if (cost < bestCost) {
      bestCost = cost
      best = c
    }
  }
  return best
}
