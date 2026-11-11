import { DEFAULT_GA, nextGeneration, rankByFitness, type GaConfig } from '../ai/ga'
import { widenInputs, type NetworkLayout } from '../ai/network'
import { createRng, nextFloat, nextGaussian, nextInt, type Rng } from '../math/rng'
import { DEFAULT_CAR, type CarParams } from '../physics/car'
import type { BuiltTrack } from '../track/types'
import { CarStatus } from './episode'
import { RACE_LAYOUT, RaceSim } from './raceSim'

export interface TrafficConfig {
  /** Must be a multiple of heatSize. */
  populationSize: number
  heatSize: number
  /** Races each network runs per generation; more = less luck in its score. */
  heatsPerCar: number
  seed: number
  ga: GaConfig
  baseSigma: number
  laps: number
}

export const DEFAULT_TRAFFIC: TrafficConfig = {
  populationSize: 64,
  heatSize: 8,
  heatsPerCar: 2,
  seed: 1,
  ga: { ...DEFAULT_GA, immigrantFraction: 0 },
  baseSigma: 0.08,
  laps: 2,
}

export interface TrafficStats {
  generation: number
  bestFitness: number
  meanFitness: number
  /** Totals over every heat of the generation. */
  overtakes: number
  contacts: number
  crashed: number
  finished: number
  /** Cars entered across all heats, for turning the totals into rates. */
  entries: number
  bestLap: number | null
  sigma: number
}

export interface TrafficResume {
  population: Float32Array
  generation: number
}

/**
 * Pace handicap per grid slot, slowest on pole. Fast cars start behind slow
 * ones, so there is always someone to pass and someone to defend against.
 */
const HANDICAPS = [0.895, 0.91, 0.925, 0.94, 0.955, 0.97, 0.985, 1]

const OVERTAKE_REWARD = 60
const OVERTAKEN_PENALTY = 30
const FAULT_PENALTY = 150
const CONTACT_PENALTY = 100 // per second of contact
const GRAVEL_PENALTY = 15
const RETIRE_PENALTY = 150
const FINISH_BONUS = 50
/** Seconds the field gets to finish after a heat's winner. */
const HEAT_END_MARGIN = 12

/**
 * A car with its engine scaled by `factor` (1 = full pace). Only the engine is
 * handicapped: drivers learn their braking points for a given level of grip,
 * so a car with less grip than they trained on simply runs wide.
 */
export function handicappedCar(factor: number, base: CarParams = DEFAULT_CAR): CarParams {
  return { ...base, power: base.power * factor, maxDriveForce: base.maxDriveForce * factor }
}

/** Converts solo-trained networks to race networks (extra inputs start with zero weights). */
export function widenPopulation(from: NetworkLayout, population: Float32Array): Float32Array {
  const count = population.length / from.weightCount
  const out = new Float32Array(count * RACE_LAYOUT.weightCount)
  for (let i = 0; i < count; i++) {
    widenInputs(from, RACE_LAYOUT, population, i * from.weightCount, out, i * RACE_LAYOUT.weightCount)
  }
  return out
}

/**
 * Second stage of training: drivers that can already lap are raced against
 * each other in small heats and selected for clean, effective racing.
 */
export class TrafficTrainer {
  readonly layout = RACE_LAYOUT
  readonly heats: RaceSim[] = []
  population: Float32Array
  generation = 0
  readonly fitness: Float64Array
  /** Networks of the last completed generation, best first. */
  ranked: Float32Array
  readonly timeCap: number

  private readonly rng: Rng
  private readonly heatGenomes: Float32Array[] = []
  /** assignment[heat * heatSize + slot] = population index. */
  private readonly assignment: Int32Array
  private readonly heatParams: CarParams[]
  private stagnation = 0
  private bestSeen = -Infinity

  constructor(
    readonly track: BuiltTrack,
    seedPopulation: Float32Array,
    readonly config: TrafficConfig = DEFAULT_TRAFFIC,
    resume?: TrafficResume,
  ) {
    const { populationSize, heatSize, heatsPerCar } = config
    if (populationSize % heatSize !== 0) throw new Error('Population must be a multiple of the heat size')
    const len = this.layout.weightCount
    this.rng = createRng(config.seed)
    this.fitness = new Float64Array(populationSize)
    this.timeCap = (config.laps * track.length) / 20 + 20

    if (resume && resume.population.length === populationSize * len) {
      this.population = resume.population
      this.generation = resume.generation
      this.rng.state = (this.rng.state + Math.imul(resume.generation + 1, 0x9e3779b1)) >>> 0
    } else {
      this.population = this.seed(seedPopulation)
    }
    this.ranked = this.population.slice()

    const heatCount = (populationSize * heatsPerCar) / heatSize
    this.assignment = new Int32Array(heatCount * heatSize)
    this.heatParams = heatParams(heatSize)
    for (let h = 0; h < heatCount; h++) {
      this.heats.push(new RaceSim(track, this.layout, heatSize))
      this.heatGenomes.push(new Float32Array(heatSize * len))
    }
    this.startHeats()
  }

