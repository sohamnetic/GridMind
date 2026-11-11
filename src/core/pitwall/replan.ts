import { RULE_PENALTY } from '../race/engine'
import type { PitStop, RaceParams } from '../race/strategy'
import { ALL_COMPOUNDS, COMPOUNDS, degradation, DRY_COMPOUNDS, wearPerLap, type Compound } from '../race/tyres'

/**
 * Planning the rest of a race from where a car is now: the stops, on a clear
 * dry track, that get it to the flag soonest from its present tyres and fuel.
 * The pit wall uses it for the pit-window indicator, and the strategy engine
 * as the plan it follows after each call it is asked to judge.
 */

/** The part of a car's state that planning depends on. */
export interface TyreState {
  compound: Compound
  wear: number
  fuel: number
  used: readonly Compound[]
}

export interface Plan {
  /** Stops still to make, in order. Empty when the car should run to the flag. */
  stops: PitStop[]
  /** Clear-track time to the flag with these stops, less the laps' base time (s). */
  time: number
  /** Laps on which the first stop costs next to nothing extra, or null with no stop to make. */
  window: { from: number; to: number } | null
}

const BIT: Record<Compound, number> = { soft: 1, medium: 2, hard: 4, inter: 8, wet: 16 }
const RAIN_BITS = BIT.inter | BIT.wet
/** Laps a fresh set must run before the next stop or the flag. */
const MIN_RUN = 2

function usedBits(used: readonly Compound[]): number {
  let bits = 0
  for (const c of used) bits |= BIT[c]
  return bits
}

/**
 * Time from the end of lap `lapsDone` to the flag on a clear, dry track,
 * leaving out each lap's base time (the same for every plan). Up to two
 * stops, passed as plain numbers so the search allocates nothing.
 */
function timeToFlag(
  car: TyreState,
  bits: number,
  lapsDone: number,
  params: RaceParams,
  lap1: number,
  tyre1: Compound | null,
  lap2: number,
  tyre2: Compound | null,
): number {
  let compound = car.compound
  let wear = car.wear
  let fuel = car.fuel
  let total = 0
  for (let lap = lapsDone + 1; lap <= params.laps; lap++) {
    total += params.scale * (COMPOUNDS[compound].pace + degradation(compound, wear)) + fuel * params.fuelPenalty
    wear += wearPerLap(compound, params.tyreStress, 'normal', fuel / params.fuelStart, 0)
    fuel = Math.max(0, fuel - params.fuelPerLap)
    const fit = lap === lap1 ? tyre1 : lap === lap2 ? tyre2 : null
    if (fit) {
      total += params.pitLoss + params.stationary
      compound = fit
      wear = 0
      bits |= BIT[fit]
    }
  }
  // Two dry compounds are compulsory unless rain tyres were used.
  const dry = (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1)
  if ((bits & RAIN_BITS) === 0 && dry < 2) total += RULE_PENALTY
  return total
}

/**
 * The best stops from here to the flag.
 *
 * @param lapsDone laps the car has completed
 * @param earliest first lap a stop may be made at the end of (default: the next lap)
 */
export function planFrom(car: TyreState, lapsDone: number, params: RaceParams, earliest = lapsDone + 1): Plan {
  // On rain tyres the weather decides, not a plan.
  if (!COMPOUNDS[car.compound].dry) return { stops: [], time: 0, window: null }
  const bits = usedBits(car.used)
  const last = params.laps - MIN_RUN
  const cost = (l1: number, t1: Compound | null, l2: number, t2: Compound | null) =>
    timeToFlag(car, bits, lapsDone, params, l1, t1, l2, t2)

  let best = cost(0, null, 0, null)
  let stops: PitStop[] = []

  for (let lap = earliest; lap <= last; lap++) {
    for (const c of DRY_COMPOUNDS) {
      const t = cost(lap, c, 0, null)
      if (t < best - 1e-9) {
        best = t
        stops = [{ lap, compound: c }]
      }
    }
  }

  const step = Math.max(1, Math.round((params.laps - lapsDone) / 12))
  let two: { l1: number; t1: Compound; l2: number; t2: Compound } | null = null
  let twoBest = best
  for (let l1 = earliest; l1 <= last - MIN_RUN; l1 += step) {
    for (let l2 = l1 + MIN_RUN; l2 <= last; l2 += step) {
      for (const t1 of DRY_COMPOUNDS) {
        for (const t2 of DRY_COMPOUNDS) {
          const t = cost(l1, t1, l2, t2)
          if (t < twoBest - 1e-9) {
            twoBest = t
            two = { l1, t1, l2, t2 }
          }
        }
      }
    }
  }
  if (two) {
    // The coarse grid found the neighbourhood; walk each stop a lap at a time from there.
    let improved = true
    while (improved) {
      improved = false
      for (const [d1, d2] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const l1: number = two.l1 + d1
        const l2: number = two.l2 + d2
        if (l1 < earliest || l2 - l1 < MIN_RUN || l2 > last) continue
        const t = cost(l1, two.t1, l2, two.t2)
        if (t < twoBest - 1e-9) {
          twoBest = t
          two = { ...two, l1, l2 }
          improved = true
        }
      }
    }
    best = twoBest
    stops = [
      { lap: two.l1, compound: two.t1 },
      { lap: two.l2, compound: two.t2 },
    ]
  }

  if (stops.length === 0) return { stops, time: best, window: null }

  // The window: how far the first stop can move, the rest held, for under a second a lap's worth of loss.
  const first = stops[0]
  const second = stops[1] ?? null
  const tolerance = params.scale
  const at = (lap: number) => cost(lap, first.compound, second?.lap ?? 0, second?.compound ?? null)
  const latest = second ? second.lap - MIN_RUN : last
  let from = first.lap
  while (from - 1 >= earliest && at(from - 1) <= best + tolerance) from--
  let to = first.lap
  while (to + 1 <= latest && at(to + 1) <= best + tolerance) to++
  return { stops, time: best, window: { from, to } }
}

/** Every compound, for interfaces that offer them all. */
export const PIT_COMPOUNDS: readonly Compound[] = ALL_COMPOUNDS
