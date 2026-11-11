import { forward, createScratch, type NetworkLayout, type NetworkScratch } from '../ai/network'
import { readSensors, SENSOR_COUNT } from '../ai/sensors'
import { createCar, stepCar, type CarInput, type CarParams, type CarState } from '../physics/car'
import { createLapTimer, updateLapTimer, type LapTimer } from '../physics/lapTimer'
import { Surface, type BuiltTrack } from '../track/types'

/** Fixed physics step for all AI simulation (s). */
export const SIM_DT = 1 / 60
/** Drivers read their sensors and decide every this many physics steps (30 Hz). */
export const CONTROL_INTERVAL = 2
/** Cars start this far before the line, so the first crossing starts the clock. */
export const GRID_OFFSET = 15

export const CarStatus = {
  Running: 0,
  Crashed: 1,
  Stalled: 2,
  Reversed: 3,
  Finished: 4,
  TimedOut: 5,
} as const
export type CarStatus = (typeof CarStatus)[keyof typeof CarStatus]

/** A car that gains less than this much ground in STALL_TIME is retired. */
const STALL_DISTANCE = 4
const STALL_TIME = 3
const REVERSE_LIMIT = -8
/** Once a car finishes, the rest get this multiple of its time (plus 3 s) to finish too. */
const LEADER_MARGIN = 1.15

/**
 * One simultaneous run of N network-driven cars on a track, each alone on the
 * road (cars do not see or touch each other in this phase).
 */
export class Episode {
  readonly cars: CarState[] = []
  readonly timers: LapTimer[] = []
  readonly status: Uint8Array
  /** Seconds spent on gravel. */
  readonly gravelTime: Float32Array
  /** Clock time at which the car completed its last required lap, or -1. */
  readonly finishTime: Float32Array
  /** Fastest lap of this run, or Infinity. */
  readonly bestLap: Float64Array
  running = 0
  time = 0
  /** True when the run was ended early because the leader had already finished. */
  cutShort = false

  private genomes: Float32Array = new Float32Array(0)
  private timeLimit = 0
  private laps = 1
  private tick = 0
  private readonly inputs: CarInput[] = []
  private readonly stallMark: Float32Array
  private readonly stallClock: Float32Array
  private readonly sensors = new Float32Array(SENSOR_COUNT)
  private readonly output = new Float32Array(2)
  private readonly scratch: NetworkScratch

  constructor(
    readonly track: BuiltTrack,
    readonly layout: NetworkLayout,
    readonly params: CarParams,
    readonly count: number,
  ) {
    if (layout.sizes[0] !== SENSOR_COUNT) {
      throw new Error(`Network expects ${layout.sizes[0]} inputs but there are ${SENSOR_COUNT} sensors`)
    }
    this.status = new Uint8Array(count)
    this.gravelTime = new Float32Array(count)
    this.finishTime = new Float32Array(count)
    this.bestLap = new Float64Array(count)
    this.stallMark = new Float32Array(count)
    this.stallClock = new Float32Array(count)
    this.scratch = createScratch(layout)
    for (let i = 0; i < count; i++) this.inputs.push({ steer: 0, throttle: 0, brake: 0 })
  }

  /** Puts every car back on the grid with the given networks. */
  reset(genomes: Float32Array, timeLimit: number, laps: number): void {
    this.genomes = genomes
    this.timeLimit = timeLimit
    this.laps = laps
    this.time = 0
    this.tick = 0
    this.cutShort = false
    this.running = this.count
    const startS = this.track.def.startFraction * this.track.length - GRID_OFFSET
    for (let i = 0; i < this.count; i++) {
      this.cars[i] = createCar(this.track, startS)
      this.timers[i] = createLapTimer(this.track, this.cars[i].s)
      this.status[i] = CarStatus.Running
      this.gravelTime[i] = 0
      this.finishTime[i] = -1
      this.bestLap[i] = Infinity
      this.stallMark[i] = 0
      this.stallClock[i] = 0
      const input = this.inputs[i]
      input.steer = 0
      input.throttle = 0
      input.brake = 0
    }
  }

  /** Advances every running car by one physics step. Returns true when all have stopped. */
  step(): boolean {
    const { track, params, layout, cars, timers, status } = this
    const decide = this.tick % CONTROL_INTERVAL === 0
    this.tick++
    this.time += SIM_DT
    const outOfTime = this.time >= this.timeLimit

    for (let i = 0; i < this.count; i++) {
      if (status[i] !== CarStatus.Running) continue
      const car = cars[i]
      const input = this.inputs[i]

      if (decide) {
        readSensors(car, track, this.sensors)
        forward(layout, this.genomes, i * layout.weightCount, this.sensors, this.scratch, this.output)
        input.steer = this.output[0]
        // One output drives both pedals: positive = throttle, negative = brake.
        const pedal = this.output[1]
        input.throttle = pedal > 0 ? pedal : 0
        input.brake = pedal < 0 ? -pedal : 0
      }

      stepCar(car, input, track, params, SIM_DT)
      const event = updateLapTimer(timers[i], track, car.s, car.speed, car.time)
      if (car.surface >= Surface.Gravel) this.gravelTime[i] += SIM_DT

      let end: CarStatus = CarStatus.Running
      if (event?.type === 'lap' && event.time !== undefined) {
        if (event.time < this.bestLap[i]) this.bestLap[i] = event.time
        if (timers[i].laps >= this.laps) {
          this.finishTime[i] = car.time
          end = CarStatus.Finished
          // Nobody much slower than the first finisher can win this generation,
          // so stop simulating them soon after: this is most of the training time.
          const cutoff = car.time * LEADER_MARGIN + 3
          if (cutoff < this.timeLimit) {
            this.timeLimit = cutoff
            this.cutShort = true
          }
        }
      }
      if (end === CarStatus.Running) {
        if (car.crashed) end = CarStatus.Crashed
        else if (car.progress < REVERSE_LIMIT) end = CarStatus.Reversed
        else if (car.progress > this.stallMark[i] + STALL_DISTANCE) {
          this.stallMark[i] = car.progress
          this.stallClock[i] = 0
        } else {
          this.stallClock[i] += SIM_DT
          if (this.stallClock[i] > STALL_TIME) end = CarStatus.Stalled
        }
        if (end === CarStatus.Running && outOfTime) end = CarStatus.TimedOut
      }
      if (end !== CarStatus.Running) {
        status[i] = end
        this.running--
      }
    }
    return this.running === 0
  }
}
