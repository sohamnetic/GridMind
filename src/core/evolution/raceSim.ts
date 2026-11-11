import { createLayout, createScratch, forward, type NetworkLayout, type NetworkScratch } from '../ai/network'
import { readSensors, SENSOR_COUNT } from '../ai/sensors'
import { RACE_SENSOR_COUNT, readTrafficSensors } from '../ai/trafficSensors'
import { createCar, stepCar, type CarInput, type CarParams, type CarState } from '../physics/car'
import { createLapTimer, updateLapTimer, type LapTimer } from '../physics/lapTimer'
import {
  createTrafficState,
  resetTrafficState,
  resolveContacts,
  updateAero,
  type TrafficState,
} from '../physics/traffic'
import { Surface, type BuiltTrack } from '../track/types'
import { CarStatus, CONTROL_INTERVAL, SIM_DT } from './episode'

/** Solo sensors plus traffic sensors -> the same hidden layers -> steering and pedal. */
export const RACE_LAYOUT: NetworkLayout = createLayout([RACE_SENSOR_COUNT, 12, 8, 2])

/** Grid: two staggered columns, this far apart along the road per slot (m). */
const GRID_FIRST = 12
const GRID_SPACING = 8
const GRID_SIDE = 2.6

/** How often running order and overtakes are worked out (physics steps). */
const ORDER_INTERVAL = 15
/** A car must be this far past another before the pass counts (m). */
const PASS_MARGIN = 3

const STALL_DISTANCE = 4
const STALL_TIME = 4
const REVERSE_LIMIT = -8

export interface RaceEvent {
  time: number
  type: 'overtake' | 'out' | 'finish' | 'fastest'
  car: number
  /** Car that was passed, for overtakes. */
  other?: number
  /** Lap time, for fastest laps. */
  value?: number
}

/**
 * A wheel-to-wheel race: every car is driven by its own network, sees the
 * others, gets a tow behind them and loses time if it hits them.
 */
export class RaceSim {
  readonly cars: CarState[] = []
  readonly timers: LapTimer[] = []
  readonly inputs: CarInput[] = []
  readonly status: Uint8Array
  /** 1 while a car is on track and racing. */
  readonly active: Uint8Array
  readonly traffic: TrafficState
  /** Distance raced, measured so that every car's zero is the start line (m). */
  readonly raceDist: Float64Array
  readonly finishTime: Float32Array
  readonly bestLap: Float64Array
  readonly gravelTime: Float32Array
  readonly overtakes: Uint16Array
  readonly overtaken: Uint16Array
  /** Starting position of each car (0 = pole). */
  readonly gridSlot: Int16Array
  /** Car indices in running order, leader first. */
  readonly order: Int16Array
  /** Current position of each car (0 = leading). */
  readonly rank: Int16Array
  events: RaceEvent[] = []
  time = 0
  running = 0
  /** Fastest lap of the race so far and who set it. */
  fastestLap = Infinity
  fastestCar = -1

  private genomes: Float32Array = new Float32Array(0)
  private params: CarParams[] = []
  /** Laps the winner must complete. */
  lapsTarget = 1
  private timeLimit = 0
  private endMargin = 20
  private endTime = Infinity
  private tick = 0
  private leaderLaps = 0
  private readonly gridBack: Float32Array
  private readonly stallMark: Float32Array
  private readonly stallClock: Float32Array
  /** ahead[i * n + j] = 1 when car i is classified ahead of car j. */
  private readonly ahead: Uint8Array
  private readonly sensors = new Float32Array(RACE_SENSOR_COUNT)
  private readonly output = new Float32Array(2)
  private readonly scratch: NetworkScratch

