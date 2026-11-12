import { describe, expect, it } from 'vitest'
import { sessionSetup } from '../src/core/pitwall/session'
import { carPace, carParams, createRace, runRace, STANDARD_TUNING, type RaceSetup } from '../src/core/race/engine'
import { DRIVERS, TEAMS } from '../src/core/race/grid'
import { raceParams, rankStrategies } from '../src/core/race/strategy'
import { circuitSpec } from '../src/core/season/circuits'
import { finishPractice, playerParams, runPractice } from '../src/core/season/practice'
import {
  completeQualifying,
  finishQualifying,
  gridPosition,
  playerRunning,
  qualify,
  runSegment,
  startQualifying,
} from '../src/core/season/qualifying'
import {
  AERO_STEP,
  AREAS,
  buildCalendar,
  buyUpgrade,
  canBuy,
  createSeason,
  currentRound,
  heatFactor,
  lapsFor,
  MAX_LEVEL,
  nextRound,
  paceOrder,
  POINTS,
  racePoints,
  raceSetup,
  raceTuning,
  recordRace,
  roundIncome,
  roundProfile,
  simulateRace,
  standings,
  teamMate,
  upgradeCost,
} from '../src/core/season/season'
import { PRACTICE_BLOCKS, programmeGain, rivalPlan, setupGains, validPlan } from '../src/core/season/setup'
import type { CircuitSpec, Season } from '../src/core/season/types'
import { createPresets } from '../src/core/track/presets'
import { seasonTip, type SeasonCoachState } from '../src/ui/app/coachTips'
import { parseRoute } from '../src/ui/app/useHashRoute'

const circuits: CircuitSpec[] = createPresets().flatMap((def) => {
  const spec = circuitSpec(def, null)
  return spec ? [spec] : []
})

function newSeason(overrides: Partial<Parameters<typeof createSeason>[0]> = {}): Season {
  return createSeason({
    seed: 7,
    team: 4,
    seat: 0,
    circuits,
    rounds: 5,
    distance: 'sprint',
    ...overrides,
  })
}

/** A season taken as far as race day of its first round. */
function toRaceDay(season: Season): Season {
  return finishQualifying(finishPractice(season, { quali: 2, race: 3, pit: 1 }))
}

function topPlan(season: Season) {
  return rankStrategies(playerParams(season))[0].strategy
}

describe('race engine: grids and tuned cars', () => {
  const profile = circuits[4].profile
  const base: RaceSetup = sessionSetup({
    profile,
    laps: 30,
    seed: 11,
    rainChance: 0.3,
    driver: 8,
    strategy: rankStrategies(raceParams(profile, 30))[0].strategy,
  })

  it('starts the cars in the order it is given', () => {
    const grid = Array.from({ length: 20 }, (_, i) => 19 - i)
    const race = createRace({ ...base, grid })
    expect(race.order).toEqual(grid)
    expect(race.cars[19].grid).toBe(1)
    expect(race.cars[0].grid).toBe(20)
  })

  it('keeps the weather and the incidents of the seed whatever the grid', () => {
    const plain = createRace(base)
    const given = createRace({
      ...base,
      grid: Array.from({ length: 20 }, (_, i) => 19 - i),
    })
    expect(given.weather.plan).toEqual(plain.weather.plan)
    expect(given.incidentSeed).toBe(plain.incidentSeed)
    expect(given.rng.state).toBe(plain.rng.state)
  })

  it('ignores a grid that is not every driver once', () => {
    const plain = createRace(base)
    expect(createRace({ ...base, grid: [0, 1, 2] }).order).toEqual(plain.order)
    expect(createRace({ ...base, grid: Array.from({ length: 20 }, () => 3) }).order).toEqual(plain.order)
  })

  it('runs the same race with a standard field as with none', () => {
    const plain = runRace({ ...base, manual: [] })
    const standard = runRace({
      ...base,
      manual: [],
      tuning: DRIVERS.map(() => ({ ...STANDARD_TUNING })),
    })
    expect(standard.order).toEqual(plain.order)
    expect(standard.cars.map((c) => c.time)).toEqual(plain.cars.map((c) => c.time))
  })

  it('applies pace, tyre wear and reliability car by car', () => {
    const tuning = DRIVERS.map(() => ({ ...STANDARD_TUNING }))
    tuning[8] = {
      pace: -0.004,
      wear: 0.5,
      stationary: -0.5,
      slowStop: 0,
      risk: 0,
    }
    const setup = { ...base, tuning }
    const race = createRace(setup)
    expect(race.cars[8].pace).toBeCloseTo(carPace(8) - 0.004, 10)
    expect(race.cars[9].pace).toBeCloseTo(carPace(9), 10)
    const own = carParams(setup, 8)
    const standard = carParams(setup, 9)
    expect(own.tyreStress).toBeCloseTo(standard.tyreStress * 0.5, 10)
    expect(own.stationary).toBeCloseTo(standard.stationary - 0.5, 10)

    // A car that cannot break down never retires, however many races are run.
    let quicker = 0
    for (let seed = 1; seed <= 30; seed++) {
      const tuned = runRace({ ...setup, seed, manual: [] })
      const plain = runRace({ ...base, seed, manual: [] })
      expect(tuned.cars[8].running).toBe(true)
      if (plain.cars[8].running && tuned.cars[8].position <= plain.cars[8].position) quicker++
    }
    expect(quicker).toBeGreaterThan(20)
  })
})

