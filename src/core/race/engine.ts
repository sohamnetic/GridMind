import { createRng, deriveSeed, nextFloat, nextGaussian, nextInt, nextRange, type Rng } from '../math/rng'
import type { TrackProfile } from '../profile/trackProfile'
import { DRIVERS, TEAMS } from './grid'
import {
  bestDryCompound,
  raceParams,
  usesTwoDryCompounds,
  type PitStop,
  type RaceParams,
  type Strategy,
} from './strategy'
import {
  bestForConditions,
  COMPOUNDS,
  conditionsPenalty,
  degradation,
  modePace,
  wearPerLap,
  type Compound,
  type DriveMode,
} from './tyres'
import { advanceWeather, createWeather, type Weather } from './weather'

/**
 * Lap-by-lap race engine.
 *
 * One call to stepLap runs one lap for the whole field. A race is a plain
 * object with its random generator inside it, so it can be cloned at any lap
 * and continued along several different futures: that is what the strategy
 * optimiser and the pit-wall debrief are built on.
 */

export interface RaceSetup {
  profile: TrackProfile
  laps: number
  seed: number
  /** Probability of rain at some point in the race (0..1). */
  rainChance: number
  /** Field size, up to the number of drivers. */
  cars: number
  /** Dry strategies the computer-run cars choose from, best first. */
  plans: Strategy[]
  /** Cars (driver indices) that take orders instead of deciding for themselves. */
  manual?: number[]
  /**
   * One car given an exact strategy to start from instead of picking from
   * `plans`. Its pit wall still reacts to rain, safety cars and dead tyres
   * like any other. The rest of the field is unchanged by this: the same seed
   * gives the same grid, weather and rival plans whatever the strategy is.
   */
  player?: { driver: number; strategy: Strategy }
  /** A second car given an exact strategy in the same way: the player's team-mate, when both cars are run. */
  mate?: { driver: number; strategy: Strategy }
  /** Keep per-lap history for charts (default true). Turn off for bulk simulation. */
  record?: boolean
  /** Multiplier on retirements and safety cars (default 1). */
  incidents?: number
  /**
   * The starting order, driver indices from pole back, as decided by a
   * qualifying session run elsewhere. Without it the grid comes from a short
   * qualifying drawn from the seed.
   */
  grid?: number[]
  /** How each car differs from the standard one, by driver index: development and the weekend's set-up. */
  tuning?: CarTuning[]
}

/** One car's differences from the standard car. */
export interface CarTuning {
  /** Added to the car's pace, as a fraction of a lap: negative is quicker. */
  pace: number
  /** Multiplier on tyre wear. */
  wear: number
  /** Seconds added to the time stationary in the box: negative is quicker. */
  stationary: number
  /** Multiplier on the chance of a slow stop. */
  slowStop: number
  /** Multiplier on the chance of retiring. */
  risk: number
}

export const STANDARD_TUNING: CarTuning = { pace: 0, wear: 1, stationary: 0, slowStop: 1, risk: 1 }

/**
 * The race constants as one car sees them: its own tyre wear and its own
 * pit crew. Planning for a car has to use these, or the plan is for a
 * different car.
 */
export function carParams(setup: RaceSetup, driver: number): RaceParams {
  const base = raceParams(setup.profile, setup.laps)
  const tuning = setup.tuning?.[driver]
  if (!tuning) return base
  return { ...base, tyreStress: base.tyreStress * tuning.wear, stationary: base.stationary + tuning.stationary }
}

const tunedParams = new WeakMap<CarTuning[], { profile: TrackProfile; laps: number; list: RaceParams[] }>()

/** carParams for every car, worked out once per set-up: null when the field is standard. */
function fieldParams(setup: RaceSetup): RaceParams[] | null {
  const tuning = setup.tuning
  if (!tuning) return null
  const cached = tunedParams.get(tuning)
  if (cached && cached.profile === setup.profile && cached.laps === setup.laps) return cached.list
  const list = Array.from({ length: Math.min(setup.cars, DRIVERS.length) }, (_, i) => carParams(setup, i))
  tunedParams.set(tuning, { profile: setup.profile, laps: setup.laps, list })
  return list
}

