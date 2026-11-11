import {
  cleanAirTime,
  compoundSequences,
  MIN_STINT,
  strategyLabel,
  type RaceParams,
  type Strategy,
} from '../race/strategy'
import { wearPerLap, type Compound } from '../race/tyres'

/**
 * Candidate strategies for the optimiser.
 *
 * One-stop plans are few enough to try them all on a grid of stop laps. Two-
 * and three-stop plans run to thousands, so they are first scored on a clear
 * track with no luck (microseconds each) and only the promising ones go on to
 * be raced.
 */

export interface Candidate {
  strategy: Strategy
  /** Compound sequence, e.g. "M-H". */
  label: string
  /** Identifies the plan exactly: sequence and stop laps, e.g. "M-H@22". */
  key: string
  /** Race time on a clear, dry track with no incidents (s). */
  cleanAir: number
  /**
   * True when a stint is longer than its tyres last. The car cannot run the
   * plan as written: its pit wall will have to add a stop.
   */
  overrun: boolean
}

/** Wear at which a set is finished. A little short of this the pit wall just brings the stop forward. */
export const OVERRUN_WEAR = 1

/** The most worn any set gets by the end of its stint, as a share of its life. */
export function peakWear(strategy: Strategy, params: RaceParams): number {
  let compound = strategy.start
  let wear = 0
  let fuel = params.fuelStart
  let next = 0
  let peak = 0
  for (let lap = 1; lap <= params.laps; lap++) {
    wear += wearPerLap(compound, params.tyreStress, 'normal', fuel / params.fuelStart, 0)
    fuel -= params.fuelPerLap
    peak = Math.max(peak, wear)
    const stop = strategy.stops[next]
    if (stop && stop.lap === lap) {
      compound = stop.compound
      wear = 0
      next++
    }
  }
  return peak
}

export function strategyKey(strategy: Strategy): string {
  return `${strategyLabel(strategy)}@${strategy.stops.map((s) => s.lap).join(',')}`
}

export function makeCandidate(strategy: Strategy, params: RaceParams): Candidate {
  return {
    strategy,
    label: strategyLabel(strategy),
    key: strategyKey(strategy),
    cleanAir: cleanAirTime(strategy, params),
    overrun: peakWear(strategy, params) > OVERRUN_WEAR,
  }
}

/** Laps a stop can be made on, `step` apart, leaving a minimum stint at each end. */
export function stopLaps(laps: number, step: number): number[] {
  const out: number[] = []
  for (let lap = MIN_STINT; lap <= laps - MIN_STINT; lap += step) out.push(lap)
  return out
}

/** Spacing of the stop-lap grid for one-stop plans. */
export function oneStopStep(laps: number): number {
  return Math.max(1, Math.round(laps / 18))
}

/** Spacing of the stop-lap grid for plans with two or three stops. */
export function multiStopStep(laps: number): number {
  return Math.max(2, Math.round(laps / 14))
}

function build(compounds: readonly Compound[], at: readonly number[]): Strategy {
  return { start: compounds[0], stops: at.map((lap, i) => ({ lap, compound: compounds[i + 1] })) }
}

/** Every way of choosing `count` stop laps from `grid`, in order and a minimum stint apart. */
function stopCombinations(grid: readonly number[], count: number): number[][] {
  const out: number[][] = []
  const walk = (start: number, chosen: number[]) => {
    if (chosen.length === count) {
      out.push(chosen.slice())
      return
    }
    for (let i = start; i < grid.length; i++) {
      const prev = chosen.length > 0 ? chosen[chosen.length - 1] : 0
      if (grid[i] - prev < MIN_STINT) continue
      chosen.push(grid[i])
      walk(i + 1, chosen)
      chosen.pop()
    }
  }
  walk(0, [])
  return out
}

/** Every one-stop plan: each legal pair of compounds at each stop lap on the grid. */
export function oneStopCandidates(params: RaceParams, step = oneStopStep(params.laps)): Candidate[] {
  const out: Candidate[] = []
  for (const compounds of compoundSequences(2)) {
    for (const lap of stopLaps(params.laps, step)) out.push(makeCandidate(build(compounds, [lap]), params))
  }
  return out
}

/** Every plan with `stops` stops for one compound sequence, on the multi-stop grid. */
export function gridCandidates(
  compounds: readonly Compound[],
  params: RaceParams,
  step = multiStopStep(params.laps),
): Candidate[] {
  return stopCombinations(stopLaps(params.laps, step), compounds.length - 1).map((at) =>
    makeCandidate(build(compounds, at), params),
  )
}

export interface MultiStopOptions {
  /** Most plans to keep. */
  keep: number
  /** Most plans to keep for any one compound sequence. */
  perSequence: number
  /** Plans slower than the reference by more than this on a clear track are dropped (s). */
  margin: number
  /** Clear-track time to measure the margin from. */
  reference: number
}

/**
 * The most promising plans with `stops` stops: all compound sequences and
 * stop laps on the grid, scored on a clear track, best first.
 */
export function multiStopCandidates(stops: number, params: RaceParams, options: MultiStopOptions): Candidate[] {
  if ((stops + 1) * MIN_STINT > params.laps) return []
  const all: Candidate[] = []
  for (const compounds of compoundSequences(stops + 1)) all.push(...gridCandidates(compounds, params))
  all.sort((a, b) => a.cleanAir - b.cleanAir)
  const taken = new Map<string, number>()
  const out: Candidate[] = []
  for (const c of all) {
    if (out.length >= options.keep || c.cleanAir > options.reference + options.margin) break
    const n = taken.get(c.label) ?? 0
    if (n >= options.perSequence) continue
    taken.set(c.label, n + 1)
    out.push(c)
  }
  return out
}

/**
 * The first-round field: every one-stop plan plus the promising two- and
 * three-stop plans. A safety car can hand back about one stop's worth of
 * time, so anything further behind than that on a clear track is left out.
 */
export function generateCandidates(params: RaceParams): Candidate[] {
  const one = oneStopCandidates(params)
  const reference = one.reduce((best, c) => Math.min(best, c.cleanAir), Infinity)
  const margin = 1.2 * (params.pitLoss + params.stationary) + 6 * params.scale
  const two = multiStopCandidates(2, params, { keep: 30, perSequence: 3, margin, reference })
  const best = two.reduce((b, c) => Math.min(b, c.cleanAir), reference)
  const three = multiStopCandidates(3, params, { keep: 14, perSequence: 2, margin, reference: best })
  return [...one, ...two, ...three]
}
