import { describe, expect, it } from 'vitest'
import {
  cloneRng,
  createRng,
  deriveSeed,
  nextFloat,
  nextGaussian,
  nextInt,
  nextRange,
} from '../src/core/math/rng'

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 100; i++) expect(nextFloat(a)).toBe(nextFloat(b))
  })

  it('produces different sequences for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    const same = Array.from({ length: 20 }, () => nextFloat(a) === nextFloat(b))
    expect(same.every(Boolean)).toBe(false)
  })

  it('stays within [0, 1) and is roughly uniform', () => {
    const rng = createRng(7)
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) {
      const x = nextFloat(rng)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      sum += x
    }
    expect(sum / n).toBeCloseTo(0.5, 1)
  })

  it('resumes exactly from a cloned snapshot', () => {
    const rng = createRng(99)
    for (let i = 0; i < 10; i++) nextGaussian(rng)
    const snapshot = cloneRng(rng)
    const expected = [nextFloat(rng), nextGaussian(rng), nextInt(rng, 0, 9)]
    const actual = [nextFloat(snapshot), nextGaussian(snapshot), nextInt(snapshot, 0, 9)]
    expect(actual).toEqual(expected)
  })

  it('respects range and integer bounds', () => {
    const rng = createRng(5)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const r = nextRange(rng, -3, 3)
      expect(r).toBeGreaterThanOrEqual(-3)
      expect(r).toBeLessThan(3)
      seen.add(nextInt(rng, 1, 6))
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('draws gaussians with the requested mean and spread', () => {
    const rng = createRng(11)
    const n = 20000
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const x = nextGaussian(rng, 10, 2)
      sum += x
      sumSq += x * x
    }
    const mean = sum / n
    const std = Math.sqrt(sumSq / n - mean * mean)
    expect(mean).toBeCloseTo(10, 1)
    expect(std).toBeCloseTo(2, 1)
  })

  it('derives distinct child seeds', () => {
    const seeds = new Set(Array.from({ length: 1000 }, (_, i) => deriveSeed(123, i)))
    expect(seeds.size).toBe(1000)
  })
})
