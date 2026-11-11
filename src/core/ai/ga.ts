import { nextBool, nextFloat, nextGaussian, nextInt, type Rng } from '../math/rng'
import type { NetworkLayout } from './network'

export interface GaConfig {
  /** Share of the population copied unchanged into the next generation. */
  eliteFraction: number
  /** Candidates drawn per parent; larger = stronger selection pressure. */
  tournamentSize: number
  /** Probability that a child mixes two parents rather than cloning one. */
  crossoverRate: number
  /** Probability that each weight is perturbed. */
  mutationRate: number
  /** Share of the population replaced by brand-new random networks. */
  immigrantFraction: number
}

export const DEFAULT_GA: GaConfig = {
  eliteFraction: 0.05,
  tournamentSize: 4,
  crossoverRate: 0.6,
  mutationRate: 0.12,
  immigrantFraction: 0.03,
}

/** Fills one genome with random weights scaled to each layer's fan-in. */
export function randomGenome(layout: NetworkLayout, rng: Rng, out: Float32Array, offset: number): void {
  let p = offset
  for (let l = 0; l < layout.sizes.length - 1; l++) {
    const nIn = layout.sizes[l]
    const nOut = layout.sizes[l + 1]
    const scale = 1 / Math.sqrt(nIn)
    for (let j = 0; j < nOut; j++) {
      out[p++] = nextGaussian(rng, 0, 0.3)
      for (let i = 0; i < nIn; i++) out[p++] = nextGaussian(rng, 0, scale)
    }
  }
}

export function randomPopulation(layout: NetworkLayout, size: number, rng: Rng): Float32Array {
  const pop = new Float32Array(size * layout.weightCount)
  for (let i = 0; i < size; i++) randomGenome(layout, rng, pop, i * layout.weightCount)
  return pop
}

/** Indices of the population sorted from fittest to least fit. */
export function rankByFitness(fitness: ArrayLike<number>): number[] {
  const order = Array.from({ length: fitness.length }, (_, i) => i)
  order.sort((a, b) => fitness[b] - fitness[a] || a - b)
  return order
}

/**
 * Breeds the next generation.
 *
 * Elites survive untouched, a few slots go to fresh random networks to keep
 * diversity, and the rest are children of tournament-selected parents, mixed
 * neuron by neuron and then mutated with Gaussian noise of spread `sigma`.
 */
export function nextGeneration(
  layout: NetworkLayout,
  population: Float32Array,
  fitness: ArrayLike<number>,
  rng: Rng,
  config: GaConfig,
  sigma: number,
): Float32Array {
  const len = layout.weightCount
  const size = fitness.length
  const order = rankByFitness(fitness)
  const next = new Float32Array(population.length)

  const elites = Math.max(1, Math.round(size * config.eliteFraction))
  const immigrants = Math.round(size * config.immigrantFraction)

  for (let e = 0; e < elites; e++) {
    next.set(population.subarray(order[e] * len, order[e] * len + len), e * len)
  }

  // Rank position of each individual, for tournaments.
  const rank = new Int32Array(size)
  for (let r = 0; r < size; r++) rank[order[r]] = r
  const pick = (): number => {
    let best = nextInt(rng, 0, size - 1)
    for (let t = 1; t < config.tournamentSize; t++) {
      const other = nextInt(rng, 0, size - 1)
      if (rank[other] < rank[best]) best = other
    }
    return best
  }

  for (let c = elites; c < size - immigrants; c++) {
    const a = pick() * len
    const child = c * len
    if (nextBool(rng, config.crossoverRate)) {
      const b = pick() * len
      // Swap whole neurons (bias + incoming weights) so useful features stay intact.
      let p = 0
      for (let l = 0; l < layout.sizes.length - 1; l++) {
        const span = layout.sizes[l] + 1
        for (let j = 0; j < layout.sizes[l + 1]; j++) {
          const from = nextBool(rng) ? a : b
          for (let i = 0; i < span; i++, p++) next[child + p] = population[from + p]
        }
      }
    } else {
      next.set(population.subarray(a, a + len), child)
    }
    for (let p = 0; p < len; p++) {
      if (nextFloat(rng) < config.mutationRate) next[child + p] += nextGaussian(rng, 0, sigma)
    }
  }

  for (let c = size - immigrants; c < size; c++) randomGenome(layout, rng, next, c * len)
  return next
}