  /**
   * Builds the first population from whatever solo drivers are available:
   * as many of them as fit, best first, then lightly mutated copies.
   */
  private seed(source: Float32Array): Float32Array {
    const len = this.layout.weightCount
    const available = Math.floor(source.length / len)
    if (available < 1) throw new Error('Traffic training needs at least one trained driver')
    const size = this.config.populationSize
    const pop = new Float32Array(size * len)
    for (let i = 0; i < size; i++) {
      const from = (i % available) * len
      pop.set(source.subarray(from, from + len), i * len)
      if (i >= available) {
        for (let p = 0; p < len; p++) {
          if (nextFloat(this.rng) < 0.1) pop[i * len + p] += nextGaussian(this.rng, 0, this.config.baseSigma)
        }
      }
    }
    return pop
  }

  /** Shuffles the population into heats and puts every heat on the grid. */
  private startHeats(): void {
    const { populationSize, heatSize, heatsPerCar, laps } = this.config
    const len = this.layout.weightCount
    const order = new Int32Array(populationSize)
    for (let round = 0; round < heatsPerCar; round++) {
      for (let i = 0; i < populationSize; i++) order[i] = i
      for (let i = populationSize - 1; i > 0; i--) {
        const j = nextInt(this.rng, 0, i)
        const t = order[i]
        order[i] = order[j]
        order[j] = t
      }
      this.assignment.set(order, round * populationSize)
    }
    for (let h = 0; h < this.heats.length; h++) {
      const genomes = this.heatGenomes[h]
      for (let slot = 0; slot < heatSize; slot++) {
        const g = this.assignment[h * heatSize + slot] * len
        genomes.set(this.population.subarray(g, g + len), slot * len)
      }
      // Car k sits in grid slot k, so its handicap is heatParams[k].
      this.heats[h].reset(genomes, this.heatParams, laps, this.timeCap, undefined, HEAT_END_MARGIN)
    }
  }

  /** Advances every unfinished heat by one physics step; true when all are done. */
  step(): boolean {
    let done = true
    for (const heat of this.heats) {
      if (!heat.step()) done = false
    }
    return done
  }

  completeGeneration(): TrafficStats {
    const { populationSize, heatSize, heatsPerCar } = this.config
    const len = this.layout.weightCount
    this.fitness.fill(0)

    let overtakes = 0
    let hits = 0
    let crashed = 0
    let finished = 0
    let bestLap = Infinity
    for (let h = 0; h < this.heats.length; h++) {
      const heat = this.heats[h]
      for (let k = 0; k < heatSize; k++) {
        this.fitness[this.assignment[h * heatSize + k]] += heatScore(heat, k, this.timeCap) / heatsPerCar
        overtakes += heat.overtakes[k]
        hits += heat.traffic.hits[k]
        if (heat.status[k] === CarStatus.Crashed) crashed++
        if (heat.status[k] === CarStatus.Finished) finished++
        if (heat.bestLap[k] < bestLap) bestLap = heat.bestLap[k]
      }
    }

    const order = rankByFitness(this.fitness)
    const ranked = new Float32Array(this.population.length)
    let sum = 0
    for (let r = 0; r < populationSize; r++) {
      ranked.set(this.population.subarray(order[r] * len, order[r] * len + len), r * len)
      sum += this.fitness[order[r]]
    }
    this.ranked = ranked

    const best = this.fitness[order[0]]
    if (best > this.bestSeen + Math.abs(this.bestSeen) * 0.002 + 1) {
      this.bestSeen = best
      this.stagnation = 0
    } else {
      this.stagnation++
    }
    const sigma = this.config.baseSigma * (1 + 0.1 * Math.min(this.stagnation, 8))

    const stats: TrafficStats = {
      generation: this.generation + 1,
      bestFitness: best,
      meanFitness: sum / populationSize,
      overtakes,
      contacts: hits / 2, // each contact involves two cars
      crashed,
      finished,
      entries: this.heats.length * heatSize,
      bestLap: bestLap < Infinity ? bestLap : null,
      sigma,
    }

    this.population = nextGeneration(this.layout, this.population, this.fitness, this.rng, this.config.ga, sigma)
    this.generation++
    this.startHeats()
    return stats
  }

