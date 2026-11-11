import { describe, expect, it } from 'vitest'
import { createRng, nextFloat } from '../src/core/math/rng'
import { estimateProfile, type TrackProfile } from '../src/core/profile/trackProfile'
import {
  aiPitCall,
  cloneRace,
  createRace,
  runRace,
  stepLap,
  type RaceSetup,
  type RaceState,
} from '../src/core/race/engine'
import {
  bestDryCompound,
  cleanAirTime,
  raceParams,
  rankStrategies,
  strategyLabel,
  usesTwoDryCompounds,
  type Strategy,
} from '../src/core/race/strategy'
import {
  bestForConditions,
  CLIFF_WEAR,
  COMPOUNDS,
  conditionsPenalty,
  degradation,
  lapsToCliff,
  wearPerLap,
} from '../src/core/race/tyres'
import { advanceWeather, createWeather, forecast } from '../src/core/race/weather'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'

function profileOf(preset: number): TrackProfile {
  const track = buildTrack(createPresets()[preset])!
  return estimateProfile(track, analyseTrack(track), 320)
}

function setupFor(preset = 4, overrides: Partial<RaceSetup> = {}): RaceSetup {
  const profile = profileOf(preset)
  const laps = overrides.laps ?? 40
  return {
    profile,
    laps,
    seed: 11,
    rainChance: 0,
    cars: 20,
    plans: rankStrategies(raceParams(profile, laps)).map((r) => r.strategy),
    ...overrides,
  }
}

const count = (race: RaceState, type: string) => race.log.filter((e) => e.type === type).length

describe('tyres', () => {
  it('lose time steadily with wear and sharply past the cliff', () => {
    for (const c of ['soft', 'medium', 'hard'] as const) {
      let prev = -1
      for (let w = 0; w <= 1.3; w += 0.05) {
        const d = degradation(c, w)
        expect(d).toBeGreaterThan(prev)
        prev = d
      }
      const before = degradation(c, CLIFF_WEAR) - degradation(c, CLIFF_WEAR - 0.1)
      const after = degradation(c, CLIFF_WEAR + 0.2) - degradation(c, CLIFF_WEAR + 0.1)
      expect(after).toBeGreaterThan(before * 5)
    }
  })

  it('trade pace for life: soft fastest and shortest-lived, hard the reverse', () => {
    expect(COMPOUNDS.soft.pace).toBeLessThan(COMPOUNDS.medium.pace)
    expect(COMPOUNDS.medium.pace).toBeLessThan(COMPOUNDS.hard.pace)
    expect(lapsToCliff('soft', 1)).toBeLessThan(lapsToCliff('medium', 1))
    expect(lapsToCliff('medium', 1)).toBeLessThan(lapsToCliff('hard', 1))
    expect(lapsToCliff('medium', 1.4)).toBeLessThan(lapsToCliff('medium', 0.8))
  })

  it('pick slicks in the dry, intermediates in the damp and wets in a downpour', () => {
    expect(bestForConditions(0)).toBe('dry')
    expect(bestForConditions(0.2)).toBe('dry')
    expect(bestForConditions(0.55)).toBe('inter')
    expect(bestForConditions(0.97)).toBe('wet')
    expect(conditionsPenalty('soft', 0)).toBe(0)
    expect(conditionsPenalty('soft', 0.8)).toBeGreaterThan(conditionsPenalty('wet', 0.8) + 5)
    expect(conditionsPenalty('inter', 0)).toBeGreaterThan(5)
  })

  it('wear faster when pushed, when heavy, and when rain tyres run on a dry track', () => {
    const base = wearPerLap('medium', 1, 'normal', 0.5, 0)
    expect(wearPerLap('medium', 1, 'push', 0.5, 0)).toBeGreaterThan(base)
    expect(wearPerLap('medium', 1, 'conserve', 0.5, 0)).toBeLessThan(base)
    expect(wearPerLap('medium', 1, 'normal', 1, 0)).toBeGreaterThan(base)
    expect(wearPerLap('inter', 1, 'normal', 0.5, 0)).toBeGreaterThan(wearPerLap('inter', 1, 'normal', 0.5, 0.5) * 2)
  })
})

