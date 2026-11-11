import { describe, expect, it } from 'vitest'
import { createRng } from '../src/core/math/rng'
import { enginePlay, reviewableLaps, reviewLaps, verdictOf } from '../src/core/pitwall/debrief'
import { radioFor } from '../src/core/pitwall/radio'
import { planFrom } from '../src/core/pitwall/replan'
import { boxOption, callOptions, chooseCall, evaluateCall, optionOf, STAY, type CallValue } from '../src/core/pitwall/rollout'
import {
  decisionPoints,
  pitCost,
  playerOf,
  pulseOf,
  rejoinPosition,
  replay,
  sessionSetup,
  trackFractions,
} from '../src/core/pitwall/session'
import { estimateProfile, type TrackProfile } from '../src/core/profile/trackProfile'
import { cloneRace, createRace, stepLap, stripHistory, type CarOrder, type RaceSetup } from '../src/core/race/engine'
import { raceParams, rankStrategies, usesTwoDryCompounds } from '../src/core/race/strategy'
import { COMPOUNDS } from '../src/core/race/tyres'
import { createWeather, rerollWeather } from '../src/core/race/weather'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'

function profileOf(preset: number): TrackProfile {
  const track = buildTrack(createPresets()[preset])!
  return estimateProfile(track, analyseTrack(track), 320)
}

const profile = profileOf(4)
const DRIVER = 8

function session(overrides: { laps?: number; seed?: number; rainChance?: number } = {}): RaceSetup {
  const laps = overrides.laps ?? 40
  const strategy = rankStrategies(raceParams(profile, laps))[0].strategy
  return sessionSetup({
    profile,
    laps,
    seed: overrides.seed ?? 4,
    rainChance: overrides.rainChance ?? 0,
    driver: DRIVER,
    strategy,
  })
}

/** Orders that follow the starting plan and nothing else. */
function planOrders(setup: RaceSetup): CarOrder[] {
  const stops = setup.player!.strategy.stops
  return Array.from({ length: setup.laps }, (_, i) => {
    const stop = stops.find((s) => s.lap === i + 1)
    return stop ? { pit: stop.compound } : {}
  })
}

describe('planning from mid-race', () => {
  const params = raceParams(profile, 50)
  const fresh = { compound: 'medium' as const, wear: 0, fuel: params.fuelStart, used: ['medium' as const] }

  it('finds a legal plan with its stops in order and a window around the first', () => {
    const plan = planFrom(fresh, 0, params)
    expect(plan.stops.length).toBeGreaterThanOrEqual(1)
    let prev = 0
    for (const stop of plan.stops) {
      expect(stop.lap).toBeGreaterThan(prev)
      expect(stop.lap).toBeLessThanOrEqual(48)
      prev = stop.lap
    }
    expect(usesTwoDryCompounds(['medium', ...plan.stops.map((s) => s.compound)])).toBe(true)
    expect(plan.window).not.toBeNull()
    expect(plan.window!.from).toBeLessThanOrEqual(plan.stops[0].lap)
    expect(plan.window!.to).toBeGreaterThanOrEqual(plan.stops[0].lap)
  })

  it('stops at once on dead tyres and not before the earliest lap allowed', () => {
    const dead = planFrom({ ...fresh, wear: 1.05, fuel: params.fuelStart * 0.6 }, 20, params)
    expect(dead.stops[0].lap).toBe(21)
    const held = planFrom({ ...fresh, wear: 1.05, fuel: params.fuelStart * 0.6 }, 20, params, 24)
    expect(held.stops[0].lap).toBe(24)
  })

  it('runs to the flag when the rules are met and the tyres will last', () => {
    const late = planFrom({ compound: 'hard', wear: 0.1, fuel: params.fuelPerLap * 8, used: ['medium', 'hard'] }, 42, params)
    expect(late.stops).toEqual([])
    expect(late.window).toBeNull()
  })

  it('still stops when the second compound has not been used', () => {
    const owed = planFrom({ compound: 'hard', wear: 0.1, fuel: params.fuelPerLap * 8, used: ['hard'] }, 42, params)
    expect(owed.stops.length).toBe(1)
    expect(owed.stops[0].compound).not.toBe('hard')
  })

  it('leaves rain tyres to the weather', () => {
    expect(planFrom({ compound: 'inter', wear: 0.2, fuel: 50, used: ['medium', 'inter'] }, 10, params).stops).toEqual([])
  })
})

