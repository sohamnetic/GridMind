import { describe, expect, it } from 'vitest'
import { enginePlay, reviewLaps } from '../src/core/pitwall/debrief'
import { callOptions, evaluateCall } from '../src/core/pitwall/rollout'
import { playerOf, replay, sessionSetup, setupFor, splitOrders, type LapOrders } from '../src/core/pitwall/session'
import { estimateProfile } from '../src/core/profile/trackProfile'
import {
  cloneRace,
  createRace,
  CREW_RESET,
  runRace,
  stepLap,
  type RaceSetup,
  type RaceState,
} from '../src/core/race/engine'
import { DRIVERS } from '../src/core/race/grid'
import { raceParams, rankStrategies } from '../src/core/race/strategy'
import { circuitSpec } from '../src/core/season/circuits'
import { finishPractice, playerParams } from '../src/core/season/practice'
import { finishQualifying } from '../src/core/season/qualifying'
import { createSeason, raceSetup, recordRace, simulateRace, teamMate } from '../src/core/season/season'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'

const track = buildTrack(createPresets()[4])!
const profile = estimateProfile(track, analyseTrack(track), 320)
const A = 8
const B = 9
const LAPS = 30
const plans = rankStrategies(raceParams(profile, LAPS))

function teamSetup(seed = 4): RaceSetup {
  return sessionSetup({
    profile,
    laps: LAPS,
    seed,
    rainChance: 0,
    driver: A,
    strategy: plans[0].strategy,
    mate: { driver: B, strategy: plans[1].strategy },
  })
}

/**
 * Puts car `behind` one second behind car `ahead` on the road, so that they
 * reach the pits together. Cars further apart than a stop takes never queue.
 */
function closeUp(race: RaceState, ahead: number, behind: number): void {
  race.cars[behind].time = race.cars[ahead].time + 1
  race.order.sort((x, y) => race.cars[x].time - race.cars[y].time)
}

/** The time each of the player's cars spent on its stop on the lap just run, from the race log. */
function stopTimes(race: RaceState): Record<number, number> {
  const out: Record<number, number> = {}
  for (const e of race.log) if (e.lap === race.lap && e.type === 'pit' && e.car !== undefined) out[e.car] = e.value ?? 0
  return out
}

describe('two cars taking orders', () => {
  it('puts both cars under the pit wall, each on its own plan', () => {
    const setup = teamSetup()
    expect(setup.manual).toEqual([A, B])
    expect(playerOf(setup)).toBe(A)
    const race = createRace(setup)
    expect(race.cars[A].compound).toBe(plans[0].strategy.start)
    expect(race.cars[B].compound).toBe(plans[1].strategy.start)
    expect(race.cars[B].plan).toEqual(plans[1].strategy.stops)
  })

  it('leaves the rest of the field as it was with one car', () => {
    const solo = createRace({ ...teamSetup(), manual: [A], mate: undefined })
    const team = createRace(teamSetup())
    expect(team.order).toEqual(solo.order)
    expect(team.weather.plan).toEqual(solo.weather.plan)
    for (let i = 0; i < team.cars.length; i++) {
      if (i === B) continue
      expect(team.cars[i].plan).toEqual(solo.cars[i].plan)
      expect(team.cars[i].compound).toBe(solo.cars[i].compound)
    }
  })

  it('never stops a car it has not been told to stop', () => {
    const setup = teamSetup()
    const race = createRace(setup)
    while (!race.finished) stepLap(race, setup, {})
    expect(race.cars[A].stops).toBe(0)
    expect(race.cars[B].stops).toBe(0)
  })

  it('sees the race from either car', () => {
    const setup = teamSetup()
    expect(setupFor(setup, A)).toBe(setup)
    const other = setupFor(setup, B)
    expect(other.manual).toEqual([B, A])
    expect(playerOf(other)).toBe(B)
    expect(other.seed).toBe(setup.seed)
    // A car that takes no orders cannot be the one whose calls are judged.
    expect(setupFor(setup, 3)).toBe(setup)
  })

  it('splits the history of orders by car, and replays it the same from either side', () => {
    const setup = teamSetup()
    const history: LapOrders[] = Array.from({ length: 20 }, (_, i) => ({
      [A]: i === 9 ? { pit: 'hard' as const } : {},
      [B]: i === 13 ? { pit: 'medium' as const, mode: 'push' as const } : { mode: 'push' as const },
    }))
    const direct = createRace(setup)
    for (const lap of history) stepLap(direct, setup, lap)

    const mine = splitOrders(history, A)
    expect(mine.orders[9]).toEqual({ pit: 'hard' })
    expect(mine.others[13]).toEqual({ [B]: { pit: 'medium', mode: 'push' } })
    const fromA = replay(setup, mine.orders, mine.others)
    const theirs = splitOrders(history, B)
    const fromB = replay(setupFor(setup, B), theirs.orders, theirs.others)
    for (const race of [fromA, fromB]) {
      expect(race.lap).toBe(20)
      expect(race.cars.map((c) => c.time)).toEqual(direct.cars.map((c) => c.time))
      expect(race.cars[A].stops).toBe(1)
      expect(race.cars[B].stops).toBe(1)
      expect(race.cars[B].mode).toBe('push')
    }
  })
})

