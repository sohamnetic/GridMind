import { describe, expect, it } from 'vitest'
import { randomPopulation } from '../src/core/ai/ga'
import { createLayout, createScratch, forward, widenInputs } from '../src/core/ai/network'
import { SENSOR_COUNT } from '../src/core/ai/sensors'
import { RACE_SENSOR_COUNT, readTrafficSensors, TRAFFIC_SENSOR_COUNT } from '../src/core/ai/trafficSensors'
import { CarStatus } from '../src/core/evolution/episode'
import { RACE_LAYOUT, RaceSim } from '../src/core/evolution/raceSim'
import { DRIVER_LAYOUT } from '../src/core/evolution/trainer'
import {
  DEFAULT_TRAFFIC,
  handicappedCar,
  qualify,
  TrafficTrainer,
  widenPopulation,
} from '../src/core/evolution/trafficTrainer'
import { createRng } from '../src/core/math/rng'
import { createCar, DEFAULT_CAR, type CarInput } from '../src/core/physics/car'
import {
  CONTACT_LENGTH,
  createTrafficState,
  gapAlong,
  resolveContacts,
  updateAero,
} from '../src/core/physics/traffic'
import { buildTrack } from '../src/core/track/build'
import { createPresets, roundedPolygon } from '../src/core/track/presets'
import { createTrack } from '../src/core/track/serialize'

function strip() {
  const def = createTrack(
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
  )
  def.drsZones = [{ start: 0.1, end: 0.3 }]
  return buildTrack(def)!
}

const idle = (): CarInput => ({ steer: 0, throttle: 0, brake: 0 })
const both = new Uint8Array([1, 1])

describe('slipstream and DRS', () => {
  it('gives a tow to a car close behind and in line, and none otherwise', () => {
    const track = strip()
    const state = createTrafficState(2)
    const inputs = [idle(), idle()]
    const lead = createCar(track, 500)
    const follower = createCar(track, 480)
    follower.speed = lead.speed = 60

    updateAero([lead, follower], inputs, both, track, state, false)
    expect(state.drag[0]).toBe(1)
    expect(state.drag[1]).toBeLessThan(0.85)
    expect(state.drag[1]).toBeGreaterThan(0.7)

    const far = createCar(track, 400)
    const s1 = createTrafficState(2)
    updateAero([lead, far], inputs, both, track, s1, false)
    expect(s1.drag[1]).toBe(1)

    const offset = createCar(track, 480, 4)
    const s2 = createTrafficState(2)
    updateAero([lead, offset], inputs, both, track, s2, false)
    expect(s2.drag[1]).toBe(1)
  })

  it('opens DRS only inside a zone, when enabled and within a second of the car ahead', () => {
    const track = strip()
    const inZone = 0.2 * track.length
    const make = (gap: number) => {
      const lead = createCar(track, inZone + gap)
      const chaser = createCar(track, inZone)
      lead.speed = chaser.speed = 70
      return [lead, chaser]
    }
    const inputs = [idle(), idle()]

    const close = createTrafficState(2)
    updateAero(make(40), inputs, both, track, close, true)
    expect(close.drs[1]).toBe(1)
    expect(close.drs[0]).toBe(0)

    const disabled = createTrafficState(2)
    updateAero(make(40), inputs, both, track, disabled, false)
    expect(disabled.drs[1]).toBe(0)

    const tooFar = createTrafficState(2)
    updateAero(make(120), inputs, both, track, tooFar, true)
    expect(tooFar.drs[1]).toBe(0)

    // Braking closes the flap.
    const cars = make(40)
    updateAero(cars, [idle(), { steer: 0, throttle: 0, brake: 1 }], both, track, close, true)
    expect(close.drs[1]).toBe(0)
  })
})

