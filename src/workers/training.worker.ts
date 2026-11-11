/// <reference lib="webworker" />
import { SIM_DT } from '../core/evolution/episode'
import { DEFAULT_TRAINER, simulateDriver, Trainer } from '../core/evolution/trainer'
import { buildTrack } from '../core/track/build'
import {
  FRAME_STRIDE,
  type TrainingEvent,
  type TrainingRequest,
  type TrainingSpeed,
} from './trainingProtocol'

/**
 * Runs neuroevolution off the main thread so the interface never freezes.
 * The worker owns the Trainer; the page only receives car positions to draw
 * and one summary per generation.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope

let trainer: Trainer | null = null
let running = false
let speed: TrainingSpeed = 1
let framesEnabled = true
let timer: ReturnType<typeof setTimeout> | null = null
let lastTick = 0
let budget = 0
let lastFrame = 0

/** Longest the worker computes before yielding to its message queue (ms). */
const SLICE_MS = 30

function post(event: TrainingEvent, transfer: Transferable[] = []): void {
  scope.postMessage(event, transfer)
}

function schedule(delay: number): void {
  if (timer === null) timer = setTimeout(loop, delay)
}

function loop(): void {
  timer = null
  if (!trainer || !running) return
  const started = performance.now()

  if (speed === 'turbo') {
    while (performance.now() - started < SLICE_MS) advance(trainer)
  } else {
    // Real-time pacing: owe the simulation `speed` seconds per wall-clock second.
    budget += ((started - lastTick) / 1000) * speed
    budget = Math.min(budget, 0.25 * speed)
    while (budget >= SIM_DT && performance.now() - started < SLICE_MS) {
      advance(trainer)
      budget -= SIM_DT
    }
  }
  lastTick = started

  const frameGap = speed === 'turbo' ? 100 : 33
  if (framesEnabled && started - lastFrame >= frameGap) {
    lastFrame = started
    postFrame(trainer)
  }
  schedule(speed === 'turbo' ? 0 : 8)
}

function advance(t: Trainer): void {
  if (!t.step()) return
  const hadRecord = t.recordLap !== null
  const stats = t.completeGeneration()

  // Refresh the ghost line whenever the best driver changes. Before anyone
  // has completed a lap that is every generation, so the line visibly grows.
  let ghost: Float32Array | undefined
  if (stats.newRecord || !hadRecord) {
    const champion = t.champion()
    if (champion) {
      ghost = simulateDriver(t.track, champion, {
        laps: t.config.lapsPerEpisode,
        record: true,
      }).bestLapPath
    }
  }
  post({ type: 'generation', stats, ghost }, ghost ? [ghost.buffer] : [])
}

function postFrame(t: Trainer): void {
  const { episode } = t
  const count = episode.count
  const cars = new Float32Array(count * FRAME_STRIDE)
  let leader = 0
  let leaderProgress = -Infinity
  for (let i = 0; i < count; i++) {
    const car = episode.cars[i]
    const o = i * FRAME_STRIDE
    cars[o] = car.x
    cars[o + 1] = car.y
    cars[o + 2] = car.heading
    cars[o + 3] = episode.status[i]
    if (car.progress > leaderProgress) {
      leaderProgress = car.progress
      leader = i
    }
  }
  post(
    { type: 'frame', generation: t.generation + 1, time: episode.time, running: episode.running, leader, cars },
    [cars.buffer],
  )
}

scope.onmessage = (e: MessageEvent<TrainingRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'init': {
        const track = buildTrack(msg.def)
        if (!track) throw new Error('The circuit could not be built.')
        trainer = new Trainer(
          track,
          { ...DEFAULT_TRAINER, populationSize: msg.populationSize, seed: msg.seed },
          msg.resume,
        )
        running = false
        post({ type: 'ready' })
        if (framesEnabled) postFrame(trainer)
        break
      }
      case 'run':
        speed = msg.speed
        if (!running) {
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
              // Copies: the worker keeps training on its own arrays.
              population: trainer.population.slice(),
              generation: trainer.generation,
              recordLap: trainer.recordLap,
              recordGenome: trainer.recordGenome ? trainer.recordGenome.slice() : null,
              timeLimit: trainer.timeLimit,
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
