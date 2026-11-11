import type { TrackProfile } from '../profile/trackProfile'
import { createRace, stepLap, type CarOrder, type RaceSetup, type RaceState, type SafetyCar } from '../race/engine'
import { raceParams, rankStrategies, type RaceParams, type Strategy } from '../race/strategy'
import { bestForConditions, CLIFF_WEAR, COMPOUNDS, wearPerLap, type Compound } from '../race/tyres'
import { planFrom, type Plan } from './replan'

/**
 * A race run from the pit wall: one car takes its orders from the player,
 * lap by lap. The race is fully determined by its setup and the list of
 * orders given, so it can be rebuilt anywhere (a worker, a test) from those.
 */

export interface PitWallConfig {
  profile: TrackProfile
  laps: number
  seed: number
  rainChance: number
  /** The player's car (index into DRIVERS). */
  driver: number
  /** The plan the player starts with: it sets the starting tyres. */
  strategy: Strategy
}

export function sessionSetup(config: PitWallConfig): RaceSetup {
  return {
    profile: config.profile,
    laps: config.laps,
    seed: config.seed,
    rainChance: config.rainChance,
    cars: 20,
    plans: rankStrategies(raceParams(config.profile, config.laps)).map((r) => r.strategy),
    manual: [config.driver],
    player: { driver: config.driver, strategy: config.strategy },
  }
}

/** The player's car in a pit-wall setup. */
export function playerOf(setup: RaceSetup): number {
  return setup.manual?.[0] ?? setup.player?.driver ?? 0
}

/** Rebuilds the race as it stood after the given orders, one per lap run. */
export function replay(setup: RaceSetup, orders: readonly CarOrder[]): RaceState {
  const driver = playerOf(setup)
  const race = createRace(setup)
  for (const order of orders) {
    if (race.finished) break
    stepLap(race, setup, { [driver]: order })
  }
  return race
}

/**
 * The plan the pit wall is working to: the best dry-track stops from here.
 * There is none while the track wants rain tyres, when the weather decides.
 */
export function workingPlan(state: RaceState, driver: number, params: RaceParams): Plan | null {
  const me = state.cars[driver]
  if (!me.running || state.finished) return null
  if (bestForConditions(state.weather.wetness) !== 'dry') return null
  return planFrom(me, state.lap, params)
}

// ---------- Decision points ----------

export type DecisionType = 'safety' | 'rain' | 'crossover' | 'cliff' | 'window'

export interface Decision {
  type: DecisionType
  /** One line for the pit wall, e.g. "Safety car: a stop now costs 6.1 s instead of 12.2 s". */
  text: string
}

/** The few facts about the lap before that decision points are measured against. */
export interface Pulse {
  safetyCar: SafetyCar
  rain: number
  /** Tyre type the track called for. */
  wanted: 'dry' | 'inter' | 'wet'
  wear: number
  /** Whether the coming lap was inside the pit window. */
  windowOpen: boolean
}

function inWindow(state: RaceState, plan: Plan | null): boolean {
  const lapNo = state.lap + 1
  return plan?.window != null && lapNo >= plan.window.from && lapNo <= plan.window.to
}

export function pulseOf(state: RaceState, driver: number, plan: Plan | null): Pulse {
  return {
    safetyCar: state.safetyCar,
    rain: state.weather.rain,
    wanted: bestForConditions(state.weather.wetness),
    wear: state.cars[driver].wear,
    windowOpen: inWindow(state, plan),
  }
}

/** Wear at which the driver starts to feel the tyres going, a little before the cliff. */
export const FADING_WEAR = CLIFF_WEAR - 0.08

/** Time a stop costs right now: the pit lane, cheaper behind a safety car, plus the time in the box (s). */
export function pitCost(state: RaceState, params: RaceParams): number {
  const lane = params.pitLoss * (state.safetyCar === 'sc' ? 0.45 : state.safetyCar === 'vsc' ? 0.6 : 1)
  return lane + params.stationary
}

/** Position the car would hold after a stop now, if nobody else stopped. */
export function rejoinPosition(state: RaceState, driver: number, cost: number): number {
  const me = state.cars[driver]
  let position = 1
  for (const car of state.cars) {
    if (car !== me && car.running && car.time < me.time + cost) position++
  }
  return position
}

