import { create } from 'zustand'
import { type CallReview, type EngineRun, reviewableLaps } from '../core/pitwall/debrief'
import { radioFor, type RadioMessage } from '../core/pitwall/radio'
import type { Plan } from '../core/pitwall/replan'
import type { CallValue } from '../core/pitwall/rollout'
import {
  decisionPoints,
  pulseOf,
  sessionSetup,
  setupFor,
  splitOrders,
  trackFractions,
  workingPlan,
  type Decision,
  type LapOrders,
  type Pulse,
} from '../core/pitwall/session'
import type { TrackProfile } from '../core/profile/trackProfile'
import {
  carParams,
  cloneRace,
  createRace,
  stepLap,
  type CarOrder,
  type CarTuning,
  type RaceSetup,
  type RaceState,
} from '../core/race/engine'
import { DRIVERS } from '../core/race/grid'
import type { RaceParams, Strategy } from '../core/race/strategy'
import type { TrackDef } from '../core/track/types'
import { bestForConditions, COMPOUNDS, type Compound, type DriveMode } from '../core/race/tyres'
import type { PitWallReply, PitWallRequest } from '../workers/pitwallProtocol'

/** Seconds a lap takes on screen at each speed. */
export const PITWALL_SPEEDS = [
  { value: 1, label: '1×', seconds: 6 },
  { value: 2, label: '2×', seconds: 3 },
  { value: 4, label: '4×', seconds: 1.5 },
  { value: 8, label: '8×', seconds: 0.75 },
] as const

export type PitWallSpeed = (typeof PITWALL_SPEEDS)[number]['value']

/** Futures played out for the engineer's advice, each call of the debrief, and each call of the engine's own run. */
const ADVICE_SAMPLES = 120
const REVIEW_SAMPLES = 60
const ENGINE_SAMPLES = 40

/** Car positions for the map: x, y, heading, status for each car. Mutated in place; `seq` says when. */
export const pitwallFrame: { seq: number; leader: number; cars: Float32Array | null } = {
  seq: 0,
  leader: 0,
  cars: null,
}

export interface PendingOrder {
  /** Tyres to stop for at the end of the lap in progress, or null to stay out. */
  pit: Compound | null
  mode: DriveMode
}

export interface Advice {
  /** The car the advice is for, and the lap. */
  car: number
  lap: number
  status: 'thinking' | 'ready'
  values: CallValue[]
  best: string
}

export interface DebriefState {
  /** The car whose calls are reviewed, or -1 with no debrief. */
  car: number
  status: 'idle' | 'running' | 'done'
  done: number
  total: number
  reviews: CallReview[]
  engine: EngineRun | null
}

/** A reason the clock stopped. `car` is null for what concerns every car alike: a safety car, rain. */
export interface CarDecision extends Decision {
  car: number | null
}

/** A race that belongs to something bigger than the pit wall's own setup screen: a round of a season. */
export interface PitWallEvent {
  kind: 'season'
  /** The season's seed and the round's index, so the result goes to the season it came from. */
  season: number
  round: number
  /** The circuit raced on, which need not be the one open in the Track Studio. */
  def: TrackDef
  title: string
}

/** What an event decides for the race, in place of the setup screen's options. */
export interface EventRace {
  event: PitWallEvent
  seed: number
  rainChance: number
  driver: number
  /** The team-mate's car and starting plan, when the player runs both. */
  mate?: { driver: number; strategy: Strategy }
  grid?: number[]
  tuning?: CarTuning[]
}

const NO_DEBRIEF: DebriefState = { car: -1, status: 'idle', done: 0, total: 0, reviews: [], engine: null }
const NO_ORDER: PendingOrder = { pit: null, mode: 'normal' }

/** The other car of a driver's team: drivers come in pairs. */
export function teamMateOf(driver: number): number {
  return driver % 2 === 0 ? driver + 1 : driver - 1
}

interface PitWallStore {
  // Options for the next race.
  laps: number | null
  rainChance: number
  /** The player's car. During a race with two cars, the one in view. */
  driver: number
  /** Run the team-mate's car as well. */
  bothCars: boolean
  seed: number
  /** Which of the offered starting plans is chosen. */
  planIndex: number

