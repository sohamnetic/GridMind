import { describe, expect, it } from 'vitest'
import { DEFAULT_GA, nextGeneration, randomPopulation, rankByFitness } from '../src/core/ai/ga'
import { createLayout, createScratch, forward, squash } from '../src/core/ai/network'
import { castRay, RAY_RANGE, readSensors, SENSOR_COUNT } from '../src/core/ai/sensors'
import { CarStatus } from '../src/core/evolution/episode'
import { DEFAULT_TRAINER, DRIVER_LAYOUT, simulateDriver, Trainer } from '../src/core/evolution/trainer'
import { createRng } from '../src/core/math/rng'
import { createCar } from '../src/core/physics/car'
import { buildTrack, lateralOffset, locateGlobal } from '../src/core/track/build'
import { createPresets, roundedPolygon } from '../src/core/track/presets'
import { createTrack } from '../src/core/track/serialize'
import { trackKey } from '../src/state/driverLibrary'

const pinewood = () => buildTrack(createPresets()[0])!

function longStraight() {
  return buildTrack(
    createTrack(
      'Strip',
      roundedPolygon(
        [
          [-1500, -300],
          [1500, -300],
          [1500, 300],
          [-1500, 300],
        ],
        120,
      ),
    ),
  )!
}

describe('network', () => {
  it('counts weights including biases', () => {
    expect(createLayout([3, 4, 2]).weightCount).toBe((3 + 1) * 4 + (4 + 1) * 2)
    expect(DRIVER_LAYOUT.sizes[0]).toBe(SENSOR_COUNT)
    expect(DRIVER_LAYOUT.sizes[DRIVER_LAYOUT.sizes.length - 1]).toBe(2)
  })

  it('squashes like tanh: odd, bounded, monotonic and close', () => {
    let prev = -Infinity
    for (let x = -6; x <= 6; x += 0.05) {
      const y = squash(x)
      expect(y).toBeGreaterThanOrEqual(-1)
      expect(y).toBeLessThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(prev)
      expect(y).toBeCloseTo(-squash(-x), 12)
      expect(Math.abs(y - Math.tanh(x))).toBeLessThan(0.03)
      prev = y
    }
  })

  it('evaluates a hand-built network', () => {
    // 2 inputs -> 1 hidden neuron -> 1 output.
    const layout = createLayout([2, 1, 1])
    //            hidden: bias, w1, w2      output: bias, w
    const weights = new Float32Array([0.5, 1, -1, 0.25, 2])
    const out = new Float32Array(1)
    forward(layout, weights, 0, new Float32Array([0.4, 0.1]), createScratch(layout), out)
    const hidden = squash(0.5 + 0.4 - 0.1)
    expect(out[0]).toBeCloseTo(squash(0.25 + 2 * hidden), 6)
  })

  it('reads a network from an offset inside a population', () => {
    const layout = createLayout([3, 4, 2])
    const pop = randomPopulation(layout, 3, createRng(4))
    const input = new Float32Array([0.2, -0.5, 0.9])
    const scratch = createScratch(layout)
    const a = new Float32Array(2)
    const b = new Float32Array(2)
    forward(layout, pop, layout.weightCount, input, scratch, a)
    forward(layout, pop.slice(layout.weightCount, 2 * layout.weightCount), 0, input, scratch, b)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

describe('sensors', () => {
  it('sees a long way down a straight and symmetric edges from the centre', () => {
    const track = longStraight()
    const car = createCar(track, 400)
    const s = new Float32Array(SENSOR_COUNT)
    readSensors(car, track, s)
    const hw = track.def.width / 2

    expect(s[3]).toBeCloseTo(1, 5) // straight ahead: out of range
    for (const [l, r] of [
      [0, 6],
      [1, 5],
      [2, 4],
    ]) {
      expect(s[l]).toBeCloseTo(s[r], 1)
    }
    // The +-75 degree rays reach the edge after hw / sin(75).
    expect(s[0] * RAY_RANGE).toBeGreaterThan((hw / Math.sin((75 * Math.PI) / 180)) * 0.85)
    expect(s[0] * RAY_RANGE).toBeLessThan((hw / Math.sin((75 * Math.PI) / 180)) * 1.15)

    expect(s[7]).toBe(0) // speed
    expect(s[8]).toBeCloseTo(0, 2) // heading error
    expect(s[9]).toBeCloseTo(0, 2) // lateral offset
    expect(Math.abs(s[10])).toBeLessThan(0.05) // straight ahead: no curvature
  })

  it('reports which side of the road the car is on', () => {
    const track = longStraight()
    const s = new Float32Array(SENSOR_COUNT)
    const left = createCar(track, 400, 3)
    readSensors(left, track, s)
    expect(s[9]).toBeCloseTo(0.5, 1)
    expect(s[0]).toBeLessThan(s[6]) // left edge is nearer than the right edge

    const right = createCar(track, 400, -3)
    readSensors(right, track, s)
    expect(s[9]).toBeCloseTo(-0.5, 1)
    expect(s[0]).toBeGreaterThan(s[6])
  })

  it('anticipates an upcoming right-hand corner', () => {
    const track = pinewood()
    const s = new Float32Array(SENSOR_COUNT)
    // Find a spot on a straight with a clear right-hander 70-150 m ahead.
    let best = 0
    for (let i = 0; i < track.n; i += 5) {
      const car = createCar(track, i * track.step)
      readSensors(car, track, s)
      if (Math.abs(s[10]) < 0.1 && s[12] > best) best = s[12]
    }
    expect(best).toBeGreaterThan(0.2)
  })

  it('casts rays that agree with a brute-force march', () => {
    const track = pinewood()
    const rng = createRng(3)
    for (let k = 0; k < 40; k++) {
      const car = createCar(track, (k / 40) * track.length, (rng.state % 7) - 3)
      const angle = car.heading + ((k % 9) - 4) * 0.3
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      const fast = castRay(track, car.x, car.y, dx, dy, car.index)

      let slow = RAY_RANGE
      for (let d = 0.25; d < RAY_RANGE; d += 0.25) {
        const px = car.x + dx * d
        const py = car.y + dy * d
        const i = locateGlobal(track, px, py)
        if (Math.abs(lateralOffset(track, i, px, py)) > track.halfWidth[i]) {
          slow = d
          break
        }
      }
      // Global nearest-sample can pick a neighbouring piece of track where the
      // sensor deliberately follows its own, so only compare clear cases.
      if (slow < RAY_RANGE && fast < RAY_RANGE) expect(Math.abs(fast - slow)).toBeLessThan(3)
    }
  })
})

describe('genetic algorithm', () => {
  const layout = createLayout([3, 4, 2])
  const len = layout.weightCount

  it('ranks by fitness, best first', () => {
    expect(rankByFitness([1, 5, 3, 5])).toEqual([1, 3, 2, 0])
  })

  it('keeps the elites unchanged and the population size constant', () => {
    const size = 40
    const pop = randomPopulation(layout, size, createRng(1))
    const fitness = Array.from({ length: size }, (_, i) => (i * 37) % 41)
    const next = nextGeneration(layout, pop, fitness, createRng(2), DEFAULT_GA, 0.1)
    expect(next.length).toBe(pop.length)

    const order = rankByFitness(fitness)
    const elites = Math.round(size * DEFAULT_GA.eliteFraction)
    for (let e = 0; e < elites; e++) {
      const from = Array.from(pop.subarray(order[e] * len, order[e] * len + len))
      expect(Array.from(next.subarray(e * len, e * len + len))).toEqual(from)
    }
  })

  it('is deterministic for a given seed and varies with it', () => {
    const pop = randomPopulation(layout, 30, createRng(1))
    const fitness = Array.from({ length: 30 }, (_, i) => Math.sin(i) * 100)
    const a = nextGeneration(layout, pop, fitness, createRng(9), DEFAULT_GA, 0.1)
    const b = nextGeneration(layout, pop, fitness, createRng(9), DEFAULT_GA, 0.1)
    const c = nextGeneration(layout, pop, fitness, createRng(10), DEFAULT_GA, 0.1)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Array.from(a)).not.toEqual(Array.from(c))
  })

  it('breeds children that differ from their parents', () => {
    const pop = randomPopulation(layout, 30, createRng(1))
    const fitness = Array.from({ length: 30 }, (_, i) => i)
    const next = nextGeneration(layout, pop, fitness, createRng(5), DEFAULT_GA, 0.2)
    const parents = new Set<string>()
    for (let i = 0; i < 30; i++) parents.add(Array.from(pop.subarray(i * len, i * len + len)).join())
    let novel = 0
    for (let i = 0; i < 30; i++) {
      if (!parents.has(Array.from(next.subarray(i * len, i * len + len)).join())) novel++
    }
    expect(novel).toBeGreaterThan(20)
  })
})

describe('trainer', () => {
  const config = { ...DEFAULT_TRAINER, populationSize: 60, seed: 7 }

  it('is fully determined by the seed', () => {
    const run = () => {
      const trainer = new Trainer(pinewood(), config)
      return [trainer.runGeneration(), trainer.runGeneration(), trainer.runGeneration()]
    }
    expect(run()).toEqual(run())
  })

  it('gets further round the lap as generations pass', () => {
    const trainer = new Trainer(pinewood(), config)
    const first = trainer.runGeneration()
    let last = first
    let bestProgress = first.bestProgress
    for (let g = 1; g < 10; g++) {
      last = trainer.runGeneration()
      bestProgress = Math.max(bestProgress, last.bestProgress)
    }
    expect(last.generation).toBe(10)
    expect(trainer.generation).toBe(10)
    expect(bestProgress).toBeGreaterThan(first.bestProgress * 1.5)
    expect(last.bestFitness).toBeGreaterThan(first.bestFitness)
    expect(trainer.champion()).not.toBeNull()
  })

  it('retires every car with a reason', () => {
    const trainer = new Trainer(pinewood(), config)
    while (!trainer.step()) {
      // run the first generation to its end
    }
    const { status } = trainer.episode
    expect(Array.from(status).every((s) => s !== CarStatus.Running)).toBe(true)
    // Random networks mostly crash, stall or run out of time; none can finish two laps.
    expect(Array.from(status).some((s) => s === CarStatus.Finished)).toBe(false)
  })

  it('resumes from a snapshot with the same population', () => {
    const a = new Trainer(pinewood(), config)
    a.runGeneration()
    a.runGeneration()
    const snapshot = {
      population: a.population.slice(),
      generation: a.generation,
      recordLap: a.recordLap,
      recordGenome: a.recordGenome,
      timeLimit: a.timeLimit,
    }
    const b = new Trainer(pinewood(), config, snapshot)
    expect(b.generation).toBe(2)
    expect(Array.from(b.population)).toEqual(Array.from(snapshot.population))
    expect(b.runGeneration().generation).toBe(3)
  })

  it('ignores a snapshot of the wrong size', () => {
    const snapshot = {
      population: new Float32Array(10),
      generation: 50,
      recordLap: null,
      recordGenome: null,
    }
    const trainer = new Trainer(pinewood(), config, snapshot)
    expect(trainer.generation).toBe(0)
    expect(trainer.population.length).toBe(60 * DRIVER_LAYOUT.weightCount)
  })

  it('replays a single driver and records its path', () => {
    const track = pinewood()
    const trainer = new Trainer(track, config)
    trainer.runGeneration()
    const run = simulateDriver(track, trainer.champion()!, { record: true })
    expect(run.path.length % 3).toBe(0)
    expect(run.path.length).toBeGreaterThan(6)
    expect(run.status).not.toBe(CarStatus.Running)
    // No lap completed yet, so the "best lap" path is the whole run.
    expect(run.bestLap).toBeNull()
    expect(run.bestLapPath.length).toBe(run.path.length)
    // Same driver, same result.
    expect(simulateDriver(track, trainer.champion()!).progress).toBe(run.progress)
  })
})

describe('trackKey', () => {
  it('changes with the geometry but not with the name', () => {
    const def = createPresets()[0]
    const key = trackKey(def)
    expect(trackKey({ ...def, name: 'Renamed' })).toBe(key)
    expect(trackKey({ ...def, width: def.width + 1 })).not.toBe(key)
    const moved = { ...def, points: def.points.map((p, i) => (i === 0 ? { ...p, x: p.x + 5 } : p)) }
    expect(trackKey(moved)).not.toBe(key)
  })
})