describe('season calendar', () => {
  it('goes round the circuits until the calendar is full', () => {
    const rounds = buildCalendar(circuits, 3, 12, 'sprint')
    expect(rounds).toHaveLength(12)
    expect(rounds[5].trackId).toBe(rounds[0].trackId)
    expect(rounds[6].trackId).toBe(rounds[1].trackId)
    expect(new Set(rounds.map((r) => r.seed)).size).toBe(12)
    for (const round of rounds) {
      expect(round.laps).toBeGreaterThanOrEqual(15)
      expect(round.laps).toBeLessThanOrEqual(45)
      expect(round.rainChance).toBeGreaterThanOrEqual(0)
      expect(round.rainChance).toBeLessThanOrEqual(0.6)
      expect(round.temperature).toBeGreaterThanOrEqual(18)
      expect(round.temperature).toBeLessThanOrEqual(44)
    }
  })

  it('is the same for the same seed and different for another', () => {
    expect(buildCalendar(circuits, 3, 5, 'full')).toEqual(buildCalendar(circuits, 3, 5, 'full'))
    const a = buildCalendar(circuits, 3, 10, 'full').map((r) => r.temperature)
    const b = buildCalendar(circuits, 4, 10, 'full').map((r) => r.temperature)
    expect(a).not.toEqual(b)
  })

  it('makes full races longer than sprints, within limits', () => {
    expect(lapsFor(5000, 'full')).toBe(30)
    expect(lapsFor(5000, 'sprint')).toBe(18)
    expect(lapsFor(900, 'full')).toBe(70)
    expect(lapsFor(900, 'sprint')).toBe(45)
    expect(lapsFor(12000, 'sprint')).toBe(15)
  })

  it('wears tyres faster on a hot track', () => {
    expect(heatFactor(30)).toBe(1)
    expect(heatFactor(44)).toBeGreaterThan(1.1)
    expect(heatFactor(18)).toBeLessThan(0.9)
    const season = newSeason()
    const round = currentRound(season)
    expect(roundProfile(round).tyreStress).toBeCloseTo(round.profile.tyreStress * heatFactor(round.temperature), 10)
    expect(roundProfile(round).baseLapTime).toBe(round.profile.baseLapTime)
  })

  it('puts the player in the chosen car of the chosen team', () => {
    const season = newSeason({ team: 6, seat: 1 })
    expect(season.driver).toBe(13)
    expect(DRIVERS[season.driver].team).toBe(6)
    expect(teamMate(season)).toBe(12)
    expect(teamMate(newSeason({ team: 6, seat: 0 }))).toBe(13)
    expect(season.stage).toBe('practice')
    expect(season.rivalPace).toHaveLength(TEAMS.length)
  })
})

