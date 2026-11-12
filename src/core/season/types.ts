import type { TrackProfile } from '../profile/trackProfile'
import type { Compound } from '../race/tyres'
import type { TrackDef } from '../track/types'

/**
 * A championship season: a calendar of race weekends for the twenty cars of
 * the GridMind grid, with the player running one car of one team.
 *
 * A season is a plain object. Everything that happens in it is drawn from
 * its seed, so the same choices always give the same season.
 */

export const SEASON_VERSION = 1

/** A circuit offered to the calendar, with what the race engine needs to know about it. */
export interface CircuitSpec {
  def: TrackDef
  profile: TrackProfile
}

export interface Round {
  trackId: string
  name: string
  def: TrackDef
  /** The circuit as measured, before the weekend's temperature is applied. */
  profile: TrackProfile
  laps: number
  /** Probability of rain at some point in the race (0..1). */
  rainChance: number
  /** Track temperature (°C). Heat wears tyres faster. */
  temperature: number
  seed: number
}

/** Where the team can spend its development budget. */
export type Area = 'aero' | 'tyres' | 'pit' | 'reliability'

export type Levels = Record<Area, number>

/** How the practice session is divided: blocks of track time given to each programme. */
export interface PracticePlan {
  /** Low-fuel runs: one-lap pace for qualifying. */
  quali: number
  /** Long runs on race fuel: race pace, and a look at how each tyre wears. */
  race: number
  /** Pit-stop drills. */
  pit: number
}

/** One long run from practice: lap times on one set, until the tyres give up. */
export interface LongRun {
  compound: Compound
  /** Lap times (s), from the first flying lap. */
  laps: number[]
  /** The lap of the run on which the tyres reached the cliff, or null if they lasted. */
  cliffLap: number | null
}

/** What a weekend's set-up work is worth to a car. */
export interface SetupGains {
  /** Lap-time fraction found for qualifying (positive is quicker). */
  quali: number
  /** Lap-time fraction found for the race. */
  race: number
  /** Seconds taken off a pit stop. */
  pit: number
}

export interface PracticeResult {
  plan: PracticePlan
  gains: SetupGains
  runs: LongRun[]
}

/** How hard the driver is told to go on a qualifying lap. */
export type Risk = 'safe' | 'push' | 'limit'

export interface QualiTime {
  driver: number
  /** The two runs' lap times (s); Infinity for a run that set no time. */
  runs: [number, number]
  best: number
  /** What went wrong on each run, if anything. */
  notes: [QualiNote, QualiNote]
}

export type QualiNote = 'clean' | 'mistake' | 'crash' | 'none'

export interface QualiSegment {
  /** 1, 2 or 3. */
  number: number
  /** Everyone who took part, quickest first. */
  times: QualiTime[]
  /** Drivers going through to the next part (empty after the last). */
  through: number[]
  /** The player's instructions for the two runs, if the player's car took part. */
  risks: [Risk, Risk] | null
}

export interface Qualifying {
  wet: boolean
  segments: QualiSegment[]
  /** Drivers still in, for the next part. */
  remaining: number[]
  /** Places already settled: the back of the grid, in grid order. */
  settled: number[]
  /** Drivers whose qualifying ended in the barriers: they set no more times. */
  crashed: number[]
  /** The finished grid, driver indices from pole back, once all three parts are run. */
  grid: number[] | null
}

export interface RoundResult {
  /** Driver indices in finishing order; retired cars last. */
  order: number[]
  /** Drivers who did not finish. */
  retired: number[]
  /** Driver with the fastest lap, or -1. */
  fastest: number
  /** The starting grid, driver indices from pole back. */
  grid: number[]
  /** Points scored, by driver index. */
  points: number[]
  /** Prize money paid to the player's team. */
  income: number
  /** True when the race was left to the engineer instead of being run from the pit wall. */
  simulated: boolean
}

export type Stage = 'practice' | 'qualifying' | 'race' | 'results' | 'finished'

export interface Season {
  version: typeof SEASON_VERSION
  seed: number
  /** The player's team (index into TEAMS) and the car the player runs (index into DRIVERS). */
  team: number
  driver: number
  rounds: Round[]
  /** Index of the round in progress. */
  round: number
  stage: Stage
  practice: PracticeResult | null
  qualifying: Qualifying | null
  /** Development budget, in thousands of credits. */
  budget: number
  levels: Levels
  /**
   * Pace each team has found since the first round, by team index, as a
   * lap-time fraction (negative is quicker). The player's own entry stays
   * zero: that team's pace comes from the levels it has bought.
   */
  rivalPace: number[]
  results: RoundResult[]
}
