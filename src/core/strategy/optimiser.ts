import { raceParams, compoundSequences, type Strategy } from '../race/strategy'
import { COMPOUNDS, type Compound } from '../race/tyres'
import {
  generateCandidates,
  gridCandidates,
  multiStopStep,
  oneStopStep,
  stopLaps,
  type Candidate,
} from './candidates'
import { simulate, rivalPlans, type Outcomes, type StudySetup } from './monteCarlo'
import { compareStats, summarise, type StrategyStats } from './stats'

/**
 * Staged search for the best strategy.
 *
 *  1. First round: every candidate is raced a modest number of times.
 *  2. Final: the leaders are raced many more times, on races none of them
 *     has seen, so the ranking is not flattered by the luck that got them
 *     through the first round.
 *  3. Pit window: the best two-stop compound sequence is raced at every
 *     pair of stop laps, to draw the map of where its stops work.
 *
 * The races themselves are run by whatever `evaluate` is given: a pool of
 * Web Workers in the app, a plain loop in tests and scripts.
 */

export interface OptimiserOptions {
  /** Races run for each finalist. */
  finalRuns: number
  /** Races run for each candidate in the first round (default: a sixth of finalRuns, 50 to 200). */
  coarseRuns?: number
  /** Strategies taken through to the final (default 12). */
  finalists?: number
}

/**
 * Races each strategy `count` times starting at race number `from`, and
 * reports races completed through `onRaces` as it goes.
 */
export type Evaluate = (
  strategies: Strategy[],
  from: number,
  count: number,
  onRaces: (races: number) => void,
) => Promise<Outcomes[]>

export interface RankedPlan {
  candidate: Candidate
  stats: StrategyStats
}

export interface HeatCell {
  /** strategyKey of the plan in this cell. */
  key: string
  meanPosition: number
  points: number
  /** A stint outlasts its tyres, so the car has to add a stop. */
  overrun: boolean
}

/** A grid of plans: one row per label, one column per lap. Missing cells are plans that cannot be run. */
export interface HeatMap {
  /** Compound sequence the whole map is for, or '' when each row has its own. */
  label: string
  rows: string[]
  /** Stop lap of each column. */
  laps: number[]
  cells: (HeatCell | null)[][]
  /** Races behind each cell. */
  runs: number
}

export interface OptimiserResult {
  setup: StudySetup
  /** The finalists, best first. */
  ranked: RankedPlan[]
  /** One-stop plans: a row per compound pair, a column per stop lap. */
  oneStop: HeatMap
  /** The best two-stop sequence: a row per second stop lap, a column per first stop lap. */
  twoStop: HeatMap | null
  /** Strategies raced in the first round. */
  candidates: number
  /** Races run in all. */
  races: number
  coarseRuns: number
  finalRuns: number
}

export type OptimiserStage = 'first' | 'final' | 'window'

export interface OptimiserProgress {
  stage: OptimiserStage
  /** Races run so far and expected in all. */
  done: number
  total: number
}

export function coarseRunsFor(finalRuns: number): number {
  return Math.min(200, Math.max(50, Math.round(finalRuns / 6)))
}

const label = (compounds: readonly Compound[]) => compounds.map((c) => COMPOUNDS[c].short).join('-')

/**
 * The leaders of the first round, with no more than two plans from any one
 * compound sequence. Plans that cannot be run as written are left out: a
 * stint that outlasts its tyres ends in an unplanned stop, so the plan's
 * result would really belong to a different plan.
 */
function pickFinalists(all: { candidate: Candidate; stats: StrategyStats }[], count: number): Candidate[] {
  const runnable = all.filter((s) => !s.candidate.overrun)
  const scored = runnable.length > 0 ? runnable : all
  const taken = new Map<string, number>()
  const out: Candidate[] = []
  for (const { candidate } of scored) {
    if (out.length >= count) break
    const n = taken.get(candidate.label) ?? 0
    if (n >= 2) continue
    taken.set(candidate.label, n + 1)
    out.push(candidate)
  }
  return out
}