  constructor(
    readonly track: BuiltTrack,
    readonly layout: NetworkLayout,
    readonly count: number,
  ) {
    if (layout.sizes[0] !== RACE_SENSOR_COUNT) {
      throw new Error(`Race network expects ${layout.sizes[0]} inputs but there are ${RACE_SENSOR_COUNT} sensors`)
    }
    this.status = new Uint8Array(count)
    this.active = new Uint8Array(count)
    this.traffic = createTrafficState(count)
    this.raceDist = new Float64Array(count)
    this.finishTime = new Float32Array(count)
    this.bestLap = new Float64Array(count)
    this.gravelTime = new Float32Array(count)
    this.overtakes = new Uint16Array(count)
    this.overtaken = new Uint16Array(count)
    this.gridSlot = new Int16Array(count)
    this.order = new Int16Array(count)
    this.rank = new Int16Array(count)
    this.gridBack = new Float32Array(count)
    this.stallMark = new Float32Array(count)
    this.stallClock = new Float32Array(count)
    this.ahead = new Uint8Array(count * count)
    this.scratch = createScratch(layout)
    for (let i = 0; i < count; i++) this.inputs.push({ steer: 0, throttle: 0, brake: 0 })
  }

  /**
   * Lines the cars up on the grid.
   *
   * @param genomes  one network per car, in car order
   * @param params   one set of car parameters per car (teams differ in pace)
   * @param grid     grid[slot] = car index; pole first. Defaults to car order.
   * @param endMargin seconds the rest of the field gets after the winner finishes
   */
  reset(
    genomes: Float32Array,
    params: CarParams[],
    laps: number,
    timeLimit: number,
    grid?: ArrayLike<number>,
    endMargin = 20,
  ): void {
    const { track, count } = this
    this.genomes = genomes
    this.params = params
    this.lapsTarget = laps
    this.timeLimit = timeLimit
    this.endMargin = endMargin
    this.endTime = Infinity
    this.time = 0
    this.tick = 0
    this.leaderLaps = 0
    this.running = count
    this.events = []
    this.fastestLap = Infinity
    this.fastestCar = -1
    resetTrafficState(this.traffic)

    const startS = track.def.startFraction * track.length
    for (let slot = 0; slot < count; slot++) {
      const i = grid ? grid[slot] : slot
      const back = GRID_FIRST + GRID_SPACING * slot
      const side = Math.min(GRID_SIDE, track.halfWidth[track.startIndex] - 1.6) * (slot % 2 === 0 ? 1 : -1)
      this.cars[i] = createCar(track, startS - back, side)
      this.timers[i] = createLapTimer(track, this.cars[i].s)
      this.gridSlot[i] = slot
      this.gridBack[i] = back
      this.order[slot] = i
      this.rank[i] = slot
    }
    for (let i = 0; i < count; i++) {
      this.status[i] = CarStatus.Running
      this.active[i] = 1
      this.raceDist[i] = -this.gridBack[i]
      this.finishTime[i] = -1
      this.bestLap[i] = Infinity
      this.gravelTime[i] = 0
      this.overtakes[i] = 0
      this.overtaken[i] = 0
      this.stallMark[i] = 0
      this.stallClock[i] = 0
      const input = this.inputs[i]
      input.steer = 0
      input.throttle = 0
      input.brake = 0
      for (let j = 0; j < count; j++) {
        this.ahead[i * count + j] = this.gridSlot[i] < this.gridSlot[j] ? 1 : 0
      }
    }
  }