/** A race after ten quiet laps under green, both cars running, car B one second behind car A. */
function quiet(): { setup: RaceSetup; race: RaceState } {
  for (let seed = 1; seed < 40; seed++) {
    const setup = teamSetup(seed)
    const race = createRace(setup)
    for (let i = 0; i < 10; i++) stepLap(race, setup, {})
    if (race.cars[A].running && race.cars[B].running && race.safetyCar === 'none') {
      closeUp(race, A, B)
      return { setup, race }
    }
  }
  throw new Error('no quiet race found')
}

describe('double-stacked stops', () => {
  it('makes the second car wait for the box', () => {
    const { setup, race } = quiet()
    const together = cloneRace(race)
    stepLap(together, setup, { [A]: { pit: 'hard' }, [B]: { pit: 'hard' } })
    const stack = together.log.filter((e) => e.type === 'stack' && e.lap === together.lap)
    expect(stack).toHaveLength(1)
    // The car behind on the road is the one that queues.
    expect(stack[0].car).toBe(B)
    expect(stack[0].value).toBeGreaterThan(0.5)
    const times = stopTimes(together)
    expect(times[B]).toBeGreaterThan(times[A])

    // Far enough apart on the road, the box is free again by the time the second car arrives.
    const spread = cloneRace(race)
    spread.cars[B].time = spread.cars[A].time + 20
    spread.order.sort((x, y) => spread.cars[x].time - spread.cars[y].time)
    stepLap(spread, setup, { [A]: { pit: 'hard' }, [B]: { pit: 'hard' } })
    expect(spread.log.some((e) => e.type === 'stack')).toBe(false)

    // The same two stops a lap apart cost neither car anything extra.
    const apart = cloneRace(race)
    stepLap(apart, setup, { [A]: { pit: 'hard' } })
    stepLap(apart, setup, { [B]: { pit: 'hard' } })
    expect(apart.log.some((e) => e.type === 'stack')).toBe(false)
  })

  it('waits no longer than the first stop and the crew turning round', () => {
    const { setup, race } = quiet()
    stepLap(race, setup, { [A]: { pit: 'medium' }, [B]: { pit: 'medium' } })
    const wait = race.log.find((e) => e.type === 'stack')?.value ?? 0
    // A slow stop for the car in front is the worst case: twelve seconds in the box.
    expect(wait).toBeLessThan(12 + CREW_RESET)
  })

  it('only ever queues a car behind its own team-mate', () => {
    let seen = 0
    for (let seed = 1; seed <= 25; seed++) {
      const race = runRace({ ...teamSetup(seed), manual: [], rainChance: 0.6 })
      for (const e of race.log) {
        if (e.type !== 'stack' || e.car === undefined) continue
        seen++
        const mate = e.car % 2 === 0 ? e.car + 1 : e.car - 1
        expect(DRIVERS[mate].team).toBe(DRIVERS[e.car].team)
        expect(race.log.some((p) => p.type === 'pit' && p.lap === e.lap && p.car === mate)).toBe(true)
      }
    }
    // Rain brings whole teams in together often enough to see it.
    expect(seen).toBeGreaterThan(0)
  })
})