describe('re-rolled weather', () => {
  it('keeps the past, leaves the original alone and changes the future', () => {
    const weather = createWeather(createRng(3), 60, 0.9)
    const copy = weather.plan.slice()
    const a = rerollWeather(weather, 20, createRng(1), 0.9)
    const b = rerollWeather(weather, 20, createRng(2), 0.9)
    expect(weather.plan).toEqual(copy)
    expect(a.plan.slice(0, 20)).toEqual(copy.slice(0, 20))
    expect(b.plan.slice(0, 20)).toEqual(copy.slice(0, 20))
    expect(a.plan.slice(20)).not.toEqual(b.plan.slice(20))
    expect(a.wetness).toBe(weather.wetness)
  })

  it('stays dry when rain is impossible', () => {
    const weather = createWeather(createRng(3), 40, 0)
    const again = rerollWeather(weather, 5, createRng(9), 0)
    expect(again.plan.every((r) => r === 0)).toBe(true)
  })
})

describe('a pit-wall race', () => {
  const setup = session()

  it('takes its orders from the player and can be rebuilt from them', () => {
    expect(playerOf(setup)).toBe(DRIVER)
    const orders = planOrders(setup)
    const race = replay(setup, orders)
    expect(race.finished).toBe(true)
    const me = race.cars[DRIVER]
    if (me.running) {
      const plan = setup.player!.strategy
      expect(me.stints.map((s) => s.compound)).toEqual([plan.start, ...plan.stops.map((s) => s.compound)])
      expect(me.stints[0].to).toBe(plan.stops[0].lap)
    }
    const again = replay(setup, orders)
    expect(again.cars.map((c) => c.time)).toEqual(race.cars.map((c) => c.time))
    // Part of the way through is the same race, earlier.
    const half = replay(setup, orders.slice(0, 15))
    expect(half.lap).toBe(15)
    expect(half.cars[DRIVER].lapTimes).toEqual(race.cars[DRIVER].lapTimes.slice(0, half.cars[DRIVER].lapTimes.length))
  })

  it('prices a stop, cheaper behind the safety car, and says where the car would rejoin', () => {
    const params = raceParams(profile, setup.laps)
    const race = replay(setup, planOrders(setup).slice(0, 10))
    const green = pitCost({ ...race, safetyCar: 'none' }, params)
    const sc = pitCost({ ...race, safetyCar: 'sc' }, params)
    expect(green).toBeCloseTo(params.pitLoss + params.stationary)
    expect(sc).toBeLessThan(green * 0.7)
    const me = race.cars[DRIVER]
    expect(rejoinPosition(race, DRIVER, 0)).toBe(me.position)
    expect(rejoinPosition(race, DRIVER, green)).toBeGreaterThanOrEqual(me.position)
    expect(rejoinPosition(race, DRIVER, 1e6)).toBe(race.cars.filter((c) => c.running).length)
  })
})

describe('positions on the map', () => {
  it('follow the leader round the lap with the gaps of the timing screen', () => {
    const setup = session()
    const before = replay(setup, planOrders(setup).slice(0, 8))
    const after = cloneRace(before)
    stepLap(after, setup, { [DRIVER]: {} })
    const out = new Float32Array(before.cars.length)
    const leader = before.order[0]
    const second = before.order[1]

    trackFractions(before, after, 0, out)
    expect(out[leader]).toBeCloseTo(0, 5)
    // A car behind has not reached the line yet: it is near the end of the lap before.
    expect(out[second]).toBeGreaterThan(0.9)

    trackFractions(before, after, 0.5, out)
    expect(out[leader]).toBeGreaterThan(0.4)
    expect(out[leader]).toBeLessThan(0.6)
    expect(out[second]).toBeLessThan(out[leader])
    expect(out[second]).toBeGreaterThan(out[leader] - 0.2)
    for (let i = 0; i < out.length; i++) {
      if (before.cars[i].running && after.cars[i].running) {
        expect(out[i]).toBeGreaterThanOrEqual(0)
        expect(out[i]).toBeLessThan(1)
      } else {
        expect(out[i]).toBe(-1)
      }
    }
  })
})

