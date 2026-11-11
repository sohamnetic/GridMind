/// <reference lib="webworker" />
import { CarStatus, SIM_DT } from '../core/evolution/episode'
import { RACE_LAYOUT, RaceSim } from '../core/evolution/raceSim'
import { DRIVER_LAYOUT } from '../core/evolution/trainer'
import {
  DEFAULT_TRAFFIC,
  handicappedCar,
  qualify,
  TrafficTrainer,
  widenPopulation,
} from '../core/evolution/trafficTrainer'
import { createRng, nextFloat } from '../core/math/rng'
import { DRIVERS, gridOrder, TEAMS } from '../core/race/grid'
import { buildTrack } from '../core/track/build'
import type { RaceMessage, RaceRequest, RaceTiming, TimingRow } from './raceProtocol'
import { FRAME_STRIDE, type TrainingSpeed } from './trainingProtocol'

/**
 * Worker for everything with several cars on track: racecraft training
 * (many small heats per generation) and single wheel-to-wheel races.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope

let trainer: TrafficTrainer | null = null
let race: RaceSim | null = null
let running = false
let speed: TrainingSpeed = 1
let framesEnabled = true
let timer: ReturnType<typeof setTimeout> | null = null
let lastTick = 0
let budget = 0
let lastFrame = 0
let lastTiming = 0
let eventsSent = 0

const SLICE_MS = 30

function post(message: RaceMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

function schedule(delay: number): void {
  if (timer === null) timer = setTimeout(loop, delay)
}

/** Advances whichever simulation is loaded by one physics step. */
function advance(): void {
  if (trainer) {
    if (trainer.step()) post({ type: 'generation', stats: trainer.completeGeneration() })
  } else if (race && race.step()) {
    running = false
    postTiming(race, true)
    postFrame()
  }
}

function loop(): void {
  timer = null
  if (!running || (!trainer && !race)) return
  const started = performance.now()

  if (speed === 'turbo') {
    while (running && performance.now() - started < SLICE_MS) advance()
  } else {
    budget += ((started - lastTick) / 1000) * speed
    budget = Math.min(budget, 0.25 * speed)
    while (running && budget >= SIM_DT && performance.now() - started < SLICE_MS) {
      advance()
      budget -= SIM_DT
    }
  }
  lastTick = started

  if (running) {
    const frameGap = speed === 'turbo' ? 100 : 33
    if (framesEnabled && started - lastFrame >= frameGap) {
      lastFrame = started
      postFrame()
    }
    if (race && started - lastTiming >= 250) {
      lastTiming = started
      postTiming(race, false)
    }
    schedule(speed === 'turbo' ? 0 : 8)
  }
}

function postFrame(): void {
  // During training only the first heat is shown; the others run unseen.
  const sim = trainer ? trainer.heats[0] : race
  if (!sim) return
  const count = sim.count
  const cars = new Float32Array(count * FRAME_STRIDE)
  for (let i = 0; i < count; i++) {
    const car = sim.cars[i]
    const o = i * FRAME_STRIDE
    cars[o] = car.x
    cars[o + 1] = car.y
    cars[o + 2] = car.heading
    cars[o + 3] = sim.status[i]
  }
  post(
    {
      type: 'frame',
      mode: trainer ? 'train' : 'race',
      generation: trainer ? trainer.generation + 1 : 0,
      time: sim.time,
      running: sim.running,
      leader: sim.order[0],
      cars,
    },
    [cars.buffer],
  )
}

