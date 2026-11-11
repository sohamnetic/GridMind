import { describe, expect, it } from 'vitest'
import { estimateProfile, type TrackProfile } from '../src/core/profile/trackProfile'
import { createRace, runRace, type RaceSetup, type RaceState } from '../src/core/race/engine'
import { MIN_STINT, raceParams, rankStrategies, usesTwoDryCompounds, type Strategy } from '../src/core/race/strategy'
import {
  generateCandidates,
  makeCandidate,
  oneStopCandidates,
  oneStopStep,
  peakWear,
  stopLaps,
  strategyKey,
} from '../src/core/strategy/candidates'
import {
  FLAG_RAIN,
  FLAG_RETIRED,
  FLAG_SAFETY,
  mergeOutcomes,
  rivalPlans,
  simulate,
  type Outcomes,
  type StudySetup,
} from '../src/core/strategy/monteCarlo'
import { localEvaluate, optimise } from '../src/core/strategy/optimiser'
import { compareStats, spearman, summarise } from '../src/core/strategy/stats'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'

function profileOf(preset: number): TrackProfile {
  const track = buildTrack(createPresets()[preset])!
  return estimateProfile(track, analyseTrack(track), 320)
}

const profile = profileOf(4)

function study(overrides: Partial<StudySetup> = {}): StudySetup {
  return { profile, laps: 30, rainChance: 0.2, cars: 20, driver: 8, seed: 5, ...overrides }
}

const oneStop = (start: Strategy['start'], lap: number, compound: Strategy['start']): Strategy => ({
  start,
  stops: [{ lap, compound }],
})

describe('candidate strategies', () => {
  const params = raceParams(profile, 50)
  const candidates = generateCandidates(params)

  it('are legal: two dry compounds, stops in order, no stint too short', () => {
    expect(candidates.length).toBeGreaterThan(60)
    for (const { strategy } of candidates) {
      expect(usesTwoDryCompounds([strategy.start, ...strategy.stops.map((s) => s.compound)])).toBe(true)
      let prev = 0
      for (const stop of strategy.stops) {
        expect(stop.lap - prev).toBeGreaterThanOrEqual(MIN_STINT)
        prev = stop.lap
      }
      expect(params.laps - prev).toBeGreaterThanOrEqual(MIN_STINT)
    }
  })

  it('are all different', () => {
    expect(new Set(candidates.map((c) => c.key)).size).toBe(candidates.length)
  })

  it('include every one-stop plan on the grid, and plans with two and three stops', () => {
    const one = oneStopCandidates(params)
    expect(one.length).toBe(6 * stopLaps(50, oneStopStep(50)).length)
    const keys = new Set(candidates.map((c) => c.key))
    for (const c of one) expect(keys.has(c.key)).toBe(true)
    expect(candidates.some((c) => c.strategy.stops.length === 2)).toBe(true)
    // Three stops are only raced where they are not hopeless on a clear track.
    const worn = generateCandidates(raceParams({ ...profile, tyreStress: 2.2, pitLossTime: 8 }, 50))
    expect(worn.some((c) => c.strategy.stops.length === 3)).toBe(true)
  })

  it('keep only multi-stop plans that are competitive on a clear track', () => {
    const best = Math.min(...candidates.map((c) => c.cleanAir))
    const limit = best + 1.2 * (params.pitLoss + params.stationary) + 6 * params.scale + 1e-6
    for (const c of candidates) {
      if (c.strategy.stops.length > 1) expect(c.cleanAir).toBeLessThanOrEqual(limit)
    }
  })
})

describe('a player strategy in the race engine', () => {
  const plans = rankStrategies(raceParams(profile, 40)).map((r) => r.strategy)
  const base: RaceSetup = { profile, laps: 40, seed: 21, rainChance: 0, cars: 20, plans, incidents: 0 }

  it('is followed as written on a dry, quiet race', () => {
    const strategy = oneStop('medium', 19, 'hard')
    const race = runRace({ ...base, player: { driver: 8, strategy } })
    const stints = race.cars[8].stints
    expect(stints.map((s) => s.compound)).toEqual(['medium', 'hard'])
    expect(stints[0].to).toBe(19)
  })

  it('leaves the grid, the weather and the rivals’ plans as they were', () => {
    const a = createRace({ ...base, rainChance: 0.6, player: { driver: 8, strategy: oneStop('medium', 19, 'hard') } })
    const b = createRace({ ...base, rainChance: 0.6, player: { driver: 8, strategy: oneStop('soft', 12, 'hard') } })
    const none = createRace({ ...base, rainChance: 0.6 })
    for (const other of [b, none]) {
      expect(other.cars.map((c) => c.grid)).toEqual(a.cars.map((c) => c.grid))
      expect(other.weather.plan).toEqual(a.weather.plan)
      expect(other.rng.state).toBe(a.rng.state)
      other.cars.forEach((car, i) => {
        if (i !== 8) expect(car.plan).toEqual(a.cars[i].plan)
      })
    }
  })

  it('sees the same safety cars whatever the strategy', () => {
    const safetyLaps = (race: RaceState) =>
      race.log.filter((e) => e.type === 'sc' || e.type === 'vsc').map((e) => `${e.type}${e.lap}`)
    let same = 0
    let withSafety = 0
    for (let seed = 1; seed <= 30; seed++) {
      const a = runRace({ ...base, incidents: 1, seed, player: { driver: 8, strategy: oneStop('medium', 19, 'hard') } })
      const b = runRace({ ...base, incidents: 1, seed, player: { driver: 8, strategy: oneStop('hard', 27, 'soft') } })
      if (safetyLaps(a).length > 0) withSafety++
      if (safetyLaps(a).join() === safetyLaps(b).join()) same++
    }
    expect(withSafety).toBeGreaterThan(5)
    expect(same).toBeGreaterThanOrEqual(27)
  })
})

