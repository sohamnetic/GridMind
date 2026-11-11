import { describe, expect, it } from 'vitest'
import {
  createCar,
  DEFAULT_CAR,
  gripLimit,
  stepCar,
  topSpeed,
  type CarInput,
} from '../src/core/physics/car'
import { createLapTimer, formatLapTime, updateLapTimer } from '../src/core/physics/lapTimer'
import { maxCornerSpeed, referenceDriver } from '../src/core/physics/referenceDriver'
import { buildTrack } from '../src/core/track/build'
import { createPresets, roundedPolygon } from '../src/core/track/presets'
import { createTrack } from '../src/core/track/serialize'
import { Surface, type BuiltTrack } from '../src/core/track/types'

const DT = 1 / 120

function longStraightTrack(): BuiltTrack {
  const def = createTrack(
    'Drag strip',
    roundedPolygon(
      [
        [-2500, -300],
        [2500, -300],
        [2500, 300],
        [-2500, 300],
      ],
      120,
    ),
  )
  return buildTrack(def)!
}

describe('car physics', () => {
  it('has a plausible top speed', () => {
    const v = topSpeed(DEFAULT_CAR)
    expect(v * 3.6).toBeGreaterThan(310)
    expect(v * 3.6).toBeLessThan(360)
  })

  it('accelerates like a single-seater and approaches top speed', () => {
    const track = longStraightTrack()
    const car = createCar(track, 200)
    const input: CarInput = { steer: 0, throttle: 1, brake: 0 }
    let t100 = 0
    let t200 = 0
    while (car.time < 30 && car.progress < 4000 && !car.crashed) {
      stepCar(car, input, track, DEFAULT_CAR, DT)
      if (!t100 && car.speed >= 100 / 3.6) t100 = car.time
      if (!t200 && car.speed >= 200 / 3.6) t200 = car.time
    }
    expect(t100).toBeGreaterThan(1.8)
    expect(t100).toBeLessThan(3.5)
    expect(t200).toBeGreaterThan(t100)
    expect(t200).toBeLessThan(7)
    expect(car.crashed).toBe(false)
    expect(car.speed).toBeGreaterThan(topSpeed(DEFAULT_CAR) * 0.97)
    expect(car.speed).toBeLessThanOrEqual(topSpeed(DEFAULT_CAR) * 1.001)
    expect(Math.abs(car.lateral)).toBeLessThan(0.5)
  })

  it('brakes hard from high speed, harder while downforce is high', () => {
    const track = longStraightTrack()
    const car = createCar(track, 200)
    car.speed = 85
    const start = car.progress
    let peak = 0
    let prev = car.speed
    while (car.speed > 0.1 && car.time < 10 && !car.crashed) {
      stepCar(car, { steer: 0, throttle: 0, brake: 1 }, track, DEFAULT_CAR, DT)
      peak = Math.max(peak, (prev - car.speed) / DT)
      prev = car.speed
    }
    const distance = car.progress - start
    expect(distance).toBeGreaterThan(60)
    expect(distance).toBeLessThan(160)
    expect(peak / 9.81).toBeGreaterThan(3.5) // well above 1 g mechanical grip
    expect(peak / 9.81).toBeLessThan(7)
  })

  it('has more grip at speed than at rest', () => {
    expect(gripLimit(DEFAULT_CAR, 80)).toBeGreaterThan(gripLimit(DEFAULT_CAR, 0) * 2)
  })

  it('cannot corner tighter than the grip limit allows', () => {
    const track = longStraightTrack()
    const car = createCar(track, 200)
    car.speed = 60
    let prevHeading = car.heading
    let maxLat = 0
    for (let i = 0; i < 60; i++) {
      const v = car.speed
      stepCar(car, { steer: 1, throttle: 0.3, brake: 0 }, track, DEFAULT_CAR, DT)
      const yawRate = Math.abs(car.heading - prevHeading) / DT
      prevHeading = car.heading
      maxLat = Math.max(maxLat, yawRate * v)
      expect(yawRate * v).toBeLessThanOrEqual(gripLimit(DEFAULT_CAR, v) * 1.01)
    }
    expect(maxLat).toBeGreaterThan(gripLimit(DEFAULT_CAR, 55) * 0.8)
  })

  it('slows down on gravel and crashes at the wall', () => {
    const track = longStraightTrack()
    const hw = track.def.width / 2

    const gravelCar = createCar(track, 200, hw + track.def.kerbWidth + 3)
    gravelCar.surface = Surface.Gravel
    gravelCar.speed = 50
    const roadCar = createCar(track, 200)
    roadCar.speed = 50
    for (let i = 0; i < 120; i++) {
      stepCar(gravelCar, { steer: 0, throttle: 0, brake: 0 }, track, DEFAULT_CAR, DT)
      stepCar(roadCar, { steer: 0, throttle: 0, brake: 0 }, track, DEFAULT_CAR, DT)
    }
    expect(gravelCar.surface).toBe(Surface.Gravel)
    expect(gravelCar.speed).toBeLessThan(roadCar.speed - 5)

    const wallCar = createCar(track, 200)
    wallCar.speed = 40
    for (let i = 0; i < 1200 && !wallCar.crashed; i++) {
      stepCar(wallCar, { steer: -1, throttle: 0.5, brake: 0 }, track, DEFAULT_CAR, DT)
    }
    expect(wallCar.crashed).toBe(true)
    expect(wallCar.speed).toBe(0)
  })

  it('is deterministic', () => {
    const track = buildTrack(createPresets()[0])!
    const run = () => {
      const car = createCar(track, 0)
      const input: CarInput = { steer: 0, throttle: 0, brake: 0 }
      for (let i = 0; i < 2000; i++) {
        referenceDriver(car, track, DEFAULT_CAR, input)
        stepCar(car, input, track, DEFAULT_CAR, DT)
      }
      return [car.x, car.y, car.heading, car.speed]
    }
    expect(run()).toEqual(run())
  })
})