describe('judging a call by rollouts', () => {
  const setup = session({ laps: 40, seed: 12 })
  const mid = replay(setup, Array.from({ length: 14 }, () => ({})))

  it('offers slicks in the dry, rain tyres in the wet and nothing at the very end', () => {
    expect(callOptions(mid, DRIVER).map((o) => o.id)).toEqual(['stay', 'box-soft', 'box-medium', 'box-hard'])
    const wet = cloneRace(mid)
    wet.weather = { ...wet.weather, wetness: 0.7 }
    expect(callOptions(wet, DRIVER).map((o) => o.id)).toEqual(['stay', 'box-inter', 'box-wet'])
    const last = cloneRace(mid)
    last.lap = last.totalLaps - 2
    expect(callOptions(last, DRIVER)).toEqual([STAY])
    expect(optionOf('hard')).toEqual(boxOption('hard'))
    expect(optionOf(undefined)).toEqual(STAY)
  })

  it('is reproducible and leaves the race it was given untouched', () => {
    const copy = JSON.stringify(mid.cars[DRIVER])
    const options = callOptions(mid, DRIVER)
    const a = evaluateCall(mid, setup, DRIVER, 'normal', options, 12, 77)
    const b = evaluateCall(mid, setup, DRIVER, 'normal', options, 12, 77)
    expect(a).toEqual(b)
    expect(a.map((v) => v.id)).toEqual(options.map((o) => o.id))
    expect(JSON.stringify(mid.cars[DRIVER])).toBe(copy)
    expect(mid.lap).toBe(14)
  })

  it('stays out on young tyres and boxes on dead ones', () => {
    const young = cloneRace(mid)
    young.cars[DRIVER].wear = 0.1
    young.cars[DRIVER].tyreAge = 2
    const fresh = evaluateCall(young, setup, DRIVER, 'normal', callOptions(young, DRIVER), 30, 5)
    expect(chooseCall(fresh).id).toBe('stay')

    const worn = cloneRace(mid)
    worn.cars[DRIVER].wear = 1.15
    const dead = evaluateCall(worn, setup, DRIVER, 'normal', callOptions(worn, DRIVER), 30, 5)
    const call = chooseCall(dead)
    expect(call.pit).not.toBeNull()
    expect(COMPOUNDS[call.pit!].dry).toBe(true)
    expect(dead[0].meanTime - call.meanTime).toBeGreaterThan(3)
  })

  it('goes to rain tyres when slicks are caught in a downpour', () => {
    const soaked = cloneRace(mid)
    soaked.weather = { plan: soaked.weather.plan.map((_, i) => (i >= 14 ? 0.8 : 0)), rain: 0.8, wetness: 0.75 }
    const values = evaluateCall(soaked, { ...setup, rainChance: 0.9 }, DRIVER, 'normal', callOptions(soaked, DRIVER), 24, 5)
    const call = chooseCall(values)
    expect(call.pit === 'inter' || call.pit === 'wet').toBe(true)
  })

  it('only stops for a clear gain', () => {
    const value = (id: string, pit: CallValue['pit'], score: number): CallValue => ({
      id,
      pit,
      score,
      meanTime: 100,
      meanPosition: 5,
      samples: 10,
    })
    const stay = value('stay', null, 0)
    expect(chooseCall([stay, value('box-hard', 'hard', -0.2)], 0.5).id).toBe('stay')
    expect(chooseCall([stay, value('box-hard', 'hard', -1), value('box-soft', 'soft', -2)], 0.5).id).toBe('box-soft')
    expect(verdictOf(0)).toBe('good')
    expect(verdictOf(0.6)).toBe('fair')
    expect(verdictOf(3)).toBe('costly')
  })
})

