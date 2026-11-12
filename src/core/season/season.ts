import { createRng, deriveSeed, nextFloat } from '../math/rng'
import { sessionSetup } from '../pitwall/session'
import type { TrackProfile } from '../profile/trackProfile'
import { carPace, runRace, type CarTuning, type RaceSetup, type RaceState } from '../race/engine'
import { DRIVERS, TEAMS } from '../race/grid'
import type { Strategy } from '../race/strategy'
import { NO_GAINS, rivalPlan, setupGains } from './setup'
import {
  SEASON_VERSION,
  type Area,
  type CircuitSpec,
  type Levels,
  type Round,
  type RoundResult,
  type Season,
  type SetupGains,
} from './types'

// ---------- Rules ----------

/** Points for the first ten finishers. */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const
/** Extra point for the fastest lap, if its driver finishes in the points. */
export const FASTEST_LAP_POINT = 1

export const MAX_LEVEL = 5

export interface AreaInfo {
  id: Area
  label: string
  /** What one level does, in a sentence. */
  effect: string
}

/** Lap-time fraction one aerodynamics level is worth. */
export const AERO_STEP = 0.0012
const TYRE_STEP = 0.025
const PIT_STEP = 0.12
const SLOW_STOP_STEP = 0.15
const RISK_STEP = 0.12

export const AREAS: readonly AreaInfo[] = [
  {
    id: 'aero',
    label: 'Aerodynamics',
    effect: 'Both cars 0.12 % quicker every lap, in qualifying and the race.',
  },
  {
    id: 'tyres',
    label: 'Tyre care',
    effect: 'Tyres wear 2.5 % slower, so stints can run longer.',
  },
  {
    id: 'pit',
    label: 'Pit crew',
    effect: 'Stops 0.12 s quicker, and slow stops less often.',
  },
  {
    id: 'reliability',
    label: 'Reliability',
    effect: 'Retirements 12 % less likely.',
  },
]

const START_BUDGET = 500
/** Prize money for a round over a ten-round season: this much for turning up, and more for each point scored. */
const BASE_INCOME = 350
const POINT_INCOME = 8
/** Development aid: this much more for each place the team stands below the top of the teams' table. */
const AID_INCOME = 40
/** Pace a rival team finds per round of a ten-round season, on average (lap-time fraction). */
const RIVAL_RATE = 0.0002

/** Cost of the next level in an area that stands at `level`, in thousands of credits. */
export function upgradeCost(level: number): number {
  return 250 + 125 * level
}

// ---------- Calendar ----------

export type Distance = 'sprint' | 'full'

/** Race distance in laps: about 90 km for a sprint season, about 150 km for a full one. */
export function lapsFor(lapLength: number, distance: Distance): number {
  const metres = distance === 'full' ? 150_000 : 90_000
  const laps = Math.round(metres / Math.max(lapLength, 1))
  return distance === 'full' ? Math.min(70, Math.max(20, laps)) : Math.min(45, Math.max(15, laps))
}

/** Tyre wear against a 30 °C track: more in the heat, less in the cold. */
export function heatFactor(temperature: number): number {
  return 1 + (temperature - 30) * 0.012
}

/** The circuit as it is on the weekend: the measured profile, with the day's temperature in the tyres. */
export function roundProfile(round: Round): TrackProfile {
  return {
    ...round.profile,
    tyreStress: round.profile.tyreStress * heatFactor(round.temperature),
  }
}

/**
 * The season's rounds: the circuits in the order given, round and round
 * until the calendar is full, each weekend with its own weather.
 */
export function buildCalendar(
  circuits: readonly CircuitSpec[],
  seed: number,
  rounds: number,
  distance: Distance,
): Round[] {
  if (circuits.length === 0) return []
  const out: Round[] = []
  for (let r = 0; r < rounds; r++) {
    const { def, profile } = circuits[r % circuits.length]
    const rng = createRng(deriveSeed(seed, 1000 + r))
    out.push({
      trackId: def.id,
      name: def.name,
      def,
      profile,
      laps: lapsFor(profile.length, distance),
      rainChance: Math.round(nextFloat(rng) * 12) * 0.05,
      temperature: 18 + Math.round(nextFloat(rng) * 26),
      seed: deriveSeed(seed, 2000 + r),
    })
  }
  return out
}

export interface SeasonOptions {
  seed: number
  team: number
  /** Which of the team's two cars the player runs: 0 or 1. */
  seat: number
  circuits: readonly CircuitSpec[]
  rounds: number
  distance: Distance
}

