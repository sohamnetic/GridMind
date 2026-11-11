import { DEFAULT_GA, nextGeneration, randomPopulation, rankByFitness, type GaConfig } from '../ai/ga'
import { createLayout, type NetworkLayout } from '../ai/network'
import { SENSOR_COUNT } from '../ai/sensors'
import { createRng, type Rng } from '../math/rng'
import { DEFAULT_CAR, type CarParams } from '../physics/car'
import type { BuiltTrack } from '../track/types'
import { CarStatus, Episode, SIM_DT } from './episode'

/** Sensors -> two hidden layers -> steering and pedal. */
export const DRIVER_LAYOUT: NetworkLayout = createLayout([SENSOR_COUNT, 12, 8, 2])

export interface TrainerConfig {
  populationSize: number
  seed: number
  ga: GaConfig
  /** Spread of the mutation noise before stagnation boosts it. */
  baseSigma: number
  /** Laps a car must complete to finish: the first from the grid, the rest flying. */
  lapsPerEpisode: number
}

export const DEFAULT_TRAINER: TrainerConfig = {
  populationSize: 150,
  seed: 1,
  ga: DEFAULT_GA,
  baseSigma: 0.12,
  lapsPerEpisode: 2,
}

export interface GenerationStats {
  /** 1-based number of the generation that just finished. */
  generation: number
  bestFitness: number
  meanFitness: number
  /** Furthest any car got, in laps (1.0 = one full lap of progress). */
  bestProgress: number
  /** Fastest lap set in this generation, if any car completed one. */
  bestLap: number | null
  /** Fastest lap of the whole run so far. */
  recordLap: number | null
  /** True when this generation set a new record lap. */
  newRecord: boolean
  /** Cars that completed at least one lap. */
  finishers: number
  crashed: number
  timeLimit: number
  sigma: number
  /** Simulated seconds this generation took. */
  simTime: number
}

export interface TrainerResume {
  population: Float32Array
  generation: number
  recordLap: number | null
  recordGenome: Float32Array | null
  timeLimit?: number
}

const INITIAL_TIME_LIMIT = 15
const GRAVEL_PENALTY = 15 // metres of fitness per second on gravel
const CRASH_PENALTY = 20 // metres
const FINISH_BONUS = 50 // metres per second saved against the time cap

/**
 * Neuroevolution of driver networks on one track.
 *
 * Each generation runs the whole population at once, scores every car, and
 * breeds the next population. The run is fully determined by the seed.
 */
export class Trainer {
  readonly episode: Episode
  readonly layout = DRIVER_LAYOUT
  population: Float32Array
  /** Generations completed so far. */
  generation = 0
  timeLimit = INITIAL_TIME_LIMIT
  /** Longest an episode may ever last: time to finish at a crawl. */
  readonly timeCap: number
  recordLap: number | null = null
  /** Network that set the record lap. */
  recordGenome: Float32Array | null = null
  /** Fittest network of the most recently completed generation. */
  lastBest: Float32Array | null = null
  readonly fitness: Float64Array

  private readonly rng: Rng
  private stagnation = 0
  private bestFitnessSeen = -Infinity

  constructor(
    readonly track: BuiltTrack,
    readonly config: TrainerConfig = DEFAULT_TRAINER,
    resume?: TrainerResume,
    params: CarParams = DEFAULT_CAR,
  ) {
    const size = config.populationSize
    this.rng = createRng(config.seed)
    this.episode = new Episode(track, this.layout, params, size)
    this.fitness = new Float64Array(size)
    this.timeCap = (config.lapsPerEpisode * track.length) / 20 + 15

    if (resume && resume.population.length === size * this.layout.weightCount) {
      this.population = resume.population
      this.generation = resume.generation
      this.recordLap = resume.recordLap
      this.recordGenome = resume.recordGenome
      this.timeLimit = Math.min(this.timeCap, resume.timeLimit ?? this.timeCap)
      // Continue the random stream somewhere new rather than replaying generation 1.
      this.rng.state = (this.rng.state + Math.imul(resume.generation + 1, 0x9e3779b1)) >>> 0
    } else {
      this.population = randomPopulation(this.layout, size, this.rng)
    }
    this.episode.reset(this.population, this.timeLimit, config.lapsPerEpisode)
  }

  /** Advances the current generation by one physics step; true when it has finished. */
  step(): boolean {
    return this.episode.step()
  }