  phase: 'setup' | 'race' | 'finished'
  /** Set while the race on the pit wall is a round of a season. */
  event: PitWallEvent | null
  track: { id: string; name: string } | null
  setup: RaceSetup | null
  /** The race as it stands after the last completed lap. */
  race: RaceState | null
  /** The cars taking orders from the pit wall: the player's, then the team-mate's if it is run too. */
  cars: number[]
  /** The orders given on every lap run so far. */
  history: LapOrders[]
  /** The order each car has for the lap in progress. */
  pendings: Record<number, PendingOrder>
  /** The order of the car in view. */
  pending: PendingOrder
  playing: boolean
  speed: PitWallSpeed
  autoPause: boolean
  /** Why the clock is stopped, when it was stopped for a decision. */
  decisions: CarDecision[]
  radio: RadioMessage[]
  /** The best plan from here for each car, for the pit window. */
  plans: Record<number, Plan | null>
  /** The plan of the car in view. */
  plan: Plan | null
  advice: Advice | null
  debrief: DebriefState
  error: string | null

  setOptions: (
    options: Partial<Pick<PitWallStore, 'laps' | 'rainChance' | 'driver' | 'bothCars' | 'seed' | 'planIndex'>>,
  ) => void
  start: (
    profile: TrackProfile,
    laps: number,
    track: { id: string; name: string },
    strategy: Strategy,
    path: Float32Array,
    eventRace?: EventRace,
  ) => void
  play: () => void
  pause: () => void
  /** Finishes the lap in progress at once. */
  nextLap: () => void
  setSpeed: (speed: PitWallSpeed) => void
  setAutoPause: (on: boolean) => void
  /** Brings another of the player's cars into view. */
  focus: (car: number) => void
  /** Pit call and driving mode, for the car in view unless another is named. */
  setPit: (compound: Compound | null, car?: number) => void
  setMode: (mode: DriveMode, car?: number) => void
  askEngineer: () => void
  /** Back to the setup screen. */
  leave: () => void
}

// ---------- State that changes every frame, kept out of React ----------

const anim: { before: RaceState | null; after: RaceState | null; key: string; u: number } = {
  before: null,
  after: null,
  key: '',
  u: 0,
}
let path: Float32Array | null = null
let fractions = new Float32Array(0)
/** The race as each of the player's cars sees it: its own tyre wear and pit crew. */
let paramsBy: Record<number, RaceParams> = {}
let pulses: Record<number, Pulse> = {}
/** Finished debriefs, by car, so switching between the two cars does not run one again. */
const debriefs = new Map<number, DebriefState>()
/** The setup screen's own options, put back when a race is left. */
let ownOptions: { seed: number; rainChance: number; driver: number } | null = null
let adviceWorker: Worker | null = null
let adviceId = 0
let debriefWorkers: Worker[] = []
let nextId = 1

function orderOf(pending: PendingOrder): CarOrder {
  return pending.pit ? { pit: pending.pit, mode: pending.mode } : { mode: pending.mode }
}

/** This lap's orders for every car the player runs. */
function lapOrders(cars: readonly number[], pendings: Record<number, PendingOrder>): LapOrders {
  const out: LapOrders = {}
  for (const car of cars) out[car] = orderOf(pendings[car] ?? NO_ORDER)
  return out
}

const keyOf = (orders: LapOrders) => JSON.stringify(orders)