describe('contact', () => {
  it('blames and slows the car behind in a nose-to-tail hit, and counts it once', () => {
    const track = strip()
    const state = createTrafficState(2)
    const front = createCar(track, 500)
    const rear = createCar(track, 500 - CONTACT_LENGTH + 0.5)
    front.speed = 40
    rear.speed = 60

    expect(resolveContacts([front, rear], both, track, state, 1 / 60)).toBe(1)
    expect(rear.speed).toBeLessThan(front.speed)
    expect(front.speed).toBeGreaterThan(40)
    expect(state.fault[1]).toBeGreaterThan(state.fault[0])
    expect(state.fault[0]).toBe(0)
    expect(Math.abs(gapAlong(track, rear, front))).toBeGreaterThanOrEqual(CONTACT_LENGTH)

    // Touching again a moment later is the same incident.
    rear.s += 1
    rear.x += track.tx[rear.index]
    expect(resolveContacts([front, rear], both, track, state, 1 / 60)).toBe(0)
    expect(state.hits[0]).toBe(1)
    expect(state.hits[1]).toBe(1)
    expect(state.contactTime[1]).toBeCloseTo(2 / 60, 5)
  })

  it('pushes side-by-side cars apart and shares the blame', () => {
    const track = strip()
    const state = createTrafficState(2)
    const a = createCar(track, 500, 0.5)
    const b = createCar(track, 500, -0.5)
    a.speed = b.speed = 50
    resolveContacts([a, b], both, track, state, 1 / 60)
    expect(a.lateral - b.lateral).toBeGreaterThan(1.9)
    expect(state.fault[0]).toBe(state.fault[1])
    expect(a.speed).toBeLessThan(50)
  })

  it('ignores cars that are not racing', () => {
    const track = strip()
    const state = createTrafficState(2)
    const a = createCar(track, 500)
    const b = createCar(track, 501)
    expect(resolveContacts([a, b], new Uint8Array([1, 0]), track, state, 1 / 60)).toBe(0)
  })
})

describe('traffic sensors', () => {
  it('read zero on an empty road', () => {
    const track = strip()
    const out = new Float32Array(RACE_SENSOR_COUNT).fill(9)
    readTrafficSensors(0, [createCar(track, 500)], new Uint8Array([1]), track, out, SENSOR_COUNT)
    expect(Array.from(out.subarray(SENSOR_COUNT))).toEqual(new Array(TRAFFIC_SENSOR_COUNT).fill(0))
  })

  it('see a car ahead, how fast it is being caught, and a car behind', () => {
    const track = strip()
    const me = createCar(track, 500)
    const ahead = createCar(track, 520)
    const behind = createCar(track, 490, 2)
    me.speed = 60
    ahead.speed = 45
    const out = new Float32Array(RACE_SENSOR_COUNT)
    readTrafficSensors(0, [me, ahead, behind], new Uint8Array([1, 1, 1]), track, out, SENSOR_COUNT)
    const t = out.subarray(SENSOR_COUNT)
    expect(t[2]).toBeGreaterThan(0.6) // straight-ahead ray
    expect(t[0]).toBe(0) // nothing 45 degrees to the left
    expect(t[5]).toBeCloseTo(0.5, 2) // closing at 15 m/s
    expect(t[6]).toBeCloseTo(1 - 10 / 30, 2) // car 10 m behind
    expect(t[7]).toBeGreaterThan(0) // ...and to the left
  })
})

