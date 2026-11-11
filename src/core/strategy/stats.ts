import { FLAG_RAIN, FLAG_RETIRED, FLAG_SAFETY, type Outcomes } from './monteCarlo'

/** Positions that score points. */
export const POINTS_PLACES = 10

/** Average result over the races that share some condition. */
export interface Slice {
  runs: number
  meanPosition: number
}

export interface StrategyStats {
  runs: number
  /** Average classified position, retirements included. */
  meanPosition: number
  /** Shares of races, 0..1. */
  win: number
  podium: number
  points: number
  retired: number
  /** Finishing position not bettered in 10 %, 50 % and 90 % of races. */
  p10: number
  p50: number
  p90: number
  /** Share of races finished in each position: histogram[0] is first place. Retirements are not in it. */
  histogram: number[]
  /** Average race time of the races finished (s). */
  meanTime: number
  /** Average number of pit stops made in the races finished. */
  meanStops: number
  /** How the result changes with the race: safety car or none, rain or dry. */
  safety: Slice
  green: Slice
  rain: Slice
  dry: Slice
}

/** Turns raw results into the figures shown for a strategy. */
export function summarise(outcomes: Outcomes, cars: number): StrategyStats {
  const { positions, times, flags, stops } = outcomes
  const runs = positions.length
  const counts = new Array<number>(cars + 1).fill(0) // every classified position, for percentiles
  const histogram = new Array<number>(cars).fill(0)
  let sum = 0
  let win = 0
  let podium = 0
  let points = 0
  let retired = 0
  let timeSum = 0
  let stopSum = 0
  let finished = 0
  const slices = [0, 0, 0, 0, 0, 0, 0, 0] // runs and position sums: safety, green, rain, dry

  for (let k = 0; k < runs; k++) {
    const p = positions[k]
    const flag = flags[k]
    sum += p
    counts[Math.min(cars, p)]++
    if (flag & FLAG_RETIRED) {
      retired++
    } else {
      histogram[Math.min(cars, p) - 1]++
      if (p === 1) win++
      if (p <= 3) podium++
      if (p <= POINTS_PLACES) points++
      timeSum += times[k]
      stopSum += stops[k]
      finished++
    }
    const s = flag & FLAG_SAFETY ? 0 : 2
    slices[s]++
    slices[s + 1] += p
    const w = flag & FLAG_RAIN ? 4 : 6
    slices[w]++
    slices[w + 1] += p
  }

  const percentile = (share: number): number => {
    let seen = 0
    for (let p = 1; p <= cars; p++) {
      seen += counts[p]
      if (seen >= share * runs) return p
    }
    return cars
  }
  const slice = (i: number): Slice => ({ runs: slices[i], meanPosition: slices[i] > 0 ? slices[i + 1] / slices[i] : 0 })
  const share = (n: number) => (runs > 0 ? n / runs : 0)

  return {
    runs,
    meanPosition: runs > 0 ? sum / runs : 0,
    win: share(win),
    podium: share(podium),
    points: share(points),
    retired: share(retired),
    p10: percentile(0.1),
    p50: percentile(0.5),
    p90: percentile(0.9),
    histogram: histogram.map(share),
    meanTime: finished > 0 ? timeSum / finished : 0,
    meanStops: finished > 0 ? stopSum / finished : 0,
    safety: slice(0),
    green: slice(2),
    rain: slice(4),
    dry: slice(6),
  }
}

/** Orders strategies best first: lower average position, then shorter race. */
export function compareStats(a: StrategyStats, b: StrategyStats): number {
  return a.meanPosition - b.meanPosition || a.meanTime - b.meanTime
}

function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++
    const rank = (i + j) / 2 + 1 // ties share the average rank
    for (let k = i; k <= j; k++) out[order[k].i] = rank
    i = j + 1
  }
  return out
}

/** Spearman rank correlation of two equally long lists, -1..1. */
export function spearman(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const ra = ranks(a.slice(0, n))
  const rb = ranks(b.slice(0, n))
  const mean = (n + 1) / 2
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - mean) * (rb[i] - mean)
    va += (ra[i] - mean) ** 2
    vb += (rb[i] - mean) ** 2
  }
  return va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb)
}