describe('reference driver and lap timing', () => {
  it('computes corner speed from curvature', () => {
    expect(maxCornerSpeed(DEFAULT_CAR, 0)).toBe(Infinity)
    const slow = maxCornerSpeed(DEFAULT_CAR, 1 / 20)
    const fast = maxCornerSpeed(DEFAULT_CAR, 1 / 120)
    expect(slow).toBeGreaterThan(15)
    expect(slow).toBeLessThan(25)
    expect(fast).toBeGreaterThan(slow * 2)
  })

  for (const def of createPresets()) {
    it(`laps ${def.name} cleanly with consistent sector times`, () => {
      const track = buildTrack(def)!
      const startS = def.startFraction * track.length
      const car = createCar(track, startS - 15)
      const timer = createLapTimer(track, car.s)
      const input: CarInput = { steer: 0, throttle: 0, brake: 0 }
      let offTrack = 0
      let steps = 0

      while (timer.laps < 2 && car.time < 400 && !car.crashed) {
        referenceDriver(car, track, DEFAULT_CAR, input)
        stepCar(car, input, track, DEFAULT_CAR, DT)
        updateLapTimer(timer, track, car.s, car.speed, car.time)
        if (car.surface >= Surface.Gravel) offTrack++
        steps++
      }

      expect(car.crashed).toBe(false)
      expect(timer.laps).toBe(2)
      expect(offTrack / steps).toBeLessThan(0.01)

      const lap = timer.lastLap!
      const sectors = timer.lastSectors!
      expect(sectors).toHaveLength(3)
      expect(sectors[0] + sectors[1] + sectors[2]).toBeCloseTo(lap, 6)
      // Flying lap average speed should look like a racing car, not a road car.
      const average = (track.length / lap) * 3.6
      expect(average).toBeGreaterThan(110)
      expect(average).toBeLessThan(340)
      expect(timer.bestLap).toBeLessThanOrEqual(lap)
    })
  }

  it('does not award a lap for reversing over the line', () => {
    const track = buildTrack(createPresets()[1])!
    const startS = track.def.startFraction * track.length
    const timer = createLapTimer(track, startS + 20)
    // Slide backwards over the line, then forwards again.
    updateLapTimer(timer, track, startS - 20, 10, 1)
    expect(timer.running).toBe(false)
    expect(updateLapTimer(timer, track, startS + 5, 10, 2)?.type).toBe('start')
    updateLapTimer(timer, track, startS - 5, 10, 3)
    const event = updateLapTimer(timer, track, startS + 5, 10, 4)
    expect(event?.type).toBe('start')
    expect(timer.laps).toBe(0)
  })

  it('formats lap times', () => {
    expect(formatLapTime(83.4567)).toBe('1:23.457')
    expect(formatLapTime(9.5)).toBe('9.500')
    expect(formatLapTime(null)).toBe('–')
  })
})