describe('weather', () => {
  it('stays dry when rain is impossible and is reproducible', () => {
    const dry = createWeather(createRng(3), 50, 0)
    expect(dry.plan.every((r) => r === 0)).toBe(true)
    expect(dry.wetness).toBe(0)
    expect(createWeather(createRng(8), 50, 0.6)).toEqual(createWeather(createRng(8), 50, 0.6))
  })

  it('rains about as often as asked', () => {
    let wet = 0
    for (let seed = 0; seed < 400; seed++) {
      if (createWeather(createRng(seed), 50, 0.4).plan.some((r) => r > 0)) wet++
    }
    expect(wet / 400).toBeGreaterThan(0.3)
    expect(wet / 400).toBeLessThan(0.55)
  })

  it('soaks the track in rain and dries it over several laps', () => {
    const weather = { plan: [0.8, 0.8, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0], rain: 0, wetness: 0 }
    for (let lap = 0; lap < 3; lap++) advanceWeather(weather, lap)
    expect(weather.wetness).toBeGreaterThan(0.6)
    const soaked = weather.wetness
    advanceWeather(weather, 3)
    expect(weather.wetness).toBeLessThan(soaked)
    expect(weather.wetness).toBeGreaterThan(0.3) // not dry after one lap
    for (let lap = 4; lap < 12; lap++) advanceWeather(weather, lap)
    expect(weather.wetness).toBeLessThan(0.15)
  })

  it('forecasts the plan closely at first and more loosely further out', () => {
    const plan = Array.from({ length: 40 }, (_, i) => (i >= 20 && i < 30 ? 0.7 : 0))
    const rng = createRng(1)
    const f = forecast({ plan, rain: 0, wetness: 0 }, 0, 30, () => nextFloat(rng))
    expect(f).toHaveLength(30)
    expect(f.every((v) => v >= 0 && v <= 1)).toBe(true)
    expect(f[0]).toBeLessThan(0.1)
    expect(f[25]).toBeGreaterThan(0.2)
    expect(forecast({ plan, rain: 0, wetness: 0 }, 35, 30, () => 0.5)).toHaveLength(5)
  })
})

describe('strategy planning', () => {
  const params = raceParams(profileOf(4), 50)

  it('charges every stop the pit lane and the time in the box', () => {
    const one: Strategy = { start: 'medium', stops: [{ lap: 25, compound: 'medium' }] }
    const two: Strategy = {
      start: 'medium',
      stops: [
        { lap: 25, compound: 'medium' },
        { lap: 26, compound: 'medium' },
      ],
    }
    // The second stop swaps one-lap-old tyres: nearly pure pit cost.
    const extra = cleanAirTime(two, params) - cleanAirTime(one, params)
    expect(extra).toBeGreaterThan(params.pitLoss + params.stationary - 1)
    expect(extra).toBeLessThan(params.pitLoss + params.stationary + 1)
  })

  it('ranks legal strategies, fastest first, with stops in order', () => {
    const ranked = rankStrategies(params)
    expect(ranked.length).toBeGreaterThan(5)
    for (let i = 1; i < ranked.length; i++) expect(ranked[i].time).toBeGreaterThanOrEqual(ranked[i - 1].time)
    for (const r of ranked) {
      const compounds = [r.strategy.start, ...r.strategy.stops.map((s) => s.compound)]
      expect(usesTwoDryCompounds(compounds)).toBe(true)
      expect(r.label).toBe(strategyLabel(r.strategy))
      let prev = 0
      for (const stop of r.strategy.stops) {
        expect(stop.lap).toBeGreaterThan(prev + 2)
        expect(stop.lap).toBeLessThan(params.laps - 2)
        prev = stop.lap
      }
      expect(r.time).toBeCloseTo(cleanAirTime(r.strategy, params), 6)
    }
  })

  it('stops less when the pit lane is slow and more when tyres wear fast', () => {
    const stopsOfBest = (p: typeof params) => rankStrategies(p)[0].strategy.stops.length
    const cheap = { ...params, pitLoss: 4 }
    const costly = { ...params, pitLoss: 45 }
    expect(stopsOfBest(cheap)).toBeGreaterThan(stopsOfBest(costly))
    expect(stopsOfBest(costly)).toBe(1)
    const gentle = { ...params, tyreStress: 0.6 }
    const harsh = { ...params, tyreStress: 1.6 }
    expect(stopsOfBest(harsh)).toBeGreaterThan(stopsOfBest(gentle))
  })

  it('keeps stints within reach of the tyre life', () => {
    const best = rankStrategies(params)[0].strategy
    const compounds = [best.start, ...best.stops.map((s) => s.compound)]
    const bounds = [0, ...best.stops.map((s) => s.lap), params.laps]
    compounds.forEach((c, i) => {
      expect(bounds[i + 1] - bounds[i]).toBeLessThanOrEqual(lapsToCliff(c, params.tyreStress) + 6)
    })
  })

  it('chooses soft for a short run to the flag and something harder for a long one', () => {
    expect(bestDryCompound(6, 10, params)).toBe('soft')
    expect(bestDryCompound(35, 50, params)).toBe('hard')
    expect(bestDryCompound(6, 10, params, ['soft'])).not.toBe('soft')
  })
})