  /** Scores the finished generation, breeds the next one and puts it on the grid. */
  completeGeneration(): GenerationStats {
    const { episode, fitness, config, layout } = this
    const size = config.populationSize
    const len = layout.weightCount

    let sum = 0
    let bestLap = Infinity
    let bestLapCar = -1
    let finishers = 0
    let crashed = 0
    let timedOut = 0
    let bestProgress = 0
    for (let i = 0; i < size; i++) {
      const f = this.score(i)
      fitness[i] = f
      sum += f
      const status = episode.status[i]
      if (status === CarStatus.Crashed) crashed++
      if (status === CarStatus.TimedOut) timedOut++
      if (episode.bestLap[i] < Infinity) finishers++
      if (episode.bestLap[i] < bestLap) {
        bestLap = episode.bestLap[i]
        bestLapCar = i
      }
      bestProgress = Math.max(bestProgress, episode.cars[i].progress)
    }

    const order = rankByFitness(fitness)
    const top = order[0]
    this.lastBest = this.population.slice(top * len, top * len + len)

    let newRecord = false
    if (bestLapCar >= 0 && (this.recordLap === null || bestLap < this.recordLap)) {
      this.recordLap = bestLap
      this.recordGenome = this.population.slice(bestLapCar * len, bestLapCar * len + len)
      newRecord = true
    }

    // Mutate harder while progress stalls, gently while it is being made.
    if (fitness[top] > this.bestFitnessSeen * 1.001 + 0.5) {
      this.bestFitnessSeen = fitness[top]
      this.stagnation = 0
    } else {
      this.stagnation++
    }
    const sigma = config.baseSigma * (1 + 0.12 * Math.min(this.stagnation, 10))

    const stats: GenerationStats = {
      generation: this.generation + 1,
      bestFitness: fitness[top],
      meanFitness: sum / size,
      bestProgress: bestProgress / this.track.length,
      bestLap: bestLapCar >= 0 ? bestLap : null,
      recordLap: this.recordLap,
      newRecord,
      finishers,
      crashed,
      timeLimit: this.timeLimit,
      sigma,
      simTime: episode.time,
    }

    // Curriculum: give the cars more time only once some of them are using all of it.
    if (timedOut > 0 && !episode.cutShort) this.timeLimit = Math.min(this.timeCap, this.timeLimit * 1.5)

    this.population = nextGeneration(layout, this.population, fitness, this.rng, config.ga, sigma)
    this.generation++
    episode.reset(this.population, this.timeLimit, config.lapsPerEpisode)
    return stats
  }

  /** Runs one whole generation without yielding. */
  runGeneration(): GenerationStats {
    while (!this.step()) {
      // keep stepping
    }
    return this.completeGeneration()
  }

  /** The best driver so far: the record-lap network, or failing that the latest fittest. */
  champion(): Float32Array | null {
    return this.recordGenome ?? this.lastBest
  }

  /**
   * Fitness of car `i`: distance covered, minus penalties for gravel and
   * crashing, plus a bonus for every second a finisher saved. Time is only
   * rewarded through distance, so cars learn to survive before they learn to hurry.
   */
  private score(i: number): number {
    const { episode } = this
    let f = episode.cars[i].progress - GRAVEL_PENALTY * episode.gravelTime[i]
    if (episode.status[i] === CarStatus.Crashed) f -= CRASH_PENALTY
    if (episode.status[i] === CarStatus.Finished) {
      f += Math.max(0, this.timeCap - episode.finishTime[i]) * FINISH_BONUS
    }
    return f
  }
}

export interface DriverRun {
  /** Fastest lap, or null if no lap was completed. */
  bestLap: number | null
  lapsCompleted: number
  status: CarStatus
  /** Net distance covered (m). */
  progress: number
  /** Sampled trajectory as x, y, speed triplets (only when recording). */
  path: Float32Array
  /**
   * Trajectory of the fastest lap alone, or the whole run when no lap was
   * completed (only when recording).
   */
  bestLapPath: Float32Array
}

/**
 * Drives one network round the track on its own and reports what happened.
 * Used for the ghost racing line and, later, to measure a circuit's base pace.
 */
export function simulateDriver(
  track: BuiltTrack,
  genome: Float32Array,
  { laps = 2, maxTime = 0, record = false, params = DEFAULT_CAR } = {},
): DriverRun {
  const episode = new Episode(track, DRIVER_LAYOUT, params, 1)
  const limit = maxTime > 0 ? maxTime : (laps * track.length) / 20 + 15
  episode.reset(genome, limit, laps)

  const path: number[] = []
  const every = Math.round(0.1 / SIM_DT)
  const timer = episode.timers[0]
  // Path offsets at which each timed lap began, and the time each one took.
  const lapStarts: number[] = []
  const lapTimes: number[] = []
  let wasRunning = false
  let lapsSeen = 0
  let tick = 0
  let done = false
  while (!done) {
    if (record && tick % every === 0) {
      const car = episode.cars[0]
      path.push(car.x, car.y, car.speed)
    }
    done = episode.step()
    tick++
    if (timer.running && !wasRunning) {
      wasRunning = true
      lapStarts.push(path.length)
    }
    if (timer.laps > lapsSeen) {
      lapsSeen = timer.laps
      lapTimes.push(timer.lastLap ?? Infinity)
      lapStarts.push(path.length)
    }
  }
  const car = episode.cars[0]
  if (record) path.push(car.x, car.y, car.speed)

  const full = new Float32Array(path)
  let bestLapPath = full
  if (record && lapTimes.length > 0) {
    let best = 0
    for (let i = 1; i < lapTimes.length; i++) if (lapTimes[i] < lapTimes[best]) best = i
    // Include one extra sample so the drawn lap closes on itself.
    bestLapPath = full.slice(Math.max(0, lapStarts[best] - 3), Math.min(full.length, lapStarts[best + 1] + 3))
  }

  return {
    bestLap: episode.bestLap[0] < Infinity ? episode.bestLap[0] : null,
    lapsCompleted: timer.laps,
    status: episode.status[0] as CarStatus,
    progress: car.progress,
    path: full,
    bestLapPath,
  }
}
