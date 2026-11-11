/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * The whole simulation core draws randomness from here instead of Math.random,
 * so a seed fully determines a training run or a race. The state is one plain
 * number in a plain object: it can be cloned, posted to a Web Worker, or
 * snapshotted mid-race for strategy rollouts.
 */
export interface Rng {
  state: number
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 }
}

export function cloneRng(rng: Rng): Rng {
  return { state: rng.state }
}

/** Uniform float in [0, 1). */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0
  let t = rng.state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Uniform float in [min, max). */
export function nextRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * nextFloat(rng)
}

/** Uniform integer in [min, max] (both inclusive). */
export function nextInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1))
}

/** True with probability p. */
export function nextBool(rng: Rng, p = 0.5): boolean {
  return nextFloat(rng) < p
}

/**
 * Normally distributed float (Box–Muller).
 * Deliberately does not cache the second variate, so the generator state stays
 * a single number and snapshots remain exact.
 */
export function nextGaussian(rng: Rng, mean = 0, stdDev = 1): number {
  const u = 1 - nextFloat(rng) // (0, 1] — avoids log(0)
  const v = nextFloat(rng)
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Derives an independent child seed, e.g. one per Monte Carlo run or per car,
 * so parallel workers never share a random stream.
 */
export function deriveSeed(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