function postTiming(sim: RaceSim, finished: boolean): void {
  const leader = sim.order[0]
  const leaderLaps = sim.timers[leader].laps
  const leaderDist = sim.raceDist[leader]
  const rows: TimingRow[] = []
  let overtakes = 0
  let hits = 0

  for (let p = 0; p < sim.count; p++) {
    const i = sim.order[p]
    const timerState = sim.timers[i]
    const status = sim.status[i]
    const retired =
      status === CarStatus.Crashed || status === CarStatus.Stalled || status === CarStatus.Reversed
    let gap: number | null = null
    let lapsDown = 0
    if (p > 0 && !retired) {
      if (sim.finishTime[i] >= 0 && sim.finishTime[leader] >= 0) {
        lapsDown = leaderLaps - timerState.laps
        if (lapsDown === 0) gap = sim.finishTime[i] - sim.finishTime[leader]
      } else {
        const behind = leaderDist - sim.raceDist[i]
        lapsDown = Math.floor(behind / sim.track.length)
        // On the same lap, the gap in time is the distance at this car's speed.
        if (lapsDown === 0) gap = behind / Math.max(sim.cars[i].speed, 20)
      }
    }
    rows.push({
      car: i,
      laps: timerState.laps,
      gap,
      lapsDown: Math.max(0, lapsDown),
      status,
      lastLap: timerState.lastLap,
      bestLap: sim.bestLap[i] < Infinity ? sim.bestLap[i] : null,
      overtakes: sim.overtakes[i],
      grid: sim.gridSlot[i],
      drs: sim.traffic.drs[i] === 1,
    })
    overtakes += sim.overtakes[i]
    hits += sim.traffic.hits[i]
  }

  const timing: RaceTiming = {
    time: sim.time,
    lap: Math.min(sim.lapsTarget, leaderLaps + 1),
    totalLaps: sim.lapsTarget,
    rows,
    events: sim.events.slice(eventsSent),
    finished,
    overtakes,
    contacts: hits / 2,
    fastestLap: sim.fastestLap < Infinity ? sim.fastestLap : null,
    fastestCar: sim.fastestCar,
  }
  eventsSent = sim.events.length
  post({ type: 'timing', timing })
}

scope.onmessage = (e: MessageEvent<RaceRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'train': {
        const track = buildTrack(msg.def)
        if (!track) throw new Error('The circuit could not be built.')
        race = null
        trainer = new TrafficTrainer(
          track,
          widenPopulation(DRIVER_LAYOUT, msg.solo),
          { ...DEFAULT_TRAFFIC, seed: msg.seed },
          msg.resume,
        )
        if (msg.resume) trainer.ranked = msg.resume.ranked
        running = false
        post({ type: 'ready', mode: 'train' })
        if (framesEnabled) postFrame()
        break
      }
      case 'race': {
        const track = buildTrack(msg.def)
        if (!track) throw new Error('The circuit could not be built.')
        const cars = Math.min(msg.cars, DRIVERS.length)
        trainer = null
        // Qualifying: choose the most dependable drivers for the grid.
        const field = qualify(track, msg.drivers, cars, { seed: msg.seed })
        const params = Array.from({ length: cars }, (_, i) => handicappedCar(TEAMS[DRIVERS[i].team].pace))
        const rng = createRng(msg.seed)
        const grid = gridOrder(cars, msg.grid, () => nextFloat(rng))
        race = new RaceSim(track, RACE_LAYOUT, cars)
        // Generous limits: a watched race should run to the flag, with lapped cars classified.
        race.reset(field.genomes, params, msg.laps, (msg.laps * track.length) / 12 + 60, grid, 120)
        eventsSent = 0
        running = false
        post({ type: 'ready', mode: 'race' })
        postFrame()
        postTiming(race, false)
        break
      }
      case 'run':
        speed = msg.speed
        if (!running && (trainer || (race && race.running > 0))) {
          running = true
          lastTick = performance.now()
          budget = 0
        }
        schedule(0)
        break
      case 'pause':
        running = false
        break
      case 'frames':
        framesEnabled = msg.enabled
        break
      case 'snapshot':
        if (trainer) {
          post({
            type: 'snapshot',
            snapshot: {
              population: trainer.population.slice(),
              ranked: trainer.ranked.slice(),
              generation: trainer.generation,
            },
          })
        }
        break
    }
  } catch (error) {
    running = false
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