describe('practice', () => {
  it('accepts up to six whole blocks', () => {
    expect(validPlan({ quali: 2, race: 3, pit: 1 })).toBe(true)
    expect(validPlan({ quali: 0, race: 0, pit: 0 })).toBe(true)
    expect(validPlan({ quali: 4, race: 3, pit: 0 })).toBe(false)
    expect(validPlan({ quali: -1, race: 3, pit: 0 })).toBe(false)
    expect(validPlan({ quali: 1.5, race: 3, pit: 0 })).toBe(false)
    expect(() => runPractice(newSeason(), { quali: 6, race: 1, pit: 0 })).toThrow()
  })

  it('finds less with every extra block on a programme', () => {
    const steps = [1, 2, 3, 4].map((n) => programmeGain(n) - programmeGain(n - 1))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1])
    expect(programmeGain(0)).toBe(0)
    expect(programmeGain(4)).toBe(1)
    expect(programmeGain(PRACTICE_BLOCKS)).toBe(1)
    const all = setupGains({ quali: 6, race: 0, pit: 0 })
    const split = setupGains({ quali: 3, race: 3, pit: 0 })
    expect(all.quali).toBeGreaterThan(split.quali)
    expect(all.race).toBe(0)
    expect(split.race).toBeGreaterThan(0)
  })

  it('gives every rival a plan that fits the session', () => {
    for (let team = 0; team < TEAMS.length; team++) {
      const plan = rivalPlan(99, team)
      expect(validPlan(plan)).toBe(true)
      expect(plan.quali + plan.race + plan.pit).toBe(PRACTICE_BLOCKS)
      expect(rivalPlan(99, team)).toEqual(plan)
    }
  })

  it('does one long run for each race block, mediums first', () => {
    const season = newSeason()
    expect(runPractice(season, { quali: 6, race: 0, pit: 0 }).runs).toHaveLength(0)
    const result = runPractice(season, { quali: 1, race: 3, pit: 1 })
    expect(result.runs.map((r) => r.compound)).toEqual(['medium', 'hard', 'soft'])
    expect(runPractice(season, { quali: 0, race: 5, pit: 1 }).runs).toHaveLength(3)
    expect(runPractice(season, { quali: 1, race: 3, pit: 1 })).toEqual(result)
    for (const run of result.runs) {
      expect(run.laps.length).toBeGreaterThan(5)
      for (const lap of run.laps) expect(lap).toBeGreaterThan(0)
    }
    // Softs give up before hards do.
    const soft = result.runs[2]
    const hard = result.runs[1]
    expect(soft.cliffLap).not.toBeNull()
    expect(soft.cliffLap ?? 99).toBeLessThan(hard.cliffLap ?? 99)
  })

  it('moves the weekend on to qualifying, once', () => {
    const season = finishPractice(newSeason(), { quali: 2, race: 3, pit: 1 })
    expect(season.stage).toBe('qualifying')
    expect(season.practice?.gains.quali).toBeGreaterThan(0)
    expect(finishPractice(season, { quali: 6, race: 0, pit: 0 })).toBe(season)
  })
})