describe('race engine', () => {
  it('is reproducible from its seed and differs between seeds', () => {
    const a = runRace(setupFor())
    const b = runRace(setupFor())
    expect(b.order).toEqual(a.order)
    expect(b.cars.map((c) => c.time)).toEqual(a.cars.map((c) => c.time))
    expect(b.log).toEqual(a.log)
    const c = runRace(setupFor(4, { seed: 12 }))
    expect(c.cars.map((x) => x.time)).not.toEqual(a.cars.map((x) => x.time))
  })

  it('classifies every car and keeps consistent history', () => {
    const setup = setupFor()
    const race = runRace(setup)
    expect(race.finished).toBe(true)
    expect(race.lap).toBe(setup.laps)
    expect([...race.order].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(race.cars.map((c) => c.position).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))

    for (const car of race.cars) {
      const lapsRun = car.running ? setup.laps : car.outLap - 1
      expect(car.lapTimes).toHaveLength(lapsRun)
      expect(car.positions).toHaveLength(lapsRun + 1)
      // Stints tile the laps the car ran, without gaps or overlaps.
      let next = 1
      for (const stint of car.stints) {
        expect(stint.from).toBe(next)
        next = stint.to + 1
      }
      if (car.running) {
        expect(next - 1).toBe(setup.laps)
        const total = car.lapTimes.reduce((s, t) => s + t, 0) + car.penalty
        expect(total).toBeCloseTo(car.time, 6)
        expect(car.lapTimes.every((t) => t > setup.profile.baseLapTime * 0.95)).toBe(true)
      }
    }
    // Finishers are in time order.
    const finishers = race.order.filter((i) => race.cars[i].running)
    for (let p = 1; p < finishers.length; p++) {
      expect(race.cars[finishers[p]].time).toBeGreaterThanOrEqual(race.cars[finishers[p - 1]].time)
    }
  })

  it('has every dry-race finisher use two dry compounds', () => {
    for (let seed = 0; seed < 20; seed++) {
      const race = runRace(setupFor(4, { seed }))
      for (const car of race.cars) {
        if (car.running) expect(usesTwoDryCompounds(car.used)).toBe(true)
      }
      expect(count(race, 'penalty')).toBe(0)
    }
  })

  it('continues identically from a clone, and a clone can take a different path', () => {
    const setup = setupFor(4, { manual: [0] })
    const race = createRace(setup)
    for (let i = 0; i < 12; i++) stepLap(race, setup)
    const same = cloneRace(race)
    const other = cloneRace(race)

    while (!race.finished) stepLap(race, setup)
    while (!same.finished) stepLap(same, setup)
    expect(same.cars.map((c) => c.time)).toEqual(race.cars.map((c) => c.time))

    // The manual car stops on the copy only: it must end up with a different race.
    stepLap(other, setup, { 0: { pit: 'hard' } })
    while (!other.finished) stepLap(other, setup)
    expect(other.cars[0].stops).toBe(1)
    expect(race.cars[0].stops).toBe(0)
    expect(other.cars[0].time).not.toBe(race.cars[0].time)
  })

  it('leaves a manual car alone and penalises it for never changing compound', () => {
    const setup = setupFor(4, { manual: [3], incidents: 0 })
    const race = runRace(setup)
    const car = race.cars[3]
    expect(car.stops).toBe(0)
    expect(car.penalty).toBe(30)
    expect(race.log.some((e) => e.type === 'penalty' && e.car === 3)).toBe(true)
    // Worn-out tyres make it far slower than the cars that stopped.
    expect(car.position).toBeGreaterThan(10)
  })

  it('obeys driving-mode orders', () => {
    const setup = setupFor(4, { manual: [0], incidents: 0 })
    const push = createRace(setup)
    const save = createRace(setup)
    for (let i = 0; i < 8; i++) {
      stepLap(push, setup, { 0: { mode: 'push' } })
      stepLap(save, setup, { 0: { mode: 'conserve' } })
    }
    expect(push.cars[0].mode).toBe('push')
    expect(push.cars[0].wear).toBeGreaterThan(save.cars[0].wear * 1.4)
  })

  it('has no retirements or safety cars when incidents are switched off', () => {
    const race = runRace(setupFor(4, { incidents: 0 }))
    expect(count(race, 'out')).toBe(0)
    expect(count(race, 'sc') + count(race, 'vsc')).toBe(0)
    expect(race.cars.every((c) => c.running)).toBe(true)
  })

  it('bunches the field behind the safety car', () => {
    let checked = 0
    for (let seed = 0; seed < 200 && checked < 3; seed++) {
      const setup = setupFor(4, { seed, incidents: 3 })
      const race = createRace(setup)
      let spreadBefore = 0
      let lapsUnder = 0
      while (!race.finished) {
        const was = race.safetyCar
        stepLap(race, setup)
        const running = race.order.filter((i) => race.cars[i].running)
        const spread = race.cars[running[Math.min(9, running.length - 1)]].time - race.cars[running[0]].time
        if (was === 'none' && race.safetyCar === 'sc') spreadBefore = spread
        if (was === 'sc') lapsUnder++
        if (was === 'sc' && race.safetyCar === 'none' && spreadBefore > 12 && lapsUnder >= 3) {
          // The top ten were strung out; after the safety car they are nose to tail.
          expect(spread).toBeLessThan(spreadBefore * 0.7)
          checked++
          break
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('puts the field on rain tyres when it rains', () => {
    let wetRaces = 0
    for (let seed = 0; seed < 12; seed++) {
      const race = runRace(setupFor(4, { seed, rainChance: 1 }))
      if (!race.weather.plan.some((r) => r > 0.4)) continue
      wetRaces++
      const finishers = race.cars.filter((c) => c.running)
      const onRainTyres = finishers.filter((c) => c.used.some((u) => !COMPOUNDS[u].dry))
      expect(onRainTyres.length).toBeGreaterThan(finishers.length * 0.8)
      expect(count(race, 'rain')).toBeGreaterThan(0)
    }
    expect(wetRaces).toBeGreaterThan(3)
  })

  it('makes passing rarer on a circuit that is hard to overtake on', () => {
    const overtakes = (difficulty: number) => {
      const base = setupFor(4, { incidents: 0 })
      const setup = { ...base, profile: { ...base.profile, overtakingDifficulty: difficulty } }
      let total = 0
      for (let seed = 0; seed < 15; seed++) total += count(runRace({ ...setup, seed }), 'overtake')
      return total
    }
    expect(overtakes(0.9)).toBeLessThan(overtakes(0.2) * 0.75)
  })

  it('skips history when not recording, with the same result', () => {
    const recorded = runRace(setupFor())
    const bare = runRace(setupFor(4, { record: false }))
    expect(bare.cars.every((c) => c.lapTimes.length === 0 && c.positions.length === 0)).toBe(true)
    expect(bare.order).toEqual(recorded.order)
  })

  it('asks a car with a planned stop due to come in', () => {
    const setup = setupFor(4, { incidents: 0 })
    const race = createRace(setup)
    const params = raceParams(setup.profile, setup.laps)
    const car = race.cars[0]
    const due = car.plan[0].lap
    while (race.lap + 1 < due) {
      expect(aiPitCall(car, race, params)).toBeNull()
      stepLap(race, setup)
    }
    expect(aiPitCall(car, race, params)).not.toBeNull()
  })
})
