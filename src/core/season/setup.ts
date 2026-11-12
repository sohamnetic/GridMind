import { createRng, deriveSeed, nextFloat } from '../math/rng'
import type { PracticePlan, SetupGains } from './types'

/**
 * What practice is worth. A session is six blocks of track time, divided
 * between three programmes. Each extra block on a programme adds less than
 * the one before, so the choice is what to be good at this weekend.
 */

export const PRACTICE_BLOCKS = 6

/** Share of a programme's full gain after 0, 1, 2, 3 and 4 or more blocks. */
const GAIN = [0, 0.4, 0.7, 0.9, 1] as const

/** Full gains: lap-time fraction for qualifying and the race, seconds for a pit stop. */
export const QUALI_SETUP = 0.0025
export const RACE_SETUP = 0.0018
export const PIT_DRILL = 0.3

export function programmeGain(blocks: number): number {
  return GAIN[Math.min(GAIN.length - 1, Math.max(0, Math.floor(blocks)))]
}

export function planBlocks(plan: PracticePlan): number {
  return plan.quali + plan.race + plan.pit
}

export function validPlan(plan: PracticePlan): boolean {
  const parts = [plan.quali, plan.race, plan.pit]
  return parts.every((n) => Number.isInteger(n) && n >= 0) && planBlocks(plan) <= PRACTICE_BLOCKS
}

export function setupGains(plan: PracticePlan): SetupGains {
  return {
    quali: QUALI_SETUP * programmeGain(plan.quali),
    race: RACE_SETUP * programmeGain(plan.race),
    pit: PIT_DRILL * programmeGain(plan.pit),
  }
}

export const NO_GAINS: SetupGains = { quali: 0, race: 0, pit: 0 }

/** How a rival team spends its practice at a round: each has its own habits, and they change from weekend to weekend. */
export function rivalPlan(roundSeed: number, team: number): PracticePlan {
  const rng = createRng(deriveSeed(roundSeed, 200 + team))
  const pit = nextFloat(rng) < 0.5 ? 1 : 0
  const quali = 1 + Math.floor(nextFloat(rng) * 4)
  return { quali, race: PRACTICE_BLOCKS - pit - quali, pit }
}