describe('judging one car of two', () => {
  const setup = teamSetup(6)

  it('counts the queue when the team-mate is stopping on the same lap', () => {
    // Green-flag running, with car B right behind car A: if both stop, B is the one that waits.
    const { setup: quietSetup, race } = quiet()
    const view = setupFor(quietSetup, B)
    const options = callOptions(race, B)
    const alone = evaluateCall(race, view, B, 'normal', options, 16, 3)
    const stacked = evaluateCall(race, view, B, 'normal', options, 16, 3, { [A]: { pit: 'hard' } })
    const cost = (values: typeof alone) =>
      values.find((v) => v.id === 'box-hard')!.meanTime - values.find((v) => v.id === 'stay')!.meanTime
    // Stopping costs more against staying out when the box is busy.
    expect(cost(stacked)).toBeGreaterThan(cost(alone) + 0.5)
    expect(evaluateCall(race, view, B, 'normal', options, 16, 3, { [A]: { pit: 'hard' } })).toEqual(stacked)
  })

  it('reviews the second car against the same race', () => {
    const history: LapOrders[] = Array.from({ length: LAPS }, (_, i) => ({
      [A]: i === 11 ? { pit: 'hard' as const } : {},
      [B]: i === 15 ? { pit: 'medium' as const } : {},
    }))
    const { orders, others } = splitOrders(history, B)
    const reviews = reviewLaps(setupFor(setup, B), orders, [10, 16], 8, () => {}, others)
    expect(reviews.map((r) => r.lap)).toEqual([10, 16])
    expect(reviews[1].chosen).toBe('box-medium')
    expect(reviewLaps(setupFor(setup, B), orders, [10, 16], 8, () => {}, others)).toEqual(reviews)
  })

  it("lets the engine run one car while the other does what it was told", () => {
    const others: LapOrders[] = Array.from({ length: LAPS }, (_, i) => ({ [B]: i === 15 ? { pit: 'medium' as const } : {} }))
    const run = enginePlay(setup, 8, () => {}, others)
    expect(run.orders).toHaveLength(LAPS)
    const race = replay(setup, run.orders, others)
    expect(race.finished).toBe(true)
    expect(race.cars[A].position).toBe(run.position)
    // The team-mate made exactly the stop it was given.
    expect(race.cars[B].stops).toBe(race.cars[B].running || race.cars[B].outLap > 16 ? 1 : 0)
  })
})

describe('a season with both cars', () => {
  const circuits = createPresets().flatMap((def) => {
    const spec = circuitSpec(def, null)
    return spec ? [spec] : []
  })
  const base = { seed: 9, team: 4, seat: 0, circuits, rounds: 5, distance: 'sprint' as const }
  const raceDay = (bothCars: boolean) =>
    finishQualifying(finishPractice(createSeason({ ...base, bothCars }), { quali: 2, race: 3, pit: 1 }))

  it('is one car unless asked for both', () => {
    expect(createSeason(base).bothCars).toBe(false)
    const one = raceDay(false)
    const plan = rankStrategies(playerParams(one))[0].strategy
    expect(raceSetup(one, plan).manual).toEqual([one.driver])
    expect(raceSetup(one, plan).mate).toBeUndefined()
  })

  it('hands the team-mate to the pit wall with a plan of its own', () => {
    const two = raceDay(true)
    const ranked = rankStrategies(playerParams(two))
    const setup = raceSetup(two, ranked[0].strategy, ranked[1].strategy)
    expect(setup.manual).toEqual([two.driver, teamMate(two)])
    expect(setup.mate).toEqual({ driver: teamMate(two), strategy: ranked[1].strategy })
    expect(createRace(setup).cars[teamMate(two)].compound).toBe(ranked[1].strategy.start)
  })

  it('still lets the engineer run both', () => {
    const two = raceDay(true)
    const plan = rankStrategies(playerParams(two))[0].strategy
    const race = simulateRace(two, plan)
    expect(race.finished).toBe(true)
    // Left to the engineer, both cars make their stops.
    for (const car of [two.driver, teamMate(two)]) {
      if (race.cars[car].running) expect(race.cars[car].stops).toBeGreaterThan(0)
    }
    expect(recordRace(two, race, true).stage).toBe('results')
  })
})