  runGeneration(): TrafficStats {
    while (!this.step()) {
      // keep stepping
    }
    return this.completeGeneration()
  }
}

/**
 * Score of car `k` in one heat: distance raced and time saved, plus credit
 * for passing, minus being passed, contact (weighted by blame), gravel and
 * retiring.
 */
export function heatScore(heat: RaceSim, k: number, timeCap: number): number {
  const status = heat.status[k]
  let f = heat.raceDist[k]
  // The time bonus is for completing the full distance, not for being flagged a lap down.
  if (status === CarStatus.Finished && heat.timers[k].laps >= heat.lapsTarget) {
    f += Math.max(0, timeCap - heat.finishTime[k]) * FINISH_BONUS
  }
  f += OVERTAKE_REWARD * heat.overtakes[k] - OVERTAKEN_PENALTY * heat.overtaken[k]
  f -= FAULT_PENALTY * heat.traffic.fault[k] + CONTACT_PENALTY * heat.traffic.contactTime[k]
  f -= GRAVEL_PENALTY * heat.gravelTime[k]
  if (status === CarStatus.Crashed || status === CarStatus.Stalled || status === CarStatus.Reversed) {
    f -= RETIRE_PENALTY
  }
  return f
}

function heatParams(heatSize: number): CarParams[] {
  return Array.from({ length: heatSize }, (_, slot) =>
    handicappedCar(HANDICAPS[Math.round((slot / Math.max(1, heatSize - 1)) * (HANDICAPS.length - 1))]),
  )
}

export interface QualifyingResult {
  /** The chosen networks, most dependable first. */
  genomes: Float32Array
  /** How many of each chosen network's qualifying races ended in retirement. */
  retirements: number[]
}

/**
 * Picks race drivers from a trained population.
 *
 * One generation's fitness comes from two races, so a fragile network can top
 * the table by luck. Here the leading candidates each run several more heats
 * from different grid slots, and the field is chosen on reliability first,
 * then on average score.
 *
 * @param ranked     race networks, best first (TrafficTrainer.ranked)
 * @param count      drivers wanted
 * @param rounds     heats each candidate runs
 */
export function qualify(
  track: BuiltTrack,
  ranked: Float32Array,
  count: number,
  { rounds = 6, heatSize = 8, laps = 2, seed = 1 } = {},
): QualifyingResult {
  const len = RACE_LAYOUT.weightCount
  const available = Math.floor(ranked.length / len)
  // Twice as many candidates as seats, rounded up to whole heats.
  const wanted = Math.min(available, Math.max(count * 2, heatSize))
  const candidates = Math.max(heatSize, Math.floor(wanted / heatSize) * heatSize)
  const rng = createRng(seed)
  const timeCap = (laps * track.length) / 20 + 20
  const params = heatParams(heatSize)
  const heats = Array.from({ length: candidates / heatSize }, () => new RaceSim(track, RACE_LAYOUT, heatSize))
  const genomes = heats.map(() => new Float32Array(heatSize * len))
  const score = new Float64Array(candidates)
  const retired = new Int32Array(candidates)
  const order = new Int32Array(candidates)

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < candidates; i++) order[i] = i
    for (let i = candidates - 1; i > 0; i--) {
      const j = nextInt(rng, 0, i)
      const t = order[i]
      order[i] = order[j]
      order[j] = t
    }
    for (let h = 0; h < heats.length; h++) {
      for (let slot = 0; slot < heatSize; slot++) {
        // Candidates beyond the population wrap round to the best ones.
        const g = (order[h * heatSize + slot] % available) * len
        genomes[h].set(ranked.subarray(g, g + len), slot * len)
      }
      heats[h].reset(genomes[h], params, laps, timeCap, undefined, HEAT_END_MARGIN)
      while (!heats[h].step()) {
        // run the heat
      }
      for (let slot = 0; slot < heatSize; slot++) {
        const c = order[h * heatSize + slot]
        score[c] += heatScore(heats[h], slot, timeCap) / rounds
        const st = heats[h].status[slot]
        if (st === CarStatus.Crashed || st === CarStatus.Stalled || st === CarStatus.Reversed) retired[c]++
      }
    }
  }

  const picked = Array.from({ length: candidates }, (_, i) => i)
  picked.sort((x, y) => retired[x] - retired[y] || score[y] - score[x] || x - y)
  const out = new Float32Array(count * len)
  const retirements: number[] = []
  for (let i = 0; i < count; i++) {
    const c = picked[i % candidates]
    out.set(ranked.subarray((c % available) * len, (c % available) * len + len), i * len)
    retirements.push(retired[c])
  }
  return { genomes: out, retirements }
}