describe('qualifying', () => {
  const season = finishPractice(newSeason(), { quali: 2, race: 3, pit: 1 })

  it('knocks out five cars in each of the first two parts', () => {
    let quali = startQualifying(season)
    expect(quali.remaining).toHaveLength(20)
    quali = runSegment(season, quali)
    expect(quali.remaining).toHaveLength(15)
    expect(quali.settled).toHaveLength(5)
    expect(quali.grid).toBeNull()
    quali = runSegment(season, quali)
    expect(quali.remaining).toHaveLength(10)
    expect(quali.settled).toHaveLength(10)
    quali = runSegment(season, quali)
    expect(quali.segments).toHaveLength(3)
    expect(quali.grid).not.toBeNull()
    expect([...(quali.grid ?? [])].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    // Those knocked out first are at the very back.
    expect(quali.grid?.slice(15)).toEqual(quali.segments[0].times.slice(15).map((t) => t.driver))
    expect(quali.grid?.slice(0, 10)).toEqual(quali.segments[2].times.map((t) => t.driver))
    expect(runSegment(season, quali)).toBe(quali)
  })

  it('gives the same session for the same choices', () => {
    const a = completeQualifying(season, startQualifying(season))
    const b = completeQualifying(season, startQualifying(season))
    expect(a).toEqual(b)
  })

  it("leaves the other cars' laps alone whatever the player risks", () => {
    const start = startQualifying(season)
    const safe = runSegment(season, start, ['safe', 'safe'])
    const limit = runSegment(season, start, ['limit', 'limit'])
    const others = (q: typeof safe) =>
      q.segments[0].times.filter((t) => t.driver !== season.driver).sort((x, y) => x.driver - y.driver)
    expect(others(limit)).toEqual(others(safe))
    expect(safe.segments[0].risks).toEqual(['safe', 'safe'])
  })

  it('is quicker on the limit when the lap comes off, and slower on a banker', () => {
    const start = startQualifying(season)
    const best = (risk: 'safe' | 'push' | 'limit') => {
      const mine = runSegment(season, start, [risk, risk]).segments[0].times.find((t) => t.driver === season.driver)
      return mine && mine.notes[0] === 'clean' ? mine.runs[0] : null
    }
    const safe = best('safe')
    const push = best('push')
    expect(safe).not.toBeNull()
    if (safe !== null && push !== null) expect(push).toBeLessThan(safe)
    const limit = best('limit')
    if (limit !== null && push !== null) expect(limit).toBeLessThan(push)
  })

  it('ends the session for a car in the barriers', () => {
    // Somewhere in a hundred sessions on the limit, the player's car crashes.
    let seen = false
    for (let seed = 1; seed <= 100 && !seen; seed++) {
      const s = finishPractice(newSeason({ seed, team: 0 }), {
        quali: 4,
        race: 2,
        pit: 0,
      })
      let quali = startQualifying(s)
      while (quali.grid === null) {
        quali = runSegment(s, quali, ['limit', 'limit'])
        if (quali.crashed.includes(s.driver) && quali.grid === null) {
          seen = true
          expect(playerRunning(s, quali)).toBe(false)
          if (quali.remaining.includes(s.driver)) {
            const next = runSegment(s, quali, ['limit', 'limit'])
            const mine = next.segments[next.segments.length - 1].times.find((t) => t.driver === s.driver)
            expect(mine?.best).toBe(Infinity)
            expect(mine?.notes).toEqual(['none', 'none'])
          }
          break
        }
      }
    }
    expect(seen).toBe(true)
  })

  it('puts quick cars ahead of slow ones, most of the time', () => {
    let frontRow = 0
    let backRow = 0
    for (let seed = 1; seed <= 20; seed++) {
      const s = finishPractice(newSeason({ seed }), {
        quali: 2,
        race: 3,
        pit: 1,
      })
      const quali = completeQualifying(s, startQualifying(s))
      frontRow += gridPosition(quali, 0) + gridPosition(quali, 1)
      backRow += gridPosition(quali, 18) + gridPosition(quali, 19)
    }
    expect(frontRow / 40).toBeLessThan(5)
    expect(backRow / 40).toBeGreaterThan(15)
  })

  it('walks the season through its three parts', () => {
    let s = qualify(season, ['safe', 'push'])
    expect(s.stage).toBe('qualifying')
    expect(s.qualifying?.segments).toHaveLength(1)
    const settled = s.qualifying ? gridPosition(s.qualifying, s.qualifying.settled[0]) : 0
    expect(settled).toBe(16)
    s = qualify(qualify(s, ['push', 'push']), ['push', 'limit'])
    expect(s.stage).toBe('race')
    expect(s.qualifying?.grid).toHaveLength(20)
    expect(qualify(s)).toBe(s)
  })
})

describe('race day', () => {
  it('starts the race from the qualifying grid, with the cars as developed', () => {
    const season = toRaceDay(buyUpgrade(newSeason(), 'aero'))
    const setup = raceSetup(season, topPlan(season))
    expect(setup.grid).toEqual(season.qualifying?.grid)
    expect(setup.laps).toBe(currentRound(season).laps)
    expect(setup.manual).toEqual([season.driver])
    const race = createRace(setup)
    expect(race.cars[season.driver].grid).toBe(gridPosition(season.qualifying!, season.driver))
    const tuning = raceTuning(season)
    const gains = season.practice!.gains
    expect(tuning[season.driver].pace).toBeCloseTo(-AERO_STEP - gains.race, 10)
    // The team-mate has the same car.
    expect(tuning[teamMate(season)]).toEqual(tuning[season.driver])
    // A rival has only its weekend's work.
    expect(tuning[0].wear).toBe(1)
    expect(tuning[0].risk).toBe(1)
  })

  it('awards points to the first ten finishers and one for the fastest lap', () => {
    const season = toRaceDay(newSeason())
    const race = simulateRace(season, topPlan(season))
    const points = racePoints(race)
    race.order.forEach((driver, place) => {
      const car = race.cars[driver]
      const bonus = race.fastestCar === driver && car.running && place < 10 ? 1 : 0
      expect(points[driver]).toBe(car.running && place < 10 ? POINTS[place] + bonus : 0)
    })
    expect(points.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(101)
    expect(points.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(102)
  })

  it('enters the result, pays the team and lets the rivals develop', () => {
    const season = toRaceDay(newSeason())
    const race = simulateRace(season, topPlan(season))
    const after = recordRace(season, race, true)
    expect(after.stage).toBe('results')
    expect(after.results).toHaveLength(1)
    const result = after.results[0]
    expect(result.order).toEqual(race.order)
    expect(result.grid).toEqual(season.qualifying?.grid)
    expect(result.simulated).toBe(true)
    const teamPoints = result.points[season.driver] + result.points[teamMate(season)]
    expect(result.income).toBe(roundIncome(teamPoints, season.team + 1, 5))
    expect(after.budget).toBe(season.budget + result.income)
    after.rivalPace.forEach((pace, team) => {
      if (team === season.team) expect(pace).toBe(0)
      else expect(pace).toBeLessThan(0)
    })
    // Entered once only.
    expect(recordRace(after, race, true)).toBe(after)
  })

  it('pays more for points and more to a team further down the table', () => {
    expect(roundIncome(10, 5, 10)).toBeGreaterThan(roundIncome(0, 5, 10))
    expect(roundIncome(0, 10, 10)).toBeGreaterThan(roundIncome(0, 1, 10))
    // A five-round season pays twice as much a round as a ten-round one.
    expect(roundIncome(4, 3, 5)).toBe(2 * roundIncome(4, 3, 10))
  })
})

describe('development', () => {
  it('costs more with every level and stops at the top', () => {
    let season = { ...newSeason(), budget: 100_000 }
    for (let level = 0; level < MAX_LEVEL; level++) {
      const before = season.budget
      expect(canBuy(season, 'tyres')).toBe(true)
      season = buyUpgrade(season, 'tyres')
      expect(season.levels.tyres).toBe(level + 1)
      expect(before - season.budget).toBe(upgradeCost(level))
      if (level > 0) expect(upgradeCost(level)).toBeGreaterThan(upgradeCost(level - 1))
    }
    expect(canBuy(season, 'tyres')).toBe(false)
    expect(buyUpgrade(season, 'tyres')).toBe(season)
  })

  it('needs the money', () => {
    const poor = { ...newSeason(), budget: upgradeCost(0) - 1 }
    expect(canBuy(poor, 'aero')).toBe(false)
    expect(buyUpgrade(poor, 'aero')).toBe(poor)
  })

  it('makes the car quicker, kinder to tyres, quicker in the pits and more reliable', () => {
    let season = { ...newSeason(), budget: 100_000 }
    const before = raceTuning(season)[season.driver]
    for (const area of AREAS) season = buyUpgrade(season, area.id)
    const after = raceTuning(season)[season.driver]
    expect(after.pace).toBeLessThan(before.pace)
    expect(after.wear).toBeLessThan(before.wear)
    expect(after.stationary).toBeLessThan(before.stationary)
    expect(after.slowStop).toBeLessThan(before.slowStop)
    expect(after.risk).toBeLessThan(before.risk)
  })

  it('moves a team up the pace order', () => {
    let season = { ...newSeason({ team: 5 }), budget: 100_000 }
    expect(paceOrder(season).indexOf(5)).toBe(5)
    for (let i = 0; i < MAX_LEVEL; i++) season = buyUpgrade(season, 'aero')
    expect(paceOrder(season).indexOf(5)).toBeLessThan(4)
  })
})

describe('a whole season', () => {
  function play(seed: number): Season {
    let season = newSeason({ seed })
    while (season.stage !== 'finished') {
      season = toRaceDay(season)
      season = recordRace(season, simulateRace(season, topPlan(season)), true)
      for (const area of AREAS) while (canBuy(season, area.id)) season = buyUpgrade(season, area.id)
      season = nextRound(season)
    }
    return season
  }

  it('runs every round and ends', () => {
    const season = play(3)
    expect(season.results).toHaveLength(5)
    expect(season.round).toBe(4)
    expect(nextRound(season)).toBe(season)
    expect(canBuy({ ...season, budget: 100_000 }, 'aero')).toBe(false)
  })

  it('is the same season for the same seed and choices', () => {
    expect(play(3)).toEqual(play(3))
  })

  it('keeps tables that add up', () => {
    const season = play(5)
    const table = standings(season)
    expect(table.drivers).toHaveLength(20)
    expect(table.teams).toHaveLength(10)
    for (let i = 1; i < table.drivers.length; i++) {
      expect(table.drivers[i].points).toBeLessThanOrEqual(table.drivers[i - 1].points)
    }
    for (const team of table.teams) {
      const drivers = table.drivers.filter((d) => DRIVERS[d.driver].team === team.team)
      expect(team.points).toBe(drivers.reduce((sum, d) => sum + d.points, 0))
    }
    const total = table.drivers.reduce((sum, d) => sum + d.points, 0)
    expect(total).toBe(season.results.reduce((sum, r) => sum + r.points.reduce((a, b) => a + b, 0), 0))
    expect(table.drivers.reduce((sum, d) => sum + d.wins, 0)).toBe(5)
  })

  it('starts each new weekend from scratch', () => {
    let season = toRaceDay(newSeason())
    season = nextRound(recordRace(season, simulateRace(season, topPlan(season)), true))
    expect(season.round).toBe(1)
    expect(season.stage).toBe('practice')
    expect(season.practice).toBeNull()
    expect(season.qualifying).toBeNull()
  })
})

describe('season coach', () => {
  const base: SeasonCoachState = {
    stage: 'practice',
    round: 2,
    rounds: 5,
    circuit: 'Test Ring',
    qualiPart: 1,
    inQualifying: true,
    racing: false,
    canBuy: false,
  }

  it('points at the control for every stage of a weekend', () => {
    expect(seasonTip({ ...base, stage: 'none' }).target).toBe('season-start')
    expect(seasonTip(base).target).toBe('season-practice')
    expect(seasonTip(base).badge).toEqual(['Round', '2', 'of 5'])
    expect(seasonTip({ ...base, stage: 'qualifying', qualiPart: 2 }).title).toBe('Qualifying: Q2')
    expect(seasonTip({ ...base, stage: 'qualifying', inQualifying: false }).text).toMatch(/rest of qualifying/)
    expect(seasonTip({ ...base, stage: 'race' }).target).toBe('season-grid')
    expect(seasonTip({ ...base, stage: 'race', racing: true }).next?.to).toBe('pitwall')
    expect(seasonTip({ ...base, stage: 'results', canBuy: true }).text).toMatch(/Development/)
    expect(seasonTip({ ...base, stage: 'results' }).done).toBe(true)
    expect(seasonTip({ ...base, stage: 'finished' }).target).toBe('season-next')
  })

  it('has its own address', () => {
    expect(parseRoute('#/season')).toBe('season')
  })
})
