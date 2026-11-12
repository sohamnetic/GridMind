import { createRng, deriveSeed, nextGaussian } from '../math/rng'
import { carPace } from '../race/engine'
import { raceParams, type RaceParams } from '../race/strategy'
import { CLIFF_WEAR, COMPOUNDS, degradation, wearPerLap, type Compound } from '../race/tyres'
import { currentRound, developmentPace, raceTuning, roundProfile } from './season'
import { setupGains, validPlan } from './setup'
import type { LongRun, PracticePlan, PracticeResult, Season } from './types'

/**
 * Practice: the session before qualifying. The player divides the track
 * time between three programmes; the long runs of the race programme come
 * back as lap times, so the weekend's tyre wear can be seen before the race
 * is planned around it.
 */

/** Compounds the long runs cover, in the order the engineers take them. */
const RUN_ORDER: readonly Compound[] = ['medium', 'hard', 'soft']
/** A long run carries on this many laps past the cliff, to show it. */
const PAST_CLIFF = 3
const LONGEST_RUN = 36

/** The race as the player's car sees it this weekend: its own tyre wear and pit crew. */
export function playerParams(season: Season): RaceParams {
  const round = currentRound(season)
  const base = raceParams(roundProfile(round), round.laps)
  const tuning = raceTuning(season)[season.driver]
  return {
    ...base,
    tyreStress: base.tyreStress * tuning.wear,
    stationary: base.stationary + tuning.stationary,
  }
}

function longRun(season: Season, compound: Compound, params: RaceParams, seed: number): LongRun {
  const rng = createRng(seed)
  const pace = carPace(season.driver) + developmentPace(season, season.team)
  const laps: number[] = []
  let wear = 0
  // Race fuel for the middle of the race: heavy enough to show what a real stint looks like.
  // The car is topped up as the run goes on, so a long-lived tyre can be run to the end of its life.
  let fuel = params.fuelStart * 0.6
  const reserve = params.fuelStart * 0.25
  const longest = Math.min(LONGEST_RUN, params.laps)
  let cliffLap: number | null = null
  let past = 0
  while (laps.length < longest && past < PAST_CLIFF) {
    if (wear >= CLIFF_WEAR) {
      if (cliffLap === null) cliffLap = laps.length + 1
      past++
    }
    laps.push(
      params.baseLap * (1 + pace) +
        params.scale * (COMPOUNDS[compound].pace + degradation(compound, wear)) +
        fuel * params.fuelPenalty +
        nextGaussian(rng, 0, 0.08 * params.scale),
    )
    wear += wearPerLap(compound, params.tyreStress, 'normal', fuel / params.fuelStart, 0)
    fuel = Math.max(reserve, fuel - params.fuelPerLap)
  }
  return { compound, laps, cliffLap }
}

/** Runs the practice session as planned. Deterministic for the round. */
export function runPractice(season: Season, plan: PracticePlan): PracticeResult {
  if (!validPlan(plan)) throw new Error('A practice plan is up to six whole blocks.')
  const round = currentRound(season)
  const params = playerParams(season)
  const runs: LongRun[] = []
  for (let k = 0; k < Math.min(plan.race, RUN_ORDER.length); k++) {
    runs.push(longRun(season, RUN_ORDER[k], params, deriveSeed(round.seed, 100 + k)))
  }
  return { plan: { ...plan }, gains: setupGains(plan), runs }
}

/** Enters a practice session in the season and moves the weekend on to qualifying. */
export function finishPractice(season: Season, plan: PracticePlan): Season {
  if (season.stage !== 'practice') return season
  return {
    ...season,
    practice: runPractice(season, plan),
    stage: 'qualifying',
  }
}