describe('Monte Carlo runs', () => {
  const setup = study()
  const plans = rivalPlans(setup)
  const plan = oneStop('medium', 15, 'hard')

  it('are reproducible, and batches join into the same results', () => {
    const whole = simulate(setup, plans, plan, 0, 24)
    const again = simulate(setup, plans, plan, 0, 24)
    expect(Array.from(again.positions)).toEqual(Array.from(whole.positions))
    const joined = mergeOutcomes([simulate(setup, plans, plan, 0, 10), simulate(setup, plans, plan, 10, 14)])
    expect(Array.from(joined.positions)).toEqual(Array.from(whole.positions))
    expect(Array.from(joined.times)).toEqual(Array.from(whole.times))
    expect(Array.from(joined.flags)).toEqual(Array.from(whole.flags))
    expect(Array.from(joined.stops)).toEqual(Array.from(whole.stops))
  })

  it('give every strategy the same weather, race for race', () => {
    const wet = study({ rainChance: 0.5 })
    const a = simulate(wet, rivalPlans(wet), plan, 0, 40)
    const b = simulate(wet, rivalPlans(wet), oneStop('soft', 9, 'hard'), 0, 40)
    const rain = (o: Outcomes) => Array.from(o.flags, (f) => f & FLAG_RAIN)
    expect(rain(a)).toEqual(rain(b))
    expect(rain(a).some((f) => f > 0)).toBe(true)
    expect(rain(a).some((f) => f === 0)).toBe(true)
  })

  it('record a time for every finish and none for a retirement', () => {
    const o = simulate(setup, plans, plan, 0, 200)
    let retired = 0
    o.positions.forEach((p, k) => {
      expect(p).toBeGreaterThanOrEqual(1)
      expect(p).toBeLessThanOrEqual(20)
      if (o.flags[k] & FLAG_RETIRED) {
        retired++
        expect(o.times[k]).toBe(0)
      } else {
        expect(o.times[k]).toBeGreaterThan(30 * profile.baseLapTime * 0.9)
      }
    })
    expect(retired).toBeGreaterThan(0)
    expect(retired).toBeLessThan(40)
  })

  it('show a faster car finishing further up', () => {
    const front = study({ driver: 0 })
    const back = study({ driver: 19 })
    const mean = (s: StudySetup) => summarise(simulate(s, rivalPlans(s), plan, 0, 60), 20).meanPosition
    expect(mean(front)).toBeLessThan(mean(back) - 6)
  })
})

describe('statistics', () => {
  it('summarise a batch of results', () => {
    const outcomes: Outcomes = {
      positions: Uint8Array.from([1, 2, 3, 4, 11, 20, 5, 1, 2, 9]),
      times: Float32Array.from([100, 101, 102, 103, 110, 0, 104, 99, 100, 108]),
      flags: Uint8Array.from([0, FLAG_SAFETY, 0, FLAG_RAIN, 0, FLAG_RETIRED, 0, FLAG_SAFETY | FLAG_RAIN, 0, 0]),
      stops: Uint8Array.from([1, 1, 2, 1, 1, 0, 1, 2, 1, 1]),
    }
    const s = summarise(outcomes, 20)
    expect(s.runs).toBe(10)
    expect(s.meanPosition).toBeCloseTo(5.8)
    expect(s.win).toBeCloseTo(0.2)
    expect(s.podium).toBeCloseTo(0.5)
    expect(s.points).toBeCloseTo(0.8)
    expect(s.retired).toBeCloseTo(0.1)
    expect(s.histogram[0]).toBeCloseTo(0.2)
    expect(s.histogram[19]).toBe(0) // the retirement is not counted as a finish in 20th
    expect(s.histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(0.9)
    expect(s.p10).toBe(1)
    expect(s.p50).toBe(3)
    expect(s.p90).toBe(11)
    expect(s.meanTime).toBeCloseTo(103)
    expect(s.meanStops).toBeCloseTo(11 / 9)
    expect(s.safety).toEqual({ runs: 2, meanPosition: 1.5 })
    expect(s.green.runs).toBe(8)
    expect(s.rain).toEqual({ runs: 2, meanPosition: 2.5 })
    expect(s.dry.runs).toBe(8)
  })

  it('order by average position, then race time', () => {
    const make = (positions: number[], time: number): Outcomes => ({
      positions: Uint8Array.from(positions),
      times: Float32Array.from(positions.map(() => time)),
      flags: new Uint8Array(positions.length),
      stops: new Uint8Array(positions.length),
    })
    const a = summarise(make([3, 5], 100), 20)
    const b = summarise(make([4, 5], 90), 20)
    const c = summarise(make([5, 3], 95), 20)
    expect(compareStats(a, b)).toBeLessThan(0)
    expect(compareStats(c, a)).toBeLessThan(0)
  })

  it('measure rank agreement', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1)
    expect(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8)
    expect(spearman([1, 1, 1], [1, 2, 3])).toBe(0)
  })
})