describe('widening a network', () => {
  it('leaves its behaviour unchanged when the new inputs are zero', () => {
    const wide = createLayout([DRIVER_LAYOUT.sizes[0] + 4, 12, 8, 2])
    const pop = randomPopulation(DRIVER_LAYOUT, 2, createRng(3))
    const widened = new Float32Array(2 * wide.weightCount)
    for (let i = 0; i < 2; i++) {
      widenInputs(DRIVER_LAYOUT, wide, pop, i * DRIVER_LAYOUT.weightCount, widened, i * wide.weightCount)
    }
    const narrowIn = Float32Array.from({ length: DRIVER_LAYOUT.sizes[0] }, (_, i) => Math.sin(i))
    const wideIn = new Float32Array(wide.sizes[0])
    wideIn.set(narrowIn)
    const a = new Float32Array(2)
    const b = new Float32Array(2)
    forward(DRIVER_LAYOUT, pop, DRIVER_LAYOUT.weightCount, narrowIn, createScratch(DRIVER_LAYOUT), a)
    forward(wide, widened, wide.weightCount, wideIn, createScratch(wide), b)
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('converts a whole population to the race layout', () => {
    const pop = randomPopulation(DRIVER_LAYOUT, 5, createRng(1))
    expect(widenPopulation(DRIVER_LAYOUT, pop).length).toBe(5 * RACE_LAYOUT.weightCount)
  })
})

describe('race simulation', () => {
  const track = () => buildTrack(createPresets()[0])!
  const field = (count: number, seed = 2) => ({
    genomes: randomPopulation(RACE_LAYOUT, count, createRng(seed)),
    params: Array.from({ length: count }, () => DEFAULT_CAR),
  })

  it('lines the cars up in grid order behind the line', () => {
    const t = track()
    const race = new RaceSim(t, RACE_LAYOUT, 6)
    const { genomes, params } = field(6)
    race.reset(genomes, params, 2, 60, [3, 1, 5, 0, 2, 4])
    expect(Array.from(race.order)).toEqual([3, 1, 5, 0, 2, 4])
    expect(race.gridSlot[3]).toBe(0)
    expect(race.gridSlot[4]).toBe(5)
    // Pole is nearest the line; each slot is further back and on alternate sides.
    expect(race.raceDist[3]).toBeGreaterThan(race.raceDist[1])
    expect(Math.sign(race.cars[3].lateral)).toBe(-Math.sign(race.cars[1].lateral))
    for (let i = 0; i < 6; i++) expect(race.raceDist[i]).toBeLessThan(0)
  })

  it('runs to completion, classifies every car and is deterministic', () => {
    const run = () => {
      const race = new RaceSim(track(), RACE_LAYOUT, 8)
      const { genomes, params } = field(8)
      race.reset(genomes, params, 1, 40)
      let steps = 0
      while (!race.step()) steps++
      return { steps, status: Array.from(race.status), order: Array.from(race.order), dist: Array.from(race.raceDist) }
    }
    const a = run()
    expect(a.status.every((s) => s !== CarStatus.Running)).toBe(true)
    expect([...a.order].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(run()).toEqual(a)
  })

  it('handicaps only the engine', () => {
    const slow = handicappedCar(0.9)
    expect(slow.power).toBeCloseTo(DEFAULT_CAR.power * 0.9)
    expect(slow.tyreMu).toBe(DEFAULT_CAR.tyreMu)
  })
})

describe('traffic trainer', () => {
  const config = { ...DEFAULT_TRAFFIC, populationSize: 16, heatsPerCar: 1, laps: 1, seed: 5 }
  const seedPop = () => randomPopulation(RACE_LAYOUT, 16, createRng(8))
  const track = () => buildTrack(createPresets()[0])!

  it('rejects a population that does not fill whole heats', () => {
    expect(() => new TrafficTrainer(track(), seedPop(), { ...config, populationSize: 12 })).toThrow(/multiple/)
  })

  it('runs generations with sane, reproducible statistics', () => {
    const run = () => {
      const trainer = new TrafficTrainer(track(), seedPop(), config)
      return [trainer.runGeneration(), trainer.runGeneration()]
    }
    const [first, second] = run()
    expect(first.generation).toBe(1)
    expect(second.generation).toBe(2)
    expect(first.entries).toBe(16)
    expect(first.bestFitness).toBeGreaterThanOrEqual(first.meanFitness)
    expect(first.contacts).toBeGreaterThanOrEqual(0)
    expect(run()).toEqual([first, second])
  })

  it('fills the population from fewer seed drivers', () => {
    const few = randomPopulation(RACE_LAYOUT, 3, createRng(1))
    const trainer = new TrafficTrainer(track(), few, config)
    const len = RACE_LAYOUT.weightCount
    expect(trainer.population.length).toBe(16 * len)
    // The first three are the seeds, untouched.
    expect(Array.from(trainer.population.subarray(0, 3 * len))).toEqual(Array.from(few))
  })

  it('qualifies the requested number of drivers', () => {
    const trainer = new TrafficTrainer(track(), seedPop(), config)
    trainer.runGeneration()
    const result = qualify(track(), trainer.ranked, 10, { rounds: 2, laps: 1 })
    expect(result.genomes.length).toBe(10 * RACE_LAYOUT.weightCount)
    expect(result.retirements).toHaveLength(10)
    // Most dependable first.
    for (let i = 1; i < 10; i++) expect(result.retirements[i]).toBeGreaterThanOrEqual(result.retirements[i - 1])
  })
})