/** Whether `grid` names every one of the first `count` drivers exactly once. */
function validGrid(grid: readonly number[] | undefined, count: number): grid is number[] {
  if (!grid || grid.length !== count) return false
  const seen = new Set(grid)
  if (seen.size !== count) return false
  for (const d of grid) if (!Number.isInteger(d) || d < 0 || d >= count) return false
  return true
}

export type SafetyCar = 'none' | 'vsc' | 'sc'

export interface Stint {
  compound: Compound
  /** First and last lap run on this set (1-based, inclusive). */
  from: number
  to: number
}

export interface CarRace {
  /** Index into DRIVERS; also this car's index in RaceState.cars. */
  driver: number
  running: boolean
  /** Lap on which the car retired, or 0. */
  outLap: number
  /** Race time at the last crossing of the line (s). */
  time: number
  laps: number
  /** Current position, 1 = leading. */
  position: number
  grid: number
  compound: Compound
  /** Share of the tyre's life used; past about 0.8 it falls off the cliff. */
  wear: number
  tyreAge: number
  fuel: number
  mode: DriveMode
  stops: number
  used: Compound[]
  /** Planned stops still to come. */
  plan: PitStop[]
  lastLap: number
  bestLap: number
  /** Time penalty applied at the flag (s). */
  penalty: number
  /** Lap time as a fraction above the field's base lap, from the car and driver. */
  pace: number
  /**
   * How readily this car's pit wall changes tyres when the weather turns,
   * -1 (waits it out) .. +1 (first to blink). Teams do not all stop on the same lap.
   */
  nerve: number
  // History, when recording.
  lapTimes: number[]
  positions: number[]
  gaps: number[]
  stints: Stint[]
}

export type RaceLogType =
  | 'pit'
  | 'overtake'
  | 'sc'
  | 'vsc'
  | 'green'
  | 'rain'
  | 'dry'
  | 'out'
  | 'fastest'
  | 'slowstop'
  | 'stack'
  | 'penalty'
  | 'flag'

export interface RaceLog {
  lap: number
  type: RaceLogType
  car?: number
  other?: number
  compound?: Compound
  value?: number
}

export interface RaceState {
  /** Laps completed. */
  lap: number
  totalLaps: number
  cars: CarRace[]
  /** Car indices in race order, leader first; retired cars last. */
  order: number[]
  rng: Rng
  /**
   * Seed of the retirement and safety-car rolls, which are drawn afresh for
   * each lap from this and the lap number. Keeping them off the main stream
   * means two races that differ only in one car's strategy see the same
   * incidents at the same moments, so the comparison is about the strategy.
   */
  incidentSeed: number
  weather: Weather
  safetyCar: SafetyCar
  /** Laps the current safety car period still has to run. */
  safetyLaps: number
  fastestLap: number
  fastestCar: number
  log: RaceLog[]
  finished: boolean
}

/** What a car can be told before a lap: stop at the end of it, and how hard to drive. */
export interface CarOrder {
  pit?: Compound
  mode?: DriveMode
}

/** Closest two cars can cross the line (s). */
const MIN_GAP = 0.3
const SC_LAP = 1.45
const SC_CATCH_LAP = 1.2
const VSC_LAP = 1.35
const SC_GAP = 0.6
/** Time a pit crew needs between sending one car away and being ready for its team-mate (s). */
export const CREW_RESET = 1.2
/** Time added at the flag for not running two dry compounds in a dry race (s). */
export const RULE_PENALTY = 30

/** Lap length the incident rates are written for (m). */
const INCIDENT_LAP = 5000

/** Lap-time fraction lost by the slowest team's car to the fastest. */
const TEAM_SPREAD = 0.22

/** Lap time of a standard car and its driver, as a fraction above the quickest car's. */
export function carPace(driver: number): number {
  const team = TEAMS[DRIVERS[driver].team]
  // A fixed, small driver-to-driver difference: up to about 0.2 % either way.
  const skill = (((driver * 37) % 11) - 5) * 0.0004
  return (1 - team.pace) * TEAM_SPREAD + skill
}