export async function optimise(
  setup: StudySetup,
  options: OptimiserOptions,
  evaluate: Evaluate,
  onProgress: (progress: OptimiserProgress) => void = () => {},
): Promise<OptimiserResult> {
  const params = raceParams(setup.profile, setup.laps)
  const coarseRuns = options.coarseRuns ?? coarseRunsFor(options.finalRuns)
  const finalRuns = options.finalRuns
  const finalistCount = options.finalists ?? 12

  const candidates = generateCandidates(params)
  const twoStopCells = setup.laps >= 9 ? gridCandidates(compoundSequences(3)[0], params).length : 0
  let total =
    candidates.length * coarseRuns + Math.min(finalistCount, candidates.length) * finalRuns + twoStopCells * coarseRuns
  let done = 0
  let stage: OptimiserStage = 'first'
  const report = (races: number) => {
    done += races
    onProgress({ stage, done, total: Math.max(total, done) })
  }
  report(0)

  // --- 1. First round ---
  const stats = new Map<string, StrategyStats>()
  const first = await evaluate(
    candidates.map((c) => c.strategy),
    0,
    coarseRuns,
    report,
  )
  candidates.forEach((c, i) => stats.set(c.key, summarise(first[i], setup.cars)))
  const scored = candidates
    .map((candidate) => ({ candidate, stats: stats.get(candidate.key)! }))
    .sort((a, b) => compareStats(a.stats, b.stats))

  // --- 2. Final, on fresh races ---
  const finalists = pickFinalists(scored, finalistCount)
  const twoStops = scored.filter((s) => s.candidate.strategy.stops.length === 2)
  const bestTwoStop = (twoStops.find((s) => !s.candidate.overrun) ?? twoStops[0])?.candidate ?? null
  const window = bestTwoStop
    ? gridCandidates([bestTwoStop.strategy.start, ...bestTwoStop.strategy.stops.map((s) => s.compound)], params)
    : []
  const windowNew = window.filter((c) => !stats.has(c.key))
  total = done + finalists.length * finalRuns + windowNew.length * coarseRuns
  stage = 'final'
  report(0)
  const final = await evaluate(
    finalists.map((c) => c.strategy),
    coarseRuns,
    finalRuns,
    report,
  )
  const ranked: RankedPlan[] = finalists
    .map((candidate, i) => ({ candidate, stats: summarise(final[i], setup.cars) }))
    .sort((a, b) => compareStats(a.stats, b.stats))

  // --- 3. Pit window of the best two-stop sequence, on the first round's races ---
  stage = 'window'
  report(0)
  if (windowNew.length > 0) {
    const extra = await evaluate(
      windowNew.map((c) => c.strategy),
      0,
      coarseRuns,
      report,
    )
    windowNew.forEach((c, i) => stats.set(c.key, summarise(extra[i], setup.cars)))
  }

  const cell = (candidate: Candidate | undefined): HeatCell | null => {
    const s = candidate ? stats.get(candidate.key) : undefined
    return candidate && s
      ? { key: candidate.key, meanPosition: s.meanPosition, points: s.points, overrun: candidate.overrun }
      : null
  }

  const oneLaps = stopLaps(setup.laps, oneStopStep(setup.laps))
  const pairs = compoundSequences(2)
  const oneStop: HeatMap = {
    label: '',
    rows: pairs.map(label),
    laps: oneLaps,
    cells: pairs.map((pair) =>
      oneLaps.map((lap) =>
        cell(candidates.find((c) => c.label === label(pair) && c.strategy.stops.length === 1 && c.strategy.stops[0].lap === lap)),
      ),
    ),
    runs: coarseRuns,
  }

  let twoStop: HeatMap | null = null
  if (bestTwoStop) {
    const laps = stopLaps(setup.laps, multiStopStep(setup.laps))
    twoStop = {
      label: bestTwoStop.label,
      rows: laps.map(String),
      laps,
      cells: laps.map((second) =>
        laps.map((firstLap) =>
          cell(window.find((c) => c.strategy.stops[0].lap === firstLap && c.strategy.stops[1].lap === second)),
        ),
      ),
      runs: coarseRuns,
    }
  }

  return {
    setup,
    ranked,
    oneStop,
    twoStop,
    candidates: candidates.length,
    races: done,
    coarseRuns,
    finalRuns,
  }
}

/** Runs the races in the calling thread: for tests, scripts and as a fallback without workers. */
export function localEvaluate(setup: StudySetup): Evaluate {
  const plans = rivalPlans(setup)
  return (strategies, from, count, onRaces) =>
    Promise.resolve(
      strategies.map((strategy) => {
        const outcomes = simulate(setup, plans, strategy, from, count)
        onRaces(count)
        return outcomes
      }),
    )
}