export function createSeason(options: SeasonOptions): Season {
  const team = Math.min(TEAMS.length - 1, Math.max(0, Math.floor(options.team)))
  return {
    version: SEASON_VERSION,
    seed: options.seed,
    team,
    driver: team * 2 + (options.seat === 1 ? 1 : 0),
    rounds: buildCalendar(options.circuits, options.seed, options.rounds, options.distance),
    round: 0,
    stage: 'practice',
    practice: null,
    qualifying: null,
    budget: START_BUDGET,
    levels: { aero: 0, tyres: 0, pit: 0, reliability: 0 },
    rivalPace: TEAMS.map(() => 0),
    results: [],
  }
}

export function currentRound(season: Season): Round {
  return season.rounds[Math.min(season.round, season.rounds.length - 1)]
}

/** The player's team-mate. */
export function teamMate(season: Season): number {
  return season.driver % 2 === 0 ? season.driver + 1 : season.driver - 1
}

// ---------- The cars ----------

/** Pace a team has found through development (lap-time fraction, negative is quicker). */
export function developmentPace(season: Season, team: number): number {
  return team === season.team ? -AERO_STEP * season.levels.aero : (season.rivalPace[team] ?? 0)
}

/** A team's clean-air pace as it stands now, as a lap-time fraction above the standard quickest car. */
export function teamPace(season: Season, team: number): number {
  return (carPace(team * 2) + carPace(team * 2 + 1)) / 2 + developmentPace(season, team)
}

/** Teams from quickest to slowest, on development alone. */
export function paceOrder(season: Season): number[] {
  return TEAMS.map((_, t) => t).sort((a, b) => teamPace(season, a) - teamPace(season, b) || a - b)
}

/** What each team got out of practice at the round in progress. */
export function weekendGains(season: Season, team: number): SetupGains {
  if (team === season.team) return season.practice?.gains ?? NO_GAINS
  return setupGains(rivalPlan(currentRound(season).seed, team))
}

/** Each car's qualifying pace: the standard car, development and the weekend's one-lap set-up. */
export function qualifyingPaces(season: Season): number[] {
  return DRIVERS.map((d, i) => carPace(i) + developmentPace(season, d.team) - weekendGains(season, d.team).quali)
}

/** How each car differs from the standard one in this round's race. */
export function raceTuning(season: Season): CarTuning[] {
  const { levels } = season
  return DRIVERS.map((d) => {
    const gains = weekendGains(season, d.team)
    const pace = developmentPace(season, d.team) - gains.race
    if (d.team !== season.team) {
      return {
        pace,
        wear: 1,
        stationary: -gains.pit,
        slowStop: 1 - gains.pit,
        risk: 1,
      }
    }
    return {
      pace,
      wear: 1 - TYRE_STEP * levels.tyres,
      stationary: -PIT_STEP * levels.pit - gains.pit,
      slowStop: (1 - SLOW_STOP_STEP * levels.pit) * (1 - gains.pit),
      risk: 1 - RISK_STEP * levels.reliability,
    }
  })
}

// ---------- The race ----------

/** This round's race, with the player's car taking its orders from the pit wall. */
export function raceSetup(season: Season, strategy: Strategy): RaceSetup {
  const round = currentRound(season)
  return sessionSetup({
    profile: roundProfile(round),
    laps: round.laps,
    seed: round.seed,
    rainChance: round.rainChance,
    driver: season.driver,
    strategy,
    grid: season.qualifying?.grid ?? undefined,
    tuning: raceTuning(season),
  })
}

/** The same race left to the engineer: the car starts on the plan and its own pit wall makes the calls. */
export function simulateRace(season: Season, strategy: Strategy): RaceState {
  return runRace({ ...raceSetup(season, strategy), manual: [] })
}

/** Points for a finished race, by driver index. */
export function racePoints(race: RaceState): number[] {
  const points = race.cars.map(() => 0)
  race.order.forEach((driver, place) => {
    if (place < POINTS.length && race.cars[driver].running) points[driver] = POINTS[place]
  })
  const fastest = race.fastestCar
  if (fastest >= 0 && race.cars[fastest].running && race.cars[fastest].position <= POINTS.length) {
    points[fastest] += FASTEST_LAP_POINT
  }
  return points
}

/**
 * Prize money for a round, scaled so a short season pays as much as a long one.
 *
 * @param points scored by the team's two cars in the round
 * @param rank the team's place in the teams' table going into the round (1 = leading)
 */