export function createRace(setup: RaceSetup): RaceState {
  const rng = createRng(setup.seed)
  const params = raceParams(setup.profile, setup.laps)
  const weather = createWeather(rng, setup.laps, setup.rainChance)
  const count = Math.min(setup.cars, DRIVERS.length)
  const record = setup.record !== false

  // Qualifying: pace plus a little luck decides the grid.
  const quali = Array.from({ length: count }, (_, i) => ({ i, t: carPace(i) + nextGaussian(rng, 0, 0.0015) }))
  quali.sort((a, b) => a.t - b.t)
  // A grid decided elsewhere replaces that one; the numbers are drawn all the same, so the race's luck does not move.
  const order = validGrid(setup.grid, count) ? setup.grid.slice() : quali.map((q) => q.i)
  const grid = new Array<number>(count)
  order.forEach((driver, slot) => (grid[driver] = slot + 1))

  const startType = bestForConditions(weather.wetness)
  const cars: CarRace[] = []
  for (let i = 0; i < count; i++) {
    // Each team picks one of the leading strategies and shifts its stops a lap or two.
    const pick = nextFloat(rng)
    let plan = setup.plans.length === 0 ? null : setup.plans[Math.min(setup.plans.length - 1, pick < 0.5 ? 0 : pick < 0.8 ? 1 : 2)]
    let stops: PitStop[] = []
    if (plan) {
      let prev = 0
      for (const stop of plan.stops) {
        const lap = Math.min(setup.laps - 2, Math.max(prev + 2, stop.lap + nextInt(rng, -2, 2)))
        stops.push({ lap, compound: stop.compound })
        prev = lap
      }
    }
    // The player's car draws the same numbers as it would have, then takes its own plan as written.
    const given = setup.player?.driver === i ? setup.player : setup.mate?.driver === i ? setup.mate : null
    if (given) {
      plan = given.strategy
      stops = plan.stops.map((s) => ({ ...s }))
    }
    const compound: Compound = startType === 'dry' ? (plan?.start ?? 'medium') : startType
    cars.push({
      driver: i,
      running: true,
      outLap: 0,
      time: 0,
      laps: 0,
      position: grid[i],
      grid: grid[i],
      compound,
      wear: 0,
      tyreAge: 0,
      fuel: params.fuelStart,
      mode: 'normal',
      stops: 0,
      used: [compound],
      plan: stops,
      lastLap: 0,
      bestLap: Infinity,
      penalty: 0,
      pace: carPace(i) + (setup.tuning?.[i]?.pace ?? 0),
      nerve: nextRange(rng, -1, 1),
      lapTimes: [],
      positions: record ? [grid[i]] : [],
      gaps: record ? [0] : [],
      stints: record ? [{ compound, from: 1, to: 0 }] : [],
    })
  }

  return {
    lap: 0,
    totalLaps: setup.laps,
    cars,
    order,
    rng,
    incidentSeed: deriveSeed(setup.seed, 7919),
    weather,
    safetyCar: 'none',
    safetyLaps: 0,
    fastestLap: Infinity,
    fastestCar: -1,
    log: [],
    finished: false,
  }
}

/** Deep copy of a race, random generator included: the copy continues identically. */
export function cloneRace(state: RaceState): RaceState {
  return {
    ...state,
    cars: state.cars.map((c) => ({
      ...c,
      used: c.used.slice(),
      plan: c.plan.map((s) => ({ ...s })),
      lapTimes: c.lapTimes.slice(),
      positions: c.positions.slice(),
      gaps: c.gaps.slice(),
      stints: c.stints.map((s) => ({ ...s })),
    })),
    order: state.order.slice(),
    rng: { state: state.rng.state },
    weather: { ...state.weather, plan: state.weather.plan },
    log: state.log.slice(),
  }
}

/**
 * A copy of a race without its lap-by-lap history or log: cheap to clone
 * again and again for rollouts that only need the result.
 */
export function stripHistory(state: RaceState): RaceState {
  const copy = cloneRace(state)
  for (const car of copy.cars) {
    car.lapTimes = []
    car.positions = []
    car.gaps = []
    car.stints = []
  }
  copy.log = []
  return copy
}

