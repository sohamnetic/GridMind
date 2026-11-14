import { describe, expect, it } from 'vitest'
import { estimateProfile } from '../src/core/profile/trackProfile'
import { runRace, type RaceState } from '../src/core/race/engine'
import {
  buildReplay,
  replayDistances,
  replayFractions,
  replayInPit,
  replayLap,
  replayMoments,
  replayOrder,
} from '../src/core/race/replay'
import { raceParams, rankStrategies } from '../src/core/race/strategy'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'

const track = buildTrack(createPresets()[4])!
const profile = estimateProfile(track, analyseTrack(track), 320)
const LAPS = 30

function race(seed: number, rainChance = 0.3): RaceState {
  return runRace({
    profile,
    laps: LAPS,
    seed,
    rainChance,
    cars: 20,
    plans: rankStrategies(raceParams(profile, LAPS)).map((r) => r.strategy),
  })
}

/** A race in which somebody retired, so the replay has a car to take away. */
function raceWithRetirement(): RaceState {
  for (let seed = 1; seed < 60; seed++) {
    const r = race(seed)
    if (r.cars.some((c) => !c.running && c.outLap > 2)) return r
  }
  throw new Error('no race with a retirement found')
}

describe('race replay', () => {
  const finished = race(3)
  const replay = buildReplay(finished)

  it('knows when every car crossed the line', () => {
    expect(replay.crossings).toHaveLength(20)
    expect(replay.laps).toBe(LAPS)
    finished.cars.forEach((car, i) => {
      const times = replay.crossings[i]
      expect(times[0]).toBe(0)
      expect(times).toHaveLength(car.lapTimes.length + 1)
      for (let k = 1; k < times.length; k++) expect(times[k]).toBeGreaterThan(times[k - 1])
      // The race time of a car that finished, less any penalty added at the flag.
      if (car.running) expect(times[times.length - 1]).toBeCloseTo(car.time - car.penalty, 6)
    })
    const winner = finished.cars[finished.order[0]]
    expect(replay.winnerTime).toBeCloseTo(winner.time - winner.penalty, 6)
    expect(replay.duration).toBeGreaterThanOrEqual(replay.winnerTime)
  })

  it('lines the field up on the grid at the start', () => {
    const fractions = new Float32Array(20)
    replayFractions(replay, 0, fractions)
    const pole = finished.cars.findIndex((c) => c.grid === 1)
    const last = finished.cars.findIndex((c) => c.grid === 20)
    // Pole sits on the line; the back of the grid is a little way behind it, which is just short of a whole lap round.
    expect(fractions[pole]).toBeCloseTo(0, 5)
    expect(fractions[last]).toBeGreaterThan(0.9)
    expect(replayOrder(replay, 0)).toEqual(
      finished.cars.map((c) => c.driver).sort((a, b) => finished.cars[a].grid - finished.cars[b].grid),
    )
    expect(replayLap(replay, 0)).toBe(1)
  })

  it('puts a car at the line at the moment it crosses it, and half way round half way through its lap', () => {
    const distance = new Float32Array(20)
    const car = finished.order[0]
    const times = replay.crossings[car]
    replayDistances(replay, times[7], distance)
    expect(distance[car]).toBeCloseTo(7, 4)
    replayDistances(replay, (times[7] + times[8]) / 2, distance)
    expect(distance[car]).toBeCloseTo(7.5, 4)
    replayDistances(replay, times[8] - 1e-6, distance)
    expect(distance[car]).toBeGreaterThan(7.99)
  })

  it('drives a pit lap at racing speed and spends the stop at the end of it', () => {
    const stop = finished.log.find((e) => e.type === 'pit' && e.lap > 2)!
    const car = stop.car!
    const times = replay.crossings[car]
    const start = times[stop.lap - 1]
    const end = times[stop.lap]
    const held = replay.pits[car][stop.lap - 1]
    expect(held).toBeGreaterThan(2)
    expect(held).toBeLessThan(end - start)
    const distance = new Float32Array(20)
    // Half way through the driving, the car is half way round, not held back by a stop still to come.
    replayDistances(replay, start + (end - start - held) / 2, distance)
    expect(distance[car] - (stop.lap - 1)).toBeCloseTo(0.4925, 3)
    expect(replayInPit(replay, car, start + (end - start - held) / 2)).toBe(false)
    // During the stop it is at the end of the lap, and barely moving.
    replayDistances(replay, end - held / 2, distance)
    expect(distance[car] - (stop.lap - 1)).toBeGreaterThan(0.985)
    expect(distance[car]).toBeLessThan(stop.lap)
    expect(replayInPit(replay, car, end - held / 2)).toBe(true)
    expect(replayInPit(replay, car, end + 1)).toBe(false)
    // A lap without a stop has none recorded.
    expect(replay.pits[car][stop.lap]).toBe(0)
  })

  it('never lets a car go backwards', () => {
    const distance = new Float32Array(20)
    const before = new Float32Array(20)
    for (let t = 0; t <= replay.duration; t += replay.duration / 400) {
      replayDistances(replay, t, distance)
      for (let c = 0; c < 20; c++) {
        if (distance[c] >= 0 && before[c] >= 0) expect(distance[c]).toBeGreaterThanOrEqual(before[c] - 1e-5)
      }
      before.set(distance)
    }
  })

  it('ends in the finishing order', () => {
    const end = replayOrder(replay, replay.duration + 1)
    const classified = finished.order.filter((c) => finished.cars[c].running)
    // A penalty added after the flag can reorder the classification; without one the road order is the result.
    if (finished.cars.every((c) => c.penalty === 0)) expect(end.slice(0, classified.length)).toEqual(classified)
    expect(replayLap(replay, replay.duration + 1)).toBe(LAPS)
    expect(end).toHaveLength(20)
  })

  it('agrees with the lap chart on who led each lap', () => {
    const leader = finished.order[0]
    for (const lap of [5, 12, 20]) {
      // Just after the eventual winner finishes the lap, the car that was leading then has finished it too.
      const order = replayOrder(replay, replay.crossings[leader][lap] + 1e-3)
      const leading = finished.cars.find((c) => c.positions[lap] === 1)
      expect(order[0]).toBe(leading?.driver)
    }
  })

  it('takes a retired car off the track part way round the lap it stopped on', () => {
    const broken = raceWithRetirement()
    const r = buildReplay(broken)
    const out = broken.cars.find((c) => !c.running && c.outLap > 2)!
    const times = r.crossings[out.driver]
    expect(times).toHaveLength(out.outLap)
    const last = times[times.length - 1]
    const lap = last - times[times.length - 2]
    const distance = new Float32Array(20)
    replayDistances(r, last + lap * 0.2, distance)
    expect(distance[out.driver]).toBeGreaterThan(out.outLap - 1)
    replayDistances(r, last + lap * 0.9, distance)
    expect(distance[out.driver]).toBe(-1)
    // Out of the race, it is listed after every car still running.
    const order = replayOrder(r, r.duration)
    const running = broken.cars.filter((c) => c.running).length
    expect(order.indexOf(out.driver)).toBeGreaterThanOrEqual(running)
  })

  it('lists the moments worth jumping to, in order, for the car being followed', () => {
    const focus = finished.order[4]
    const moments = replayMoments(finished, replay, focus)
    expect(moments[0]).toEqual({ time: 0, lap: 1, type: 'start' })
    expect(moments[moments.length - 1].type).toBe('flag')
    for (let i = 1; i < moments.length; i++) expect(moments[i].time).toBeGreaterThanOrEqual(moments[i - 1].time)
    for (const m of moments) {
      expect(m.time).toBeGreaterThanOrEqual(0)
      expect(m.time).toBeLessThanOrEqual(replay.duration)
    }
    // Every stop the car made is there, and nobody else's.
    const stops = moments.filter((m) => m.type === 'pit')
    expect(stops).toHaveLength(finished.cars[focus].stops)
    expect(stops.every((m) => m.car === focus)).toBe(true)
    // A stop is found on the lap it was made.
    for (const stop of stops) {
      const times = replay.crossings[focus]
      expect(stop.time).toBeGreaterThan(times[stop.lap - 1])
      expect(stop.time).toBeLessThan(times[stop.lap])
    }
    const passes = finished.log.filter((e) => e.type === 'overtake' && e.car === focus).length
    expect(moments.filter((m) => m.type === 'overtake')).toHaveLength(passes)
    // Following another car gives another list.
    const other = replayMoments(finished, replay, finished.order[15])
    expect(other.filter((m) => m.type === 'pit').every((m) => m.car === finished.order[15])).toBe(true)
  })

  it('marks every safety car of the race', () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = race(seed)
      const deployed = r.log.filter((e) => e.type === 'sc' || e.type === 'vsc').length
      if (deployed === 0) continue
      const moments = replayMoments(r, buildReplay(r), r.order[0])
      expect(moments.filter((m) => m.type === 'sc')).toHaveLength(deployed)
      return
    }
    throw new Error('no race with a safety car found')
  })
})
