import { nextFloat, nextRange, type Rng } from '../math/rng'

/**
 * Weather for one race.
 *
 * The rain for every lap is rolled once, up front, from the race seed. That
 * keeps a race reproducible, lets a snapshot be replayed with different
 * strategy calls under the same sky, and gives the pit wall a forecast that
 * is right in outline but not in detail.
 */
export interface Weather {
  /** Rain intensity for each lap, 0 = none .. 1 = downpour. Index 0 is lap 1. */
  plan: number[]
  /** Rain falling on the lap just run. */
  rain: number
  /** How wet the track surface is, 0 = dry .. 1 = standing water. */
  wetness: number
}

/** Mean length of a spell of rain (laps). */
const SPELL_LAPS = 9

/**
 * Rolls the rain for a race.
 *
 * @param rainChance probability that it rains at some point in the race (0..1)
 */
export function createWeather(rng: Rng, laps: number, rainChance: number): Weather {
  const plan = new Array<number>(laps).fill(0)
  const chance = Math.min(0.98, Math.max(0, rainChance))
  // Per-lap chance of a shower starting, chosen so the whole-race chance comes out right.
  const start = chance <= 0 ? 0 : 1 - Math.pow(1 - chance, 1 / Math.max(1, laps))

  let raining = chance > 0 && nextFloat(rng) < chance * 0.25
  let intensity = raining ? nextRange(rng, 0.35, 0.9) : 0
  for (let lap = 0; lap < laps; lap++) {
    if (!raining && nextFloat(rng) < start) {
      raining = true
      intensity = nextRange(rng, 0.25, 0.7)
    } else if (raining) {
      if (nextFloat(rng) < 1 / SPELL_LAPS) raining = false
      // Showers build and ease rather than switching between fixed levels.
      else intensity = Math.min(1, Math.max(0.2, intensity + nextRange(rng, -0.15, 0.2)))
    }
    plan[lap] = raining ? intensity : 0
  }
  return { plan, rain: plan[0] ?? 0, wetness: (plan[0] ?? 0) > 0 ? (plan[0] ?? 0) * 0.8 : 0 }
}

/** Updates the track surface for the lap about to be run (0-based lap index). */
export function advanceWeather(weather: Weather, lapIndex: number): void {
  const rain = weather.plan[lapIndex] ?? 0
  weather.rain = rain
  if (rain > 0) {
    // The surface soaks towards the rain's intensity within a couple of laps.
    weather.wetness += (Math.max(rain, weather.wetness * 0.9) - weather.wetness) * 0.5
  } else {
    // A racing line dries out over several laps.
    weather.wetness = Math.max(0, weather.wetness * 0.84 - 0.02)
  }
}

/**
 * Forecast for the next `horizon` laps as seen from the pit wall: the true
 * plan, blurred more the further ahead it looks. `noise` must return values
 * in [0, 1) and should be seeded separately from the race itself.
 */
export function forecast(weather: Weather, fromLap: number, horizon: number, noise: () => number): number[] {
  const out: number[] = []
  for (let k = 0; k < horizon; k++) {
    const lap = fromLap + k
    if (lap >= weather.plan.length) break
    // Average over a widening window: timing gets vaguer with distance.
    const reach = Math.floor(k / 4)
    let sum = 0
    let count = 0
    for (let d = -reach; d <= reach; d++) {
      const i = lap + d
      if (i >= 0 && i < weather.plan.length) {
        sum += weather.plan[i]
        count++
      }
    }
    const blur = 0.04 + 0.03 * k
    out.push(Math.min(1, Math.max(0, sum / count + (noise() - 0.5) * 2 * blur)))
  }
  return out
}

/**
 * The same sky up to lap index `keep`, and a fresh roll of the dice after
 * it: one of the futures the pit wall has to allow for, since a forecast is
 * only good for a few laps. Returns a new Weather; the original is untouched.
 */
export function rerollWeather(weather: Weather, keep: number, rng: Rng, rainChance: number): Weather {
  const laps = weather.plan.length
  const plan = weather.plan.slice()
  const chance = Math.min(0.98, Math.max(0, rainChance))
  const start = chance <= 0 ? 0 : 1 - Math.pow(1 - chance, 1 / Math.max(1, laps))
  const from = Math.max(0, keep)
  let intensity = from > 0 ? (plan[from - 1] ?? 0) : 0
  let raining = intensity > 0
  for (let lap = from; lap < laps; lap++) {
    if (!raining && nextFloat(rng) < start) {
      raining = true
      intensity = nextRange(rng, 0.25, 0.7)
    } else if (raining) {
      if (nextFloat(rng) < 1 / SPELL_LAPS) raining = false
      else intensity = Math.min(1, Math.max(0.2, intensity + nextRange(rng, -0.15, 0.2)))
    }
    plan[lap] = raining ? intensity : 0
  }
  return { plan, rain: weather.rain, wetness: weather.wetness }
}