function spawn(onMessage: (reply: PitWallReply) => void, onError: (message: string) => void): Worker {
  const worker = new Worker(new URL('../workers/pitwall.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<PitWallReply>) => onMessage(e.data)
  worker.onerror = (e) => onError(e.message || 'A pit-wall worker stopped unexpectedly.')
  return worker
}

function stopDebrief(): void {
  for (const worker of debriefWorkers) worker.terminate()
  debriefWorkers = []
}

/** Puts every car on the map for the present moment of the lap being shown. */
function writeFrame(driver: number): void {
  const { before, after, u } = anim
  if (!before || !after || !path || path.length < 4) return
  const count = after.cars.length
  if (fractions.length !== count) fractions = new Float32Array(count)
  let cars = pitwallFrame.cars
  if (!cars || cars.length !== count * 4) cars = new Float32Array(count * 4)
  trackFractions(before, after, u, fractions)
  const points = path.length / 2
  for (let i = 0; i < count; i++) {
    const o = i * 4
    let f = fractions[i]
    if (f < 0) {
      cars[o + 3] = 4 // not drawn
      continue
    }
    if (before.lap === 0) {
      // Before the start the field is lined up on the grid, and it strings out from there.
      f -= (before.cars[i].grid - 1) * 0.004 * (1 - u)
      f -= Math.floor(f)
    }
    const s = f * points
    const a = Math.floor(s) % points
    const b = (a + 1) % points
    const t = s - Math.floor(s)
    const ax = path[a * 2]
    const ay = path[a * 2 + 1]
    const bx = path[b * 2]
    const by = path[b * 2 + 1]
    cars[o] = ax + (bx - ax) * t
    cars[o + 1] = ay + (by - ay) * t
    cars[o + 2] = Math.atan2(by - ay, bx - ax)
    cars[o + 3] = 0
  }
  pitwallFrame.cars = cars
  pitwallFrame.leader = driver
  pitwallFrame.seq++
}

/**
 * Adds one car's decision points to the list. What concerns every car alike
 * (a safety car, rain) is listed once, not once per car.
 */
function addDecisions(list: CarDecision[], car: number, found: readonly Decision[]): void {
  for (const d of found) {
    const shared = d.type === 'safety' || d.type === 'rain'
    if (shared && list.some((x) => x.type === d.type)) continue
    list.push({ ...d, car: shared ? null : car })
  }
}

export const usePitWallStore = create<PitWallStore>((set, get) => {
  /** Works out the lap about to be shown, on a copy, with the orders as they stand. */
  function beginLap(race: RaceState): void {
    const { setup, pendings, cars, driver } = get()
    if (!setup) return
    const orders = lapOrders(cars, pendings)
    const after = cloneRace(race)
    stepLap(after, setup, orders)
    anim.before = race
    anim.after = after
    anim.key = keyOf(orders)
    anim.u = 0
    writeFrame(driver)
  }

  /** Ends the lap in progress: the orders are final, the race moves on a lap. */
  function commitLap(): void {
    const state = get()
    const { setup, race, cars } = state
    if (!setup || !race || state.phase !== 'race') return
    const team = cars.length > 1
    const orders = lapOrders(cars, state.pendings)
    let next: RaceState
    if (anim.after && anim.key === keyOf(orders)) {
      next = anim.after
    } else {
      next = cloneRace(race)
      stepLap(next, setup, orders)
    }
    const history = [...state.history, orders]

    const radio = [...state.radio]
    const said = new Set<string>()
    const plans: Record<number, Plan | null> = {}
    let decisions: CarDecision[] = []
    for (const car of cars) {
      const params = paramsBy[car]
      const before = pulses[car] ?? pulseOf(race, car, state.plans[car] ?? null)
      const plan = workingPlan(next, car, params)
      plans[car] = plan
      for (const message of radioFor(race, next, car, params, plan, before.windowOpen)) {
        // With two cars, race control and the weather are reported once.
        if (said.has(message.text)) continue
        said.add(message.text)
        radio.push(team && message.voice !== 'control' ? { ...message, car } : message)
      }
      addDecisions(decisions, car, decisionPoints(before, next, car, params, plan))
    }

    // With every car of ours out of the race there is nothing left to call: run to the flag.
    if (!next.finished && cars.every((car) => !next.cars[car].running)) {
      const rest = cloneRace(next)
      while (!rest.finished) {
        history.push({})
        stepLap(rest, setup, {})
      }
      next = rest
      decisions = []
    }

    const pendings: Record<number, PendingOrder> = {}
    for (const car of cars) {
      pulses[car] = pulseOf(next, car, plans[car])
      pendings[car] = { pit: null, mode: (state.pendings[car] ?? NO_ORDER).mode }
    }
    // A retired car has nothing to show: look at the one still running.
    let driver = state.driver
    if (!next.finished && !next.cars[driver].running) driver = cars.find((car) => next.cars[car].running) ?? driver

    const finished = next.finished
    const stop = finished || (state.autoPause && decisions.length > 0)
    set({
      race: next,
      history,
      driver,
      pendings,
      pending: pendings[driver] ?? NO_ORDER,
      plans,
      plan: plans[driver] ?? null,
      radio: radio.slice(-200),
      decisions: finished ? [] : decisions,
      advice: null,
      playing: stop ? false : state.playing,
      phase: finished ? 'finished' : 'race',
    })
    if (finished) {
      anim.before = race
      anim.after = next
      anim.u = 1
      writeFrame(driver)
      startDebrief(driver)
    } else {
      beginLap(next)
    }
  }

  /** Reviews one car's calls: every lap against the strategy engine, and the engine's own run of the race. */
  function startDebrief(car: number): void {
    const { setup, history } = get()
    if (!setup) return
    stopDebrief()
    const view = setupFor(setup, car)
    const { orders, others } = splitOrders(history, car)
    const laps = reviewableLaps(setup.laps)
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
    const reviewers = Math.min(4, Math.max(1, cores - 2), Math.max(1, laps.length))
    const id = nextId++
    let waiting = reviewers + 1
    const reviews: CallReview[] = []
    set({ debrief: { car, status: 'running', done: 0, total: laps.length + setup.laps, reviews: [], engine: null } })

    const fail = (message: string) => {
      stopDebrief()
      set({ debrief: NO_DEBRIEF, error: message })
    }
    const onReply = (reply: PitWallReply) => {
      if (reply.id !== id) return
      const { debrief } = get()
      if (reply.type === 'progress') {
        set({ debrief: { ...debrief, done: Math.min(debrief.total, debrief.done + 1) } })
        return
      }
      if (reply.type === 'reviews') reviews.push(...reply.reviews)
      const engine = reply.type === 'engine' ? reply.run : debrief.engine
      waiting--
      if (waiting === 0) {
        stopDebrief()
        reviews.sort((a, b) => a.lap - b.lap)
        const done: DebriefState = { car, status: 'done', done: debrief.total, total: debrief.total, reviews, engine }
        debriefs.set(car, done)
        set({ debrief: done })
      } else {
        set({ debrief: { ...debrief, engine } })
      }
    }

    for (let w = 0; w < reviewers; w++) {
      const worker = spawn(onReply, fail)
      debriefWorkers.push(worker)
      const request: PitWallRequest = {
        type: 'review',
        id,
        setup: view,
        orders,
        others,
        // Dealt out in turn, so every worker gets early laps and late ones.
        laps: laps.filter((_, i) => i % reviewers === w),
        samples: REVIEW_SAMPLES,
      }
      worker.postMessage(request)
    }
    const worker = spawn(onReply, fail)
    debriefWorkers.push(worker)
    const request: PitWallRequest = { type: 'engine', id, setup: view, others, samples: ENGINE_SAMPLES }
    worker.postMessage(request)
  }

  return {
    laps: null,
    rainChance: 0.3,
    driver: 8,
    bothCars: false,
    seed: 1,
    planIndex: 0,

    phase: 'setup',
    event: null,
    track: null,
    setup: null,
    race: null,
    cars: [],
    history: [],
    pendings: {},
    pending: NO_ORDER,
    playing: false,
    speed: 2,
    autoPause: true,
    decisions: [],
    radio: [],
    plans: {},
    plan: null,
    advice: null,
    debrief: NO_DEBRIEF,
    error: null,

    setOptions: (options) => set(options),

    start: (profile, laps, track, strategy, lapPath, eventRace) => {
      const now = get()
      if (!ownOptions) ownOptions = { seed: now.seed, rainChance: now.rainChance, driver: now.driver }
      const { seed, rainChance, driver } = eventRace ?? now
      const mate = eventRace
        ? eventRace.mate
        : now.bothCars
          ? { driver: teamMateOf(driver), strategy }
          : undefined
      stopDebrief()
      debriefs.clear()
      const setup = sessionSetup({
        profile,
        laps,
        seed,
        rainChance,
        driver,
        strategy,
        mate,
        grid: eventRace?.grid,
        tuning: eventRace?.tuning,
      })
      const cars = mate ? [driver, mate.driver] : [driver]
      const team = cars.length > 1
      const race = createRace(setup)
      path = lapPath
      paramsBy = {}
      pulses = {}

      const plans: Record<number, Plan | null> = {}
      const pendings: Record<number, PendingOrder> = {}
      const decisions: CarDecision[] = []
      const radio: RadioMessage[] = []
      for (const car of cars) {
        const params = carParams(setup, car)
        paramsBy[car] = params
        const me = race.cars[car]
        const plan = workingPlan(race, car, params)
        plans[car] = plan
        pendings[car] = { ...NO_ORDER }
        const kind = COMPOUNDS[me.compound].dry ? 'dry' : me.compound === 'inter' ? 'inter' : 'wet'
        // Measured against a quiet, dry grid, so a wet start or a wrong tyre is flagged before the lights.
        const calm: Pulse = {
          safetyCar: 'none',
          rain: 0,
          wanted: bestForConditions(race.weather.wetness) === kind ? kind : 'dry',
          wear: 0,
          windowOpen: true,
        }
        addDecisions(decisions, car, decisionPoints(calm, race, car, params, plan))
        pulses[car] = pulseOf(race, car, plan)
        const first = car === driver ? strategy : (mate?.strategy ?? strategy)
        const stops = (plan?.stops ?? first.stops).map((s) => `lap ${s.lap} for ${COMPOUNDS[s.compound].label.toLowerCase()}`)
        radio.push({
          lap: 0,
          voice: 'engineer',
          tone: 'info',
          ...(team ? { car } : {}),
          text:
            `Radio check, ${DRIVERS[car].name}. ${laps} laps, P${me.grid} on the grid, ${COMPOUNDS[me.compound].label.toLowerCase()} tyres.` +
            (stops.length > 0 ? ` First thought: stop on ${stops.join(', then ')}.` : ''),
        })
      }
      set({
        phase: 'race',
        event: eventRace?.event ?? null,
        seed,
        rainChance,
        driver,
        track,
        setup,
        race,
        cars,
        history: [],
        pendings,
        pending: pendings[driver],
        playing: false,
        decisions,
        radio,
        plans,
        plan: plans[driver] ?? null,
        advice: null,
        debrief: NO_DEBRIEF,
        error: null,
      })
      beginLap(race)
    },

    play: () => {
      if (get().phase === 'race') set({ playing: true, decisions: [] })
    },
    pause: () => set({ playing: false }),

    nextLap: () => {
      if (get().phase !== 'race') return
      set({ decisions: [] })
      commitLap()
    },

    setSpeed: (speed) => set({ speed }),
    setAutoPause: (autoPause) => set({ autoPause }),

    focus: (car) => {
      const state = get()
      if (!state.cars.includes(car) || car === state.driver) return
      set({ driver: car, pending: state.pendings[car] ?? NO_ORDER, plan: state.plans[car] ?? null })
      writeFrame(car)
      if (state.phase === 'finished') {
        const done = debriefs.get(car)
        if (done) {
          stopDebrief()
          set({ debrief: done })
        } else {
          startDebrief(car)
        }
      }
    },

    setPit: (pit, car) => {
      const state = get()
      const target = car ?? state.driver
      const pendings = { ...state.pendings, [target]: { ...(state.pendings[target] ?? NO_ORDER), pit } }
      set({ pendings, pending: pendings[state.driver] ?? NO_ORDER })
    },
    setMode: (mode, car) => {
      const state = get()
      const target = car ?? state.driver
      const pendings = { ...state.pendings, [target]: { ...(state.pendings[target] ?? NO_ORDER), mode } }
      set({ pendings, pending: pendings[state.driver] ?? NO_ORDER })
    },

    askEngineer: () => {
      const { setup, race, history, pendings, cars, driver, phase, advice } = get()
      if (!setup || !race || phase !== 'race') return
      const lap = race.lap + 1
      if (advice && advice.lap === lap && advice.car === driver) return
      const id = nextId++
      adviceId = id
      const team = cars.length > 1
      if (!adviceWorker) {
        adviceWorker = spawn(
          (reply) => {
            if (reply.type !== 'advice' || reply.id !== adviceId) return
            const now = get()
            if (!now.advice || now.advice.lap !== reply.lap || now.phase !== 'race') return
            const car = now.advice.car
            const stay = reply.values.find((v) => v.pit === null)
            const best = reply.values.find((v) => v.id === reply.best)
            let text = 'Stay out. Nothing to gain from a stop this lap.'
            if (best?.pit && stay) {
              const gain = stay.score - best.score
              text = `Box this lap for ${COMPOUNDS[best.pit].label.toLowerCase()} tyres: worth about ${gain.toFixed(1)} places over staying out.`
            } else if (stay) {
              const alt = reply.values.filter((v) => v.pit !== null).sort((a, b) => a.score - b.score)[0]
              if (alt?.pit) {
                const cost = alt.score - stay.score
                text =
                  cost > 0.2
                    ? `Stay out. Stopping now for ${COMPOUNDS[alt.pit].label.toLowerCase()} tyres would cost about ${cost.toFixed(1)} places.`
                    : `Stay out for now. A stop for ${COMPOUNDS[alt.pit].label.toLowerCase()} tyres is close, but not worth it yet.`
              }
            }
            set({
              advice: { car, lap: reply.lap, status: 'ready', values: reply.values, best: reply.best },
              radio: [
                ...now.radio,
                { lap: reply.lap - 1, voice: 'engineer', tone: 'info', text, ...(now.cars.length > 1 ? { car } : {}) },
              ],
            })
          },
          (message) => {
            adviceWorker?.terminate()
            adviceWorker = null
            set({ advice: null, error: message })
          },
        )
      }
      set({ advice: { car: driver, lap, status: 'thinking', values: [], best: '' } })
      const { orders, others } = splitOrders(history, driver)
      // What the other car is told for this lap matters: two stops on one lap means one of them queues.
      const coming: LapOrders = {}
      if (team) for (const car of cars) if (car !== driver) coming[car] = orderOf(pendings[car] ?? NO_ORDER)
      const request: PitWallRequest = {
        type: 'advise',
        id,
        setup: setupFor(setup, driver),
        orders,
        others,
        coming,
        mode: (pendings[driver] ?? NO_ORDER).mode,
        samples: ADVICE_SAMPLES,
      }
      adviceWorker.postMessage(request)
    },

    leave: () => {
      stopDebrief()
      debriefs.clear()
      anim.before = null
      anim.after = null
      pitwallFrame.cars = null
      pitwallFrame.seq++
      const own = ownOptions
      ownOptions = null
      set({
        ...(own ?? {}),
        phase: 'setup',
        event: null,
        race: null,
        setup: null,
        cars: [],
        history: [],
        pendings: {},
        pending: NO_ORDER,
        playing: false,
        decisions: [],
        radio: [],
        plans: {},
        plan: null,
        advice: null,
        debrief: NO_DEBRIEF,
      })
    },
  }
})

/**
 * Advances the lap on screen by `dt` seconds of real time. Called from the
 * screen's animation frame; does nothing unless a race is running.
 */
export function tickPitWall(dt: number): void {
  const state = usePitWallStore.getState()
  if (state.phase !== 'race' || !state.playing || !anim.after) return
  const seconds = PITWALL_SPEEDS.find((s) => s.value === state.speed)?.seconds ?? 3
  anim.u += Math.min(dt, 0.25) / seconds
  if (anim.u >= 1) state.nextLap()
  else writeFrame(state.driver)
}