/** Clean-air lap time for a car in its current state, before traffic and luck (s). */
export function idealLap(car: CarRace, wetness: number, params: RaceParams): number {
  return (
    params.baseLap * (1 + car.pace) +
    params.scale *
      (COMPOUNDS[car.compound].pace +
        degradation(car.compound, car.wear) +
        conditionsPenalty(car.compound, wetness) +
        modePace(car.mode)) +
    car.fuel * params.fuelPenalty
  )
}

/**
 * Whether stopping now for fresh tyres is quicker to the flag than nursing
 * the current set home, on a dry track.
 */
function worthStopping(car: CarRace, remaining: number, params: RaceParams): boolean {
  const rate = wearPerLap(car.compound, params.tyreStress, car.mode, car.fuel / params.fuelStart, 0)
  let stay = 0
  for (let k = 1; k <= remaining; k++) {
    stay += COMPOUNDS[car.compound].pace + degradation(car.compound, car.wear + k * rate)
  }
  const fresh = bestDryCompound(remaining, car.fuel, params)
  const freshRate = wearPerLap(fresh, params.tyreStress, 'normal', car.fuel / params.fuelStart, 0)
  let stop = (params.pitLoss + params.stationary) / params.scale
  for (let k = 0; k < remaining; k++) stop += COMPOUNDS[fresh].pace + degradation(fresh, k * freshRate)
  return stop + 1 < stay
}

/**
 * What a computer-run car does about its tyres before a lap: returns the
 * compound to stop for at the end of the lap, or null to stay out.
 */
export function aiPitCall(car: CarRace, state: RaceState, params: RaceParams): Compound | null {
  const lapNo = state.lap + 1
  const remaining = state.totalLaps - lapNo
  if (remaining < 1) return null
  const { wetness, plan } = state.weather
  const ahead = ((plan[lapNo] ?? 0) + (plan[lapNo + 1] ?? 0) + (plan[lapNo + 2] ?? 0)) / 3
  const want = bestForConditions(wetness)
  const onDry = COMPOUNDS[car.compound].dry
  // Thresholds shift a little from one pit wall to the next.
  const shift = car.nerve * 0.06

  const dryChoice = (): Compound => {
    // The last planned stop must leave the car legal under the two-compound rule.
    const dryUsed = car.used.filter((c) => COMPOUNDS[c].dry)
    const rainUsed = car.used.length > dryUsed.length
    const needOther = !rainUsed && new Set(dryUsed).size < 2 && car.plan.length <= 1
    const planned = car.plan[0]?.compound
    if (planned && COMPOUNDS[planned].dry && !(needOther && dryUsed.includes(planned))) return planned
    return bestDryCompound(remaining, car.fuel - params.fuelPerLap, params, needOther ? dryUsed : [])
  }

  // 1. The wrong kind of tyre for the conditions.
  if (onDry) {
    if (want !== 'dry' && (wetness > 0.42 - shift || (wetness > 0.3 - shift && ahead > 0.3))) {
      return want === 'wet' ? 'wet' : 'inter'
    }
  } else {
    if (want === 'dry' && wetness < 0.22 + shift && ahead < 0.1) return dryChoice()
    if (car.compound === 'inter' && want === 'wet' && wetness > 0.88 - shift) return 'wet'
    if (car.compound === 'wet' && want !== 'wet' && wetness < 0.55 + shift) {
      return want === 'dry' ? dryChoice() : 'inter'
    }
    if (car.wear > 0.95 && remaining >= 3) return car.compound
    return null
  }

  // 2. Tyres finished: stop only if a fresh set repays the stop before the flag.
  if (car.wear > 0.85 && remaining >= 2 && worthStopping(car, remaining, params)) return dryChoice()

  // 3. The planned stop.
  const next = car.plan[0]
  if (next && lapNo >= next.lap) return dryChoice()

  // 4. A cheap stop under the safety car, if one was coming anyway.
  if (state.safetyCar !== 'none' && car.tyreAge >= 5 && remaining >= 4) {
    if ((next && next.lap - lapNo <= 10) || car.wear > 0.5) return dryChoice()
  }
  return null
}