describe('optimiser', () => {
  const setup = study({ rainChance: 0.1 })
  const options = { finalRuns: 80, coarseRuns: 30, finalists: 8 }

  it('ranks finalists best first, reports progress and maps the pit window', async () => {
    const seen: number[] = []
    const result = await optimise(setup, options, localEvaluate(setup), (p) => seen.push(p.done / p.total))
    expect(result.ranked.length).toBe(8)
    for (let i = 1; i < result.ranked.length; i++) {
      expect(compareStats(result.ranked[i - 1].stats, result.ranked[i].stats)).toBeLessThanOrEqual(0)
    }
    for (const r of result.ranked) {
      expect(r.stats.runs).toBe(80)
      // Finalists can be run as written, and mostly are.
      expect(r.candidate.overrun).toBe(false)
      expect(r.stats.meanStops).toBeLessThan(r.candidate.strategy.stops.length + 0.8)
    }
    // No more than two plans from any one tyre sequence.
    const perLabel = new Map<string, number>()
    for (const r of result.ranked) perLabel.set(r.candidate.label, (perLabel.get(r.candidate.label) ?? 0) + 1)
    expect(Math.max(...perLabel.values())).toBeLessThanOrEqual(2)

    expect(seen.length).toBeGreaterThan(10)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(0)
    expect(seen[seen.length - 1]).toBeCloseTo(1)

    const { oneStop: window, twoStop } = result
    expect(window.rows).toEqual(['S-M', 'S-H', 'M-S', 'M-H', 'H-S', 'H-M'])
    expect(window.cells.length).toBe(6)
    for (const row of window.cells) {
      expect(row.length).toBe(window.laps.length)
      for (const cell of row) expect(cell).not.toBeNull()
    }
    expect(twoStop).not.toBeNull()
    twoStop!.cells.forEach((row, r) =>
      row.forEach((cell, c) => {
        // Only pairs with the second stop a full stint after the first exist.
        const possible = twoStop!.laps[r] - twoStop!.laps[c] >= MIN_STINT
        expect(cell !== null).toBe(possible)
      }),
    )
    // The best plan found is far better than stopping on lap 3 for the same tyres.
    const best = result.ranked[0]
    const early = window.cells[window.rows.indexOf('M-H')][0]!
    expect(early.key).toBe(strategyKey(oneStop('medium', 3, 'hard')))
    expect(best.stats.meanPosition).toBeLessThan(early.meanPosition - 1)
  })

  it('reaches much the same verdict from a different set of races', async () => {
    const other = { ...setup, seed: 9001 }
    const a = await optimise(setup, options, localEvaluate(setup))
    const b = await optimise(other, options, localEvaluate(other))
    const flat = (r: typeof a) => r.oneStop.cells.flat().map((c) => c!.meanPosition)
    expect(spearman(flat(a), flat(b))).toBeGreaterThan(0.7)
    // The winner of one study is among the leaders of the other.
    const top = new Set(b.ranked.slice(0, 5).map((r) => r.candidate.label))
    expect(top.has(a.ranked[0].candidate.label)).toBe(true)
  })
})

describe('plans that outlast their tyres', () => {
  const short = profileOf(0)
  const params = raceParams(short, 70)

  it('are flagged, and the car is forced into an extra stop', () => {
    const long = makeCandidate({ start: 'soft', stops: [{ lap: 15, compound: 'hard' }] }, params)
    const sound = makeCandidate(
      {
        start: 'medium',
        stops: [
          { lap: 23, compound: 'hard' },
          { lap: 50, compound: 'medium' },
        ],
      },
      params,
    )
    expect(peakWear(long.strategy, params)).toBeGreaterThan(1.2)
    expect(long.overrun).toBe(true)
    expect(sound.overrun).toBe(false)

    const setup: StudySetup = { profile: short, laps: 70, rainChance: 0, cars: 20, driver: 8, seed: 3 }
    const plans = rivalPlans(setup)
    const stops = (s: Strategy) => summarise(simulate(setup, plans, s, 0, 40), 20).meanStops
    expect(stops(long.strategy)).toBeGreaterThan(1.8)
    expect(stops(sound.strategy)).toBeLessThan(2.6)
  })
})