/** Laps the car's tyres have left before the cliff, at the present rate. */
export function lapsToCliff(state: RaceState, driver: number, params: RaceParams): number {
  const me = state.cars[driver]
  const rate = wearPerLap(me.compound, params.tyreStress, me.mode, me.fuel / params.fuelStart, state.weather.wetness)
  return Math.max(0, Math.floor((CLIFF_WEAR - me.wear) / Math.max(rate, 1e-6)))
}

const TYRE_WORDS: Record<'dry' | 'inter' | 'wet', string> = {
  dry: 'slicks',
  inter: 'intermediates',
  wet: 'full wets',
}

function tyreKind(compound: Compound): 'dry' | 'inter' | 'wet' {
  return COMPOUNDS[compound].dry ? 'dry' : compound === 'inter' ? 'inter' : 'wet'
}

/**
 * Reasons to stop the clock and ask the player before the next lap: things
 * that have just changed and make a pit call worth thinking about.
 *
 * @param before the race a lap ago
 * @param plan the best plan from here, for the pit window
 */
export function decisionPoints(
  before: Pulse,
  state: RaceState,
  driver: number,
  params: RaceParams,
  plan: Plan | null,
): Decision[] {
  const me = state.cars[driver]
  const lapNo = state.lap + 1
  if (!me.running || state.finished || state.totalLaps - lapNo < 2) return []
  const out: Decision[] = []

  if (state.safetyCar !== 'none' && before.safetyCar === 'none') {
    const name = state.safetyCar === 'sc' ? 'Safety car' : 'Virtual safety car'
    const full = params.pitLoss + params.stationary
    out.push({
      type: 'safety',
      text: `${name}: a stop now costs about ${pitCost(state, params).toFixed(0)} s instead of ${full.toFixed(0)} s.`,
    })
  }

  if (state.weather.rain > 0 && before.rain === 0) {
    out.push({ type: 'rain', text: 'Rain has started. The track is getting wetter each lap.' })
  }

  const wanted = bestForConditions(state.weather.wetness)
  if (wanted !== before.wanted && wanted !== tyreKind(me.compound)) {
    out.push({ type: 'crossover', text: `The track is now quicker on ${TYRE_WORDS[wanted]}.` })
  }

  if (me.wear >= FADING_WEAR && before.wear < FADING_WEAR && COMPOUNDS[me.compound].dry) {
    const left = lapsToCliff(state, driver, params)
    out.push({
      type: 'cliff',
      text:
        left > 0
          ? `Tyres are close to the cliff: about ${left} lap${left === 1 ? '' : 's'} of grip left.`
          : 'Tyres have reached the cliff: lap times fall away sharply from here.',
    })
  }

  if (plan?.window && inWindow(state, plan) && !before.windowOpen) {
    const next = plan.stops[0]
    const span = plan.window.to > lapNo ? `laps ${lapNo} to ${plan.window.to}` : `lap ${lapNo}`
    out.push({
      type: 'window',
      text: `Pit window open: ${span}, for ${COMPOUNDS[next.compound].label.toLowerCase()} tyres.`,
    })
  }
  return out
}

// ---------- Animation ----------

/**
 * Where every car is on the lap while a lap is being shown.
 *
 * `before` and `after` are the race either side of the lap and `u` runs from
 * 0 to 1 across it, following the leader. A car a few seconds behind is
 * still finishing its previous lap when the leader starts this one, so it
 * sits a little short of the line: the gaps on track are the gaps on the
 * timing screen.
 *
 * @param out receives, for each car, its fraction of a lap from the start line, or -1 if it is out of the race
 */
export function trackFractions(before: RaceState, after: RaceState, u: number, out: Float32Array): void {
  const leadBefore = before.cars[before.order[0]].time
  let leadAfter = Infinity
  for (const car of after.cars) if (car.running && car.time < leadAfter) leadAfter = car.time
  if (!Number.isFinite(leadAfter)) leadAfter = leadBefore
  const clock = leadBefore + Math.min(1, Math.max(0, u)) * (leadAfter - leadBefore)

  for (let i = 0; i < after.cars.length; i++) {
    const was = before.cars[i]
    const now = after.cars[i]
    if (!was.running || !now.running) {
      out[i] = -1
      continue
    }
    const lap = now.time - was.time
    let f: number
    if (clock >= was.time) {
      // On the lap being shown.
      f = lap > 0 ? (clock - was.time) / lap : 0
    } else {
      // Still completing the lap before.
      const previous = was.lastLap > 0 ? was.lastLap : lap
      f = previous > 0 ? (clock - was.time) / previous : 0
    }
    out[i] = f - Math.floor(f)
  }
}
