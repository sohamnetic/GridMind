import { createRng, deriveSeed, nextFloat } from '../math/rng'
import { cloneRace, stepLap, stripHistory, type RaceSetup, type RaceState } from '../race/engine'
import { raceParams, type PitStop } from '../race/strategy'
import { COMPOUNDS, wearPerLap, type Compound, type DriveMode } from '../race/tyres'
import { rerollWeather } from '../race/weather'
import { planFrom } from './replan'

/**
 * Judging a pit call by playing out the rest of the race.
 *
 * Each option for the coming lap (stay out, or box for one compound) is
 * raced to the flag many times. After that first lap the strategy engine
 * takes the car over, following the best plan from there and reacting to
 * whatever happens. Every option meets the same futures: the same luck, the
 * same safety cars, and the same weather, which keeps to the forecast for a
 * few laps and is rolled afresh beyond it, because that is all the pit wall
 * could have known.
 */

export interface CallOption {
  /** 'stay', or 'box-' and the compound. */
  id: string
  pit: Compound | null
}

export interface CallValue extends CallOption {
  /** Average race time over the futures the car finished in every option (s). */
  meanTime: number
  /** Average classified position over every future. */
  meanPosition: number
  /** Futures behind meanTime. */
  samples: number
  /**
   * What the option is worth, in places against staying out: lower is
   * better. It is the average finishing position, plus the race time
   * converted to places, so that seconds thrown away still count when the
   * car is in clear air and no position changes hands.
   */
  score: number
}

/** Seconds of race time counted as one place, on a 90 s lap. */
const SECONDS_PER_PLACE = 12
/** A stop has to beat staying out by this many places to be the call. */
export const STOP_MARGIN = 0.35

export const STAY: CallOption = { id: 'stay', pit: null }

export function boxOption(compound: Compound): CallOption {
  return { id: `box-${compound}`, pit: compound }
}

/** The option an order amounts to. */
export function optionOf(pit: Compound | null | undefined): CallOption {
  return pit ? boxOption(pit) : STAY
}

/**
 * The calls worth considering for the coming lap: always staying out, slicks
 * unless the track is properly wet, and rain tyres when it is wet or about
 * to be.
 */
export function callOptions(state: RaceState, driver: number): CallOption[] {
  const me = state.cars[driver]
  const lapNo = state.lap + 1
  if (!me || !me.running || state.finished || state.totalLaps - lapNo < 2) return [STAY]
  const { wetness, plan } = state.weather
  let soon = 0
  for (let i = lapNo - 1; i < lapNo + 3; i++) soon = Math.max(soon, plan[i] ?? 0)
  const options: CallOption[] = [STAY]
  if (wetness < 0.6) options.push(boxOption('soft'), boxOption('medium'), boxOption('hard'))
  if (wetness > 0.05 || soon > 0) options.push(boxOption('inter'))
  if (wetness > 0.4 || soon > 0.6) options.push(boxOption('wet'))
  return options
}

/**
 * Plays out each option `samples` times from `state` and returns what each
 * is worth, in the order given.
 *
 * @param mode how the car is driven on the coming lap
 */
export function evaluateCall(
  state: RaceState,
  setup: RaceSetup,
  driver: number,
  mode: DriveMode,
  options: readonly CallOption[],
  samples: number,
  seed: number,
): CallValue[] {
  const params = raceParams(setup.profile, setup.laps)
  const base = stripHistory(state)
  const me = base.cars[driver]
  const manual: RaceSetup = { ...setup, manual: [driver], record: false }
  const auto: RaceSetup = { ...setup, manual: [], record: false }

  // The plan the engine follows after each option, from the car's state a lap from now.
  const lapsDone = state.lap + 1
  const fuel = Math.max(0, me.fuel - params.fuelPerLap)
  const plans: PitStop[][] = options.map((o) => {
    if (o.pit) {
      if (!COMPOUNDS[o.pit].dry) return []
      const used = me.used.includes(o.pit) ? me.used : [...me.used, o.pit]
      return planFrom({ compound: o.pit, wear: 0, fuel, used }, lapsDone, params, lapsDone + 2).stops
    }
    const wear =
      me.wear + wearPerLap(me.compound, params.tyreStress, mode, me.fuel / params.fuelStart, state.weather.wetness)
    return planFrom({ compound: me.compound, wear, fuel, used: me.used }, lapsDone, params).stops
  })

  const timeSum = new Array<number>(options.length).fill(0)
  const positionSum = new Array<number>(options.length).fill(0)
  const times = new Array<number>(options.length).fill(0)
  let finished = 0

  for (let k = 0; k < samples; k++) {
    const s = deriveSeed(seed, k)
    const sky = createRng(deriveSeed(s, 1))
    // The forecast holds for three laps at least, and for up to a dozen.
    const horizon = 3 + Math.floor(nextFloat(sky) * 10)
    const weather = rerollWeather(state.weather, state.lap + horizon, sky, setup.rainChance)
    let all = true
    for (let o = 0; o < options.length; o++) {
      const race = cloneRace(base)
      race.rng = createRng(s)
      race.incidentSeed = deriveSeed(s, 2)
      race.weather = { plan: weather.plan, rain: weather.rain, wetness: weather.wetness }
      stepLap(race, manual, { [driver]: { pit: options[o].pit ?? undefined, mode } })
      const car = race.cars[driver]
      if (car.running) {
        car.plan = plans[o].map((stop) => ({ ...stop }))
        car.mode = 'normal'
      }
      while (!race.finished) stepLap(race, auto)
      positionSum[o] += car.position
      times[o] = car.time
      if (!car.running) all = false
    }
    if (all) {
      finished++
      for (let o = 0; o < options.length; o++) timeSum[o] += times[o]
    }
  }

  const stay = Math.max(0, options.findIndex((o) => o.pit === null))
  const mean = (sum: number, n: number) => (n > 0 ? sum / n : 0)
  return options.map((option, o) => ({
    ...option,
    meanTime: mean(timeSum[o], finished),
    meanPosition: mean(positionSum[o], samples),
    samples: finished,
    score:
      mean(positionSum[o] - positionSum[stay], samples) +
      mean(timeSum[o] - timeSum[stay], finished) / (SECONDS_PER_PLACE * params.scale),
  }))
}

/**
 * The option to take: the one worth most, except that a stop has to beat
 * staying out by a clear margin, since a stop cannot be taken back and small
 * differences between options are noise.
 */
export function chooseCall(values: readonly CallValue[], margin = STOP_MARGIN): CallValue {
  const stay = values.find((v) => v.pit === null) ?? values[0]
  let best = stay
  for (const v of values) {
    if (v.pit !== null && v.score < best.score && v.score < stay.score - margin) best = v
  }
  return best
}