  /** Advances the race by one physics step. Returns true when it is over. */
  step(): boolean {
    if (this.running === 0) return true
    const { track, layout, cars, timers, status, active, count, inputs } = this
    const decide = this.tick % CONTROL_INTERVAL === 0
    this.tick++
    this.time += SIM_DT

    if (decide) {
      for (let i = 0; i < count; i++) {
        if (!active[i]) continue
        readSensors(cars[i], track, this.sensors)
        readTrafficSensors(i, cars, active, track, this.sensors, SENSOR_COUNT)
        forward(layout, this.genomes, i * layout.weightCount, this.sensors, this.scratch, this.output)
        const input = inputs[i]
        input.steer = this.output[0]
        const pedal = this.output[1]
        input.throttle = pedal > 0 ? pedal : 0
        input.brake = pedal < 0 ? -pedal : 0
      }
    }

    // DRS stays shut until the leader has completed the opening lap.
    updateAero(cars, inputs, active, track, this.traffic, this.leaderLaps >= 1)
    for (let i = 0; i < count; i++) {
      if (active[i]) stepCar(cars[i], inputs[i], track, this.params[i], SIM_DT, 1, this.traffic.drag[i])
    }
    resolveContacts(cars, active, track, this.traffic, SIM_DT)

    const outOfTime = this.time >= this.timeLimit || this.time >= this.endTime
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue
      const car = cars[i]
      this.raceDist[i] = car.progress - this.gridBack[i]
      if (car.surface >= Surface.Gravel) this.gravelTime[i] += SIM_DT

      const event = updateLapTimer(timers[i], track, car.s, car.speed, car.time)
      let end: CarStatus = CarStatus.Running
      if (event?.type === 'lap' && event.time !== undefined) {
        if (event.time < this.bestLap[i]) this.bestLap[i] = event.time
        if (event.time < this.fastestLap) {
          this.fastestLap = event.time
          this.fastestCar = i
          this.log({ time: this.time, type: 'fastest', car: i, value: event.time })
        }
        if (timers[i].laps > this.leaderLaps) this.leaderLaps = timers[i].laps
        // The winner ends the race; everyone else is flagged the next time they
        // cross the line, however many laps they have done.
        if (timers[i].laps >= this.lapsTarget || this.endTime !== Infinity) {
          end = CarStatus.Finished
          this.finishTime[i] = car.time
          this.log({ time: this.time, type: 'finish', car: i })
          if (this.endTime === Infinity) this.endTime = this.time + this.endMargin
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
        active[i] = 0
        this.running--
        if (end === CarStatus.Crashed || end === CarStatus.Stalled || end === CarStatus.Reversed) {
          this.log({ time: this.time, type: 'out', car: i })
        }
      }
    }

    if (this.tick % ORDER_INTERVAL === 0 || this.running === 0) this.updateOrder()
    return this.running === 0
  }

  /** Distance a car is classified at: whole laps once it has taken the flag. */
  private classifiedDist(i: number): number {
    return this.finishTime[i] >= 0 ? this.timers[i].laps * this.track.length : this.raceDist[i]
  }

  /** True when car `a` is classified ahead of car `b`. */
  private leads(a: number, b: number): boolean {
    const da = this.classifiedDist(a)
    const db = this.classifiedDist(b)
    const fa = this.finishTime[a]
    const fb = this.finishTime[b]
    if (fa >= 0 && fb >= 0) return da !== db ? da > db : fa < fb
    // A flagged car keeps its place against anyone who has not covered more ground.
    if (fa >= 0) return da >= db
    if (fb >= 0) return da > db
    return da > db
  }

  private updateOrder(): void {
    const { count, ahead, status, cars } = this

    // Overtakes: a pass counts once the passer is clearly ahead of a car that
    // is still racing on the road (passing a car in the gravel is not a move).
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if (i === j || !ahead[i * count + j]) continue
        const jPassed =
          this.finishTime[i] < 0 && this.finishTime[j] < 0
            ? this.raceDist[j] - this.raceDist[i] > PASS_MARGIN
            : this.leads(j, i)
        if (!jPassed) continue
        ahead[i * count + j] = 0
        ahead[j * count + i] = 1
        const fair =
          status[i] === CarStatus.Running &&
          (status[j] === CarStatus.Running || status[j] === CarStatus.Finished) &&
          cars[i].surface <= Surface.Kerb
        if (fair) {
          this.overtakes[j]++
          this.overtaken[i]++
          this.log({ time: this.time, type: 'overtake', car: j, other: i })
        }
      }
    }

    // Running order: finishers by time, then everyone else by distance.
    const order = Array.from(this.order)
    order.sort((a, b) => (this.leads(a, b) ? -1 : this.leads(b, a) ? 1 : a - b))
    for (let p = 0; p < count; p++) {
      this.order[p] = order[p]
      this.rank[order[p]] = p
    }
  }

  private log(event: RaceEvent): void {
    this.events.push(event)
    if (this.events.length > 400) this.events.splice(0, 100)
  }
}