export function roundIncome(points: number, rank: number, rounds: number): number {
  const aid = AID_INCOME * Math.max(0, rank - 1)
  return Math.round(((BASE_INCOME + POINT_INCOME * points + aid) * 10) / Math.max(1, rounds))
}

/**
 * Enters a finished race in the season: points, prize money, and the pace
 * the other teams find before the next round.
 */
export function recordRace(season: Season, race: RaceState, simulated: boolean): Season {
  if (season.stage !== 'race' || !race.finished) return season
  const points = racePoints(race)
  const teamPoints = points.reduce((sum, p, driver) => (DRIVERS[driver].team === season.team ? sum + p : sum), 0)
  // Before the first race the table is the entry list, quickest team first.
  const rank = season.results.length === 0 ? season.team + 1 : teamRank(standings(season), season.team)
  const income = roundIncome(teamPoints, rank, season.rounds.length)
  const grid = race.cars.map((car) => car.driver).sort((a, b) => race.cars[a].grid - race.cars[b].grid)
  const result: RoundResult = {
    order: race.order.slice(),
    retired: race.cars.filter((car) => !car.running).map((car) => car.driver),
    fastest: race.fastestCar,
    grid,
    points,
    income,
    simulated,
  }

  const rng = createRng(deriveSeed(season.seed, 5000 + season.round))
  const rate = (RIVAL_RATE * 10) / Math.max(1, season.rounds.length)
  const rivalPace = season.rivalPace.map((pace, team) => {
    const found = rate * (0.4 + 1.2 * nextFloat(rng))
    return team === season.team ? pace : pace - found
  })

  return {
    ...season,
    stage: 'results',
    budget: season.budget + income,
    rivalPace,
    results: [...season.results, result],
  }
}

/** Moves on from a round's results to the next weekend, or ends the season after the last. */
export function nextRound(season: Season): Season {
  if (season.stage !== 'results') return season
  if (season.round + 1 >= season.rounds.length) return { ...season, stage: 'finished' }
  return {
    ...season,
    round: season.round + 1,
    stage: 'practice',
    practice: null,
    qualifying: null,
  }
}

// ---------- Development ----------

export function canBuy(season: Season, area: Area): boolean {
  const level = season.levels[area]
  return season.stage !== 'finished' && level < MAX_LEVEL && season.budget >= upgradeCost(level)
}

export function buyUpgrade(season: Season, area: Area): Season {
  if (!canBuy(season, area)) return season
  const level = season.levels[area]
  const levels: Levels = { ...season.levels, [area]: level + 1 }
  return { ...season, budget: season.budget - upgradeCost(level), levels }
}

// ---------- Standings ----------

export interface DriverStanding {
  driver: number
  points: number
  wins: number
  podiums: number
  /** Best finishing position, or 0 with no finish yet. */
  best: number
}

export interface TeamStanding {
  team: number
  points: number
  wins: number
}

export interface Standings {
  drivers: DriverStanding[]
  teams: TeamStanding[]
}

export function standings(season: Season): Standings {
  const drivers: DriverStanding[] = DRIVERS.map((_, driver) => ({
    driver,
    points: 0,
    wins: 0,
    podiums: 0,
    best: 0,
  }))
  for (const result of season.results) {
    result.order.forEach((driver, place) => {
      const row = drivers[driver]
      row.points += result.points[driver] ?? 0
      if (result.retired.includes(driver)) return
      const position = place + 1
      if (position === 1) row.wins++
      if (position <= 3) row.podiums++
      if (row.best === 0 || position < row.best) row.best = position
    })
  }
  const teams: TeamStanding[] = TEAMS.map((_, team) => ({
    team,
    points: 0,
    wins: 0,
  }))
  for (const row of drivers) {
    const team = teams[DRIVERS[row.driver].team]
    team.points += row.points
    team.wins += row.wins
  }
  // Level on points: more wins, then the better best finish, then the order of the entry list.
  drivers.sort(
    (a, b) => b.points - a.points || b.wins - a.wins || (a.best || 99) - (b.best || 99) || a.driver - b.driver,
  )
  teams.sort((a, b) => b.points - a.points || b.wins - a.wins || a.team - b.team)
  return { drivers, teams }
}

/** Championship position of a driver, 1 = leading. */
export function driverRank(table: Standings, driver: number): number {
  return table.drivers.findIndex((row) => row.driver === driver) + 1
}

export function teamRank(table: Standings, team: number): number {
  return table.teams.findIndex((row) => row.team === team) + 1
}
