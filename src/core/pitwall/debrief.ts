import { deriveSeed } from '../math/rng'
import { carParams, createRace, stepLap, type CarOrder, type RaceSetup, type SafetyCar, type Stint } from '../race/engine'
import { callOptions, chooseCall, evaluateCall, optionOf, type CallValue } from './rollout'
import { decisionPoints, playerOf, pulseOf, workingPlan, type DecisionType } from './session'

/**
 * The debrief: every call the player made, judged against what the strategy
 * engine would have done in the same spot, and the engine's own run of the
 * same race.
 */

export type Verdict = 'good' | 'fair' | 'costly'

export interface CallReview {
  /** The lap the call was for (a stop happens at the end of it). */
  lap: number
  /** What the player did and what the engine would have done: 'stay' or 'box-<compound>'. */
  chosen: string
  best: string
  /** Places the player's call cost against the engine's, by rollouts. Never negative. */
  loss: number
  /** Race time the player's call cost against the engine's (s); negative if it was quicker but lost places. */
  seconds: number
  verdict: Verdict
  values: CallValue[]
  /** What was going on, if anything, that made this lap a decision point. */
  reasons: DecisionType[]
  safetyCar: SafetyCar
  wetness: number
  /** The car's position going into the lap. */
  position: number
}

/** Seed for the rollouts behind one lap's review: the same lap is always judged on the same futures. */
function reviewSeed(setup: RaceSetup, lap: number): number {
  return deriveSeed(setup.seed ^ 0x5eed, lap)
}

/** How a call rates, from the places it cost. */
export function verdictOf(loss: number): Verdict {
  if (loss <= 0.3) return 'good'
  if (loss <= 1) return 'fair'
  return 'costly'
}

/**
 * Reviews the calls made for the given laps.
 *
 * @param orders the player's order for every lap of the race, in order
 * @param laps which laps to review (1-based); the race is replayed up to the last of them
 */
export function reviewLaps(
  setup: RaceSetup,
  orders: readonly CarOrder[],
  laps: readonly number[],
  samples: number,
  onLap: (lap: number) => void = () => {},
): CallReview[] {
  const driver = playerOf(setup)
  const params = carParams(setup, driver)
  const wanted = new Set(laps)
  const lastLap = laps.reduce((m, l) => Math.max(m, l), 0)
  const race = createRace(setup)
  const reviews: CallReview[] = []
  let pulse = pulseOf(race, driver, null)

  for (let lap = 1; lap <= lastLap && !race.finished; lap++) {
    const order = orders[lap - 1] ?? {}
    const me = race.cars[driver]
    if (!me.running) break
    const plan = workingPlan(race, driver, params)
    if (wanted.has(lap)) {
      const options = callOptions(race, driver)
      const chosen = optionOf(order.pit)
      if (!options.some((o) => o.id === chosen.id)) options.push(chosen)
      if (options.length > 1) {
        const values = evaluateCall(race, setup, driver, order.mode ?? me.mode, options, samples, reviewSeed(setup, lap))
        const best = chooseCall(values)
        const mine = values.find((v) => v.id === chosen.id) ?? best
        const same = mine.id === best.id
        const loss = same ? 0 : Math.max(0, mine.score - best.score)
        reviews.push({
          lap,
          chosen: mine.id,
          best: best.id,
          loss,
          seconds: same ? 0 : mine.meanTime - best.meanTime,
          verdict: verdictOf(loss),
          values,
          reasons: decisionPoints(pulse, race, driver, params, plan).map((d) => d.type),
          safetyCar: race.safetyCar,
          wetness: race.weather.wetness,
          position: me.position,
        })
      }
      onLap(lap)
    }
    pulse = pulseOf(race, driver, plan)
    stepLap(race, setup, { [driver]: order })
  }
  return reviews
}

export interface EngineRun {
  position: number
  /** Race time, or 0 if the car retired. */
  time: number
  retired: boolean
  stints: Stint[]
  /** The calls the engine made, one per lap. */
  orders: CarOrder[]
}

/**
 * The strategy engine's own run of the same race: the same grid, weather,
 * safety cars and luck, with the engine making every call by rollouts. It
 * sees no more of the future than the player did.
 */
export function enginePlay(setup: RaceSetup, samples: number, onLap: (lap: number) => void = () => {}): EngineRun {
  const driver = playerOf(setup)
  const race = createRace(setup)
  const orders: CarOrder[] = []
  while (!race.finished) {
    const me = race.cars[driver]
    let order: CarOrder = {}
    if (me.running) {
      const options = callOptions(race, driver)
      if (options.length > 1) {
        const values = evaluateCall(race, setup, driver, 'normal', options, samples, reviewSeed(setup, race.lap + 1))
        const best = chooseCall(values)
        if (best.pit) order = { pit: best.pit }
      }
    }
    orders.push(order)
    stepLap(race, setup, { [driver]: order })
    onLap(race.lap)
  }
  const me = race.cars[driver]
  return {
    position: me.position,
    time: me.running ? me.time : 0,
    retired: !me.running,
    stints: me.stints.map((s) => ({ ...s })),
    orders,
  }
}

/** The laps worth reviewing: every lap a call could still change the race. */
export function reviewableLaps(totalLaps: number): number[] {
  const out: number[] = []
  for (let lap = 1; lap <= totalLaps - 2; lap++) out.push(lap)
  return out
}
