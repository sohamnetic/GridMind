import { describe, expect, it } from 'vitest'
import { createRng, nextFloat } from '../src/core/math/rng'
import { createCar, DEFAULT_CAR, stepCar, topSpeed, type CarInput } from '../src/core/physics/car'
import { createLapTimer, updateLapTimer } from '../src/core/physics/lapTimer'
import { referenceDriver } from '../src/core/physics/referenceDriver'
import {
  estimateProfile,
  estimateTrace,
  measureProfile,
  PIT_SPEED,
  traceFromPath,
} from '../src/core/profile/trackProfile'
import { DRIVERS, gridOrder, TEAMS } from '../src/core/race/grid'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'

const presets = createPresets()
const load = (i: number) => {
  const track = buildTrack(presets[i])!
  return { track, analysis: analyseTrack(track) }
}

/** One flying lap of the reference driver as x, y, speed triplets every 0.1 s. */
function referencePath(i: number) {
  const { track } = load(i)
  const car = createCar(track, track.def.startFraction * track.length - 15)
  const timer = createLapTimer(track, car.s)
  const input: CarInput = { steer: 0, throttle: 0, brake: 0 }
  const path: number[] = []
  let tick = 0
  while (timer.laps < 2 && car.time < 300) {
    referenceDriver(car, track, DEFAULT_CAR, input)
    stepCar(car, input, track, DEFAULT_CAR, 1 / 60)
    updateLapTimer(timer, track, car.s, car.speed, car.time)
    if (timer.laps === 1 && tick % 6 === 0) path.push(car.x, car.y, car.speed)
    tick++
  }
  return { path: new Float32Array(path), lap: timer.lastLap! }
}

describe('estimated lap trace', () => {
  it('never exceeds top speed or the cornering limit', () => {
    const { track } = load(4)
    const trace = estimateTrace(track)
    const vTop = topSpeed(DEFAULT_CAR)
    for (let i = 0; i < track.n; i++) {
      expect(trace.speed[i]).toBeLessThanOrEqual(vTop + 1e-6)
      expect(trace.speed[i]).toBeGreaterThan(5)
    }
    // Slower in the tightest corner than on the longest straight.
    expect(Math.min(...trace.speed)).toBeLessThan(Math.max(...trace.speed) * 0.5)
  })
})

describe('track profile', () => {
  it('estimates plausible numbers for every preset', () => {
    for (let i = 0; i < presets.length; i++) {
      const { track, analysis } = load(i)
      const p = estimateProfile(track, analysis, 320)
      expect(p.source).toBe('estimate')
      expect(p.baseLapTime).toBeGreaterThan(15)
      expect(p.baseLapTime).toBeLessThan(120)
      expect(p.averageSpeed).toBeCloseTo(track.length / p.baseLapTime, 6)
      expect(p.fullThrottle).toBeGreaterThan(0.4)
      expect(p.fullThrottle).toBeLessThanOrEqual(1)
      expect(p.tyreStress).toBeGreaterThanOrEqual(0.6)
      expect(p.tyreStress).toBeLessThanOrEqual(1.6)
      expect(p.overtakingDifficulty).toBeGreaterThanOrEqual(0.15)
      expect(p.overtakingDifficulty).toBeLessThanOrEqual(0.95)
      // The pit lane is slower than racing, but not by more than driving it at the limit.
      expect(p.pitLossTime).toBeGreaterThanOrEqual(5)
      expect(p.pitLossTime).toBeLessThan(320 / PIT_SPEED)
    }
  })

  it('finds the oval easier to pass on than the short twisty circuit', () => {
    const oval = load(1)
    const short = load(0)
    expect(estimateProfile(oval.track, oval.analysis).overtakingDifficulty).toBeLessThan(
      estimateProfile(short.track, short.analysis).overtakingDifficulty,
    )
  })

  it('charges more for a longer pit lane', () => {
    const { track, analysis } = load(4)
    expect(estimateProfile(track, analysis, 500).pitLossTime).toBeGreaterThan(
      estimateProfile(track, analysis, 300).pitLossTime,
    )
  })

  it('measures a recorded lap and keeps its lap time', () => {
    const { track, analysis } = load(1)
    const { path, lap } = referencePath(1)
    const trace = traceFromPath(track, path)
    expect(trace).not.toBeNull()
    const p = measureProfile(track, analysis, path, lap, 300)
    expect(p.source).toBe('drivers')
    expect(p.baseLapTime).toBe(lap)
    // Integrating the reconstructed speeds should land near the real lap time.
    let t = 0
    for (let i = 0; i < track.n; i++) t += track.step / trace!.speed[i]
    expect(Math.abs(t - lap) / lap).toBeLessThan(0.05)
    expect(p.topSpeed).toBeGreaterThan(60)
  })

  it('falls back to the estimate when the recording is incomplete', () => {
    const { track, analysis } = load(1)
    const { path, lap } = referencePath(1)
    const half = path.slice(0, Math.floor(path.length / 6) * 3)
    expect(traceFromPath(track, half)).toBeNull()
    expect(measureProfile(track, analysis, half, lap).source).toBe('estimate')
    expect(measureProfile(track, analysis, new Float32Array(0), lap).source).toBe('estimate')
  })
})

describe('grid', () => {
  it('has twenty drivers, two per team, with unique codes and numbers', () => {
    expect(TEAMS).toHaveLength(10)
    expect(DRIVERS).toHaveLength(20)
    expect(new Set(DRIVERS.map((d) => d.code)).size).toBe(20)
    expect(new Set(DRIVERS.map((d) => d.number)).size).toBe(20)
    for (let t = 0; t < 10; t++) expect(DRIVERS.filter((d) => d.team === t)).toHaveLength(2)
    // Teams are listed quickest first.
    for (let t = 1; t < 10; t++) expect(TEAMS[t].pace).toBeLessThan(TEAMS[t - 1].pace)
  })

  it('orders the grid by pace, reversed or shuffled', () => {
    const rng = createRng(4)
    const random = () => nextFloat(rng)
    expect(gridOrder(6, 'pace', random)).toEqual([0, 1, 2, 3, 4, 5])
    expect(gridOrder(6, 'reversed', random)).toEqual([5, 4, 3, 2, 1, 0])
    const mixed = gridOrder(12, 'mixed', random)
    expect([...mixed].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect(mixed).not.toEqual(Array.from({ length: 12 }, (_, i) => i))
  })
})