describe('decision points and radio', () => {
  it('stop the clock for safety cars, the cliff and the pit window', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const setup = session({ seed, laps: 40 })
      const params = raceParams(profile, 40)
      const race = createRace(setup)
      let pulse = pulseOf(race, DRIVER, null)
      let windows = 0
      while (!race.finished && race.cars[DRIVER].running) {
        const me = race.cars[DRIVER]
        const plan = planFrom(me, race.lap, params)
        const points = decisionPoints(pulse, race, DRIVER, params, plan)
        for (const d of points) {
          seen.add(d.type)
          expect(d.text.length).toBeGreaterThan(10)
          if (d.type === 'window') windows++
          if (d.type === 'safety') expect(race.safetyCar).not.toBe('none')
          if (d.type === 'cliff') expect(me.wear).toBeGreaterThan(0.7)
        }
        pulse = pulseOf(race, DRIVER, plan)
        stepLap(race, setup, { [DRIVER]: {} }) // never stops: the tyres must reach the cliff
      }
      // The window is announced when it opens, not on every lap it stays open.
      expect(windows).toBeLessThanOrEqual(3)
    }
    expect(seen.has('safety')).toBe(true)
    expect(seen.has('cliff')).toBe(true)
    expect(seen.has('window')).toBe(true)
  })

  it('stop the clock when rain arrives and when the track wants other tyres', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const setup = session({ seed, laps: 40, rainChance: 0.9 })
      const params = raceParams(profile, 40)
      const race = createRace(setup)
      let pulse = pulseOf(race, DRIVER, null)
      while (!race.finished && race.cars[DRIVER].running) {
        for (const d of decisionPoints(pulse, race, DRIVER, params, null)) seen.add(d.type)
        pulse = pulseOf(race, DRIVER, null)
        stepLap(race, setup, { [DRIVER]: {} })
      }
    }
    expect(seen.has('rain')).toBe(true)
    expect(seen.has('crossover')).toBe(true)
  })

  it('reports the start, the stops and the flag, the same way every time', () => {
    const setup = session({ seed: 6 })
    const params = raceParams(profile, setup.laps)
    const orders = planOrders(setup)
    const talk = () => {
      const race = createRace(setup)
      const lines: string[] = []
      for (const order of orders) {
        if (race.finished) break
        const before = cloneRace(race)
        stepLap(race, setup, { [DRIVER]: order })
        const messages = radioFor(before, race, DRIVER, params, null, false)
        expect(messages.length).toBeLessThanOrEqual(4)
        for (const m of messages) {
          expect(m.lap).toBe(race.lap)
          lines.push(`${m.lap}:${m.text}`)
        }
      }
      return { lines, race }
    }
    const { lines, race } = talk()
    expect(talk().lines).toEqual(lines)
    expect(lines.some((l) => l.startsWith('1:') && /start/i.test(l))).toBe(true)
    if (race.cars[DRIVER].running) {
      const stopLap = setup.player!.strategy.stops[0].lap
      expect(lines.some((l) => l.startsWith(`${stopLap}:`) && /stop/i.test(l))).toBe(true)
      expect(lines[lines.length - 1]).toMatch(/Chequered flag|penalty/)
    }
  })
})

describe('debrief', () => {
  const setup = session({ laps: 30, seed: 9, rainChance: 0.5 })

  it('finds nothing to fault in the engine’s own calls', () => {
    const engine = enginePlay(setup, 16)
    expect(engine.orders.length).toBe(30)
    const race = replay(setup, engine.orders)
    expect(race.cars[DRIVER].position).toBe(engine.position)
    const reviews = reviewLaps(setup, engine.orders, reviewableLaps(30), 16)
    expect(reviews.length).toBeGreaterThan(0)
    for (const r of reviews) {
      expect(r.chosen).toBe(r.best)
      expect(r.loss).toBe(0)
      expect(r.seconds).toBe(0)
      expect(r.verdict).toBe('good')
    }
  })

  it('charges for a stop on fresh tyres', () => {
    const dry = session({ laps: 30, seed: 4 })
    const orders: CarOrder[] = Array.from({ length: 30 }, () => ({}))
    // Two stops a lap apart for the same tyres: the first meets the two-compound rule, the second is thrown away.
    const other = dry.player!.strategy.start === 'hard' ? 'medium' : 'hard'
    orders[4] = { pit: other }
    orders[5] = { pit: other }
    const reviews = reviewLaps(dry, orders, [6], 24)
    expect(reviews.length).toBe(1)
    {
      expect(reviews[0].lap).toBe(6)
      expect(reviews[0].chosen).toBe(`box-${other}`)
      expect(reviews[0].best).toBe('stay')
      expect(reviews[0].loss).toBeGreaterThan(1)
      expect(reviews[0].seconds).toBeGreaterThan(0)
      expect(reviews[0].verdict).toBe('costly')
    }
  })

  it('has the engine finish legally and no worse than a car that never reacts', () => {
    let engineSum = 0
    let blindSum = 0
    for (const seed of [3, 5, 8, 13]) {
      const s = session({ laps: 30, seed, rainChance: 0.6 })
      const engine = enginePlay(s, 12)
      const blind = replay(s, planOrders(s))
      engineSum += engine.position
      blindSum += blind.cars[DRIVER].position
      const mine = replay(s, engine.orders).cars[DRIVER]
      if (mine.running) expect(mine.penalty).toBe(0)
    }
    expect(engineSum).toBeLessThanOrEqual(blindSum)
  })

  it('reviews only the laps asked for, on a stripped copy of the race', () => {
    const orders = planOrders(setup)
    const reviews = reviewLaps(setup, orders, [3, 7], 8)
    expect(reviews.map((r) => r.lap).every((l) => l === 3 || l === 7)).toBe(true)
    const race = replay(setup, orders.slice(0, 5))
    const bare = stripHistory(race)
    expect(bare.cars[DRIVER].lapTimes).toEqual([])
    expect(race.cars[DRIVER].lapTimes.length).toBeGreaterThan(0)
    expect(bare.cars[DRIVER].time).toBe(race.cars[DRIVER].time)
  })
})