/**
 * Runs one lap for every car.
 *
 * @param orders instructions for manual cars, keyed by driver index
 */
export function stepLap(state: RaceState, setup: RaceSetup, orders: Record<number, CarOrder> = {}): void {
  if (state.finished) return
  const params = raceParams(setup.profile, setup.laps)
  const { rng, cars } = state
  const lapNo = state.lap + 1
  const record = setup.record !== false
  const incidents = setup.incidents ?? 1
  const manual = setup.manual ?? []
  const tuning = setup.tuning
  const own = fieldParams(setup)
  const log = (entry: Omit<RaceLog, 'lap'>) => state.log.push({ lap: lapNo, ...entry })

  // --- Weather for this lap ---
  const wasRaining = state.weather.rain > 0
  advanceWeather(state.weather, lapNo - 1)
  if (!wasRaining && state.weather.rain > 0) log({ type: 'rain', value: state.weather.rain })
  if (wasRaining && state.weather.rain === 0) log({ type: 'dry' })
  const wetness = state.weather.wetness
  const safety = state.safetyCar

  // --- Retirements, which can bring out a safety car for the following laps ---
  // Every roll comes from this lap's own stream, in a fixed order, so one
  // car's luck does not depend on what the others did.
  // Trouble comes per kilometre, not per lap: a race of many short laps is no more dangerous.
  const distance = setup.profile.length / INCIDENT_LAP
  const incident = createRng(deriveSeed(state.incidentSeed, lapNo))
  const deployRoll = nextFloat(incident)
  const strayRoll = nextFloat(incident)
  const strayKind = nextFloat(incident)
  const lengthRoll = nextFloat(incident)
  let deploy: SafetyCar = 'none'
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]
    const roll = nextFloat(incident)
    if (!car.running) continue
    const mismatch = conditionsPenalty(car.compound, wetness)
    let risk = (0.0018 + 0.0018 * wetness + (mismatch > 3 ? 0.02 : 0) + (car.wear > 1.15 ? 0.016 : 0)) * distance
    if (lapNo === 1) risk += 0.006
    if (safety !== 'none') risk *= 0.2
    if (roll < risk * incidents * (tuning?.[i]?.risk ?? 1)) {
      car.running = false
      car.outLap = lapNo
      log({ type: 'out', car: i })
      if (safety === 'none' && deploy === 'none' && lapNo < state.totalLaps - 2) {
        deploy = deployRoll < 0.33 ? 'sc' : deployRoll < 0.58 ? 'vsc' : 'none'
      }
    }
  }
  if (safety === 'none' && deploy === 'none' && lapNo < state.totalLaps - 2 && strayRoll < 0.0025 * distance * incidents) {
    deploy = strayKind < 0.4 ? 'sc' : 'vsc'
  }

  // --- Lap times, in running order ---
  const speedFactor = safety === 'sc' ? 0.4 : safety === 'vsc' ? 0.6 : 1
  const need = (0.5 + 3 * params.overtakingDifficulty) * (lapNo === 1 ? 0.6 : 1)
  // A team has one pit box. A car that arrives while its team-mate is still
  // being serviced waits behind it: the price of stopping both on one lap.
  let boxFree: Map<number, number> | null = null
  let blockCross = -Infinity // crossing time of the car directly ahead on the road
  let blockLap = 0 // that car's lap time this lap
  let blockCar = -1
  let beforeBlock = -Infinity // and of the car ahead of it

  for (const i of state.order) {
    const car = cars[i]
    if (!car.running) continue

    // Orders for this lap.
    let pit: Compound | null = null
    if (manual.includes(i)) {
      const order = orders[i]
      if (order?.mode) car.mode = order.mode
      if (order?.pit) pit = order.pit
    } else {
      pit = aiPitCall(car, state, own ? own[i] : params)
    }

    let lap = idealLap(car, wetness, params) + nextGaussian(rng, 0, 0.22 * params.scale)
    if (nextFloat(rng) < 0.01) lap += nextRange(rng, 1, 3) * params.scale // a lock-up or a moment
    if (lapNo === 1) lap += 4 * params.scale + (car.grid - 1) * 0.18 // standing start, from further back

    let pitTime = 0
    let stationary = 0
    if (pit) {
      stationary = Math.max(1.6, nextGaussian(rng, own ? own[i].stationary : params.stationary, 0.35))
      if (nextFloat(rng) < 0.04 * (tuning?.[i]?.slowStop ?? 1)) {
        stationary += nextRange(rng, 3, 9)
        log({ type: 'slowstop', car: i, value: stationary })
      }
      // The pit lane costs far less while the field is circulating slowly.
      const lane = params.pitLoss * (safety === 'sc' ? 0.45 : safety === 'vsc' ? 0.6 : 1)
      pitTime = lane + stationary
    }
    /** Time spent queueing for the box behind a team-mate, for a car reaching the pits at `arrive`. */
    const queue = (arrive: number): number => {
      const team = DRIVERS[i].team
      boxFree ??= new Map()
      const wait = Math.max(0, (boxFree.get(team) ?? -Infinity) - arrive)
      boxFree.set(team, arrive + wait + stationary + CREW_RESET)
      if (wait > 0.05) log({ type: 'stack', car: i, value: wait })
      return wait
    }

    let cross: number
    if (safety === 'sc') {
      // Catch the queue, then sit in it. A stop is made from the queue, so its
      // time comes on top: the car rejoins behind everyone it was holding up.
      const pace = blockCross === -Infinity ? SC_LAP : SC_CATCH_LAP
      cross = car.time + Math.max(params.baseLap * pace, lap * 0.9)
      if (blockCross !== -Infinity) cross = Math.max(cross, blockCross + SC_GAP)
      if (pit) pitTime += queue(cross)
      cross += pitTime
    } else if (safety === 'vsc') {
      cross = car.time + Math.max(lap, params.baseLap * VSC_LAP)
      if (pit) pitTime += queue(cross)
      cross += pitTime
      if (!pit && blockCross !== -Infinity) cross = Math.max(cross, blockCross + MIN_GAP)
    } else {
      if (pit) pitTime += queue(car.time + lap)
      cross = car.time + lap + pitTime
      if (!pit && cross < blockCross + MIN_GAP) {
        // Caught the car ahead: a pass needs a real pace advantage, more on a tight circuit.
        const advantage = (blockLap - lap) / params.scale
        const chance = advantage <= 0 ? 0 : Math.min(0.92, 1 - Math.exp(-Math.max(0, advantage - 0.3 * need) / need))
        if (nextFloat(rng) < chance) {
          cross = Math.max(cross + 0.2 * params.scale, beforeBlock + MIN_GAP)
          addTime(cars[blockCar], 0.1 * params.scale, record) // the defending car loses a little too
          log({ type: 'overtake', car: i, other: blockCar })
        } else {
          cross = blockCross + MIN_GAP + nextRange(rng, 0, 0.25)
        }
      }
    }

    // The recorded lap is line to line, so it includes any time spent in the pits.
    lap = cross - car.time

    // --- The car's own state after the lap ---
    const stress = own ? own[i].tyreStress : params.tyreStress
    car.wear += wearPerLap(car.compound, stress, car.mode, car.fuel / params.fuelStart, wetness) * speedFactor
    car.fuel = Math.max(0, car.fuel - params.fuelPerLap * (safety === 'sc' ? 0.5 : safety === 'vsc' ? 0.7 : 1))
    car.tyreAge++
    car.time = cross
    car.laps = lapNo
    car.lastLap = lap
    if (record) car.lapTimes.push(lap)
    if (safety === 'none' && !pit && lapNo > 1 && lap < car.bestLap) {
      car.bestLap = lap
      if (lap < state.fastestLap) {
        state.fastestLap = lap
        state.fastestCar = i
      }
    }

    if (pit) {
      if (record) car.stints[car.stints.length - 1].to = lapNo
      car.compound = pit
      car.wear = 0
      car.tyreAge = 0
      car.stops++
      if (!car.used.includes(pit)) car.used.push(pit)
      // A stop within reach of a planned one counts as that stop.
      if (car.plan.length > 0 && car.plan[0].lap - lapNo <= 10) car.plan.shift()
      if (record) car.stints.push({ compound: pit, from: lapNo + 1, to: 0 })
      log({ type: 'pit', car: i, compound: pit, value: pitTime })
    } else if (cross > blockCross) {
      // A car in the pit lane holds nobody up; otherwise this car is the next one's obstacle.
      beforeBlock = blockCross
      blockCross = cross
      blockLap = lap
      blockCar = i
    } else {
      beforeBlock = Math.max(beforeBlock, cross)
    }
  }

  // --- New running order ---
  state.order.sort((a, b) => {
    const ca = cars[a]
    const cb = cars[b]
    if (ca.running !== cb.running) return ca.running ? -1 : 1
    if (!ca.running) return cb.outLap - ca.outLap || a - b
    return ca.time - cb.time || a - b
  })
  if (safety === 'sc') {
    // Cars rejoining from the pits slot into the queue rather than sharing a piece of road.
    let prev = -Infinity
    for (const i of state.order) {
      const car = cars[i]
      if (!car.running) break
      if (car.time < prev + 0.4) addTime(car, prev + 0.4 - car.time, record)
      prev = car.time
    }
  }
  const leaderTime = cars[state.order[0]].time
  state.order.forEach((i, p) => {
    const car = cars[i]
    car.position = p + 1
    if (record && car.running) {
      car.positions.push(p + 1)
      car.gaps.push(car.time - leaderTime)
    }
  })

  // --- Safety car bookkeeping ---
  if (safety !== 'none') {
    state.safetyLaps--
    if (state.safetyLaps <= 0) {
      state.safetyCar = 'none'
      log({ type: 'green' })
    }
  } else if (deploy !== 'none') {
    state.safetyCar = deploy
    state.safetyLaps = deploy === 'sc' ? 3 + Math.floor(lengthRoll * 3) : 1 + Math.floor(lengthRoll * 2)
    log({ type: deploy })
  }

  state.lap = lapNo
  if (lapNo >= state.totalLaps) finishRace(state, record)
}

/** Adds time to a lap a car has already completed, keeping its history in step. */
function addTime(car: CarRace, seconds: number, record: boolean): void {
  car.time += seconds
  car.lastLap += seconds
  if (record && car.lapTimes.length > 0) car.lapTimes[car.lapTimes.length - 1] += seconds
}

function finishRace(state: RaceState, record: boolean): void {
  const { cars } = state
  for (const car of cars) {
    if (record && car.stints.length > 0 && car.stints[car.stints.length - 1].to === 0) {
      car.stints[car.stints.length - 1].to = car.running ? state.totalLaps : car.outLap
    }
    if (!car.running) continue
    // Two dry compounds are compulsory unless rain tyres were used.
    const rainUsed = car.used.some((c) => !COMPOUNDS[c].dry)
    if (!rainUsed && !usesTwoDryCompounds(car.used)) {
      car.penalty = RULE_PENALTY
      car.time += RULE_PENALTY
      state.log.push({ lap: state.totalLaps, type: 'penalty', car: car.driver, value: RULE_PENALTY })
    }
  }
  state.order.sort((a, b) => {
    const ca = cars[a]
    const cb = cars[b]
    if (ca.running !== cb.running) return ca.running ? -1 : 1
    if (!ca.running) return cb.outLap - ca.outLap || a - b
    return ca.time - cb.time || a - b
  })
  state.order.forEach((i, p) => (cars[i].position = p + 1))
  if (state.fastestCar >= 0) {
    state.log.push({ lap: state.totalLaps, type: 'fastest', car: state.fastestCar, value: state.fastestLap })
  }
  state.log.push({ lap: state.totalLaps, type: 'flag', car: state.order[0] })
  state.finished = true
}

/** Runs a whole race with every car deciding for itself. */
export function runRace(setup: RaceSetup): RaceState {
  const state = createRace(setup)
  while (!state.finished) stepLap(state, setup)
  return state
}
