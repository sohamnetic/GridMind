import { create } from 'zustand'
import { type CallReview, type EngineRun, reviewableLaps } from '../core/pitwall/debrief'
import { radioFor, type RadioMessage } from '../core/pitwall/radio'
import type { Plan } from '../core/pitwall/replan'
import type { CallValue } from '../core/pitwall/rollout'
import {
  decisionPoints,
  pulseOf,
  sessionSetup,
  trackFractions,
  workingPlan,
  type Decision,
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
  /** The lap the advice is for. */
  lap: number
  status: 'thinking' | 'ready'
  values: CallValue[]
  best: string
}

export interface DebriefState {
  status: 'idle' | 'running' | 'done'
  done: number
  total: number
  reviews: CallReview[]
  engine: EngineRun | null
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
  grid?: number[]
  tuning?: CarTuning[]
}

const NO_DEBRIEF: DebriefState = { status: 'idle', done: 0, total: 0, reviews: [], engine: null }

interface PitWallStore {
  // Options for the next race.
  laps: number | null
  rainChance: number
  driver: number
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
  /** The order given for every lap run so far. */
  orders: CarOrder[]
  pending: PendingOrder
  playing: boolean
  speed: PitWallSpeed
  autoPause: boolean
  /** Why the clock is stopped, when it was stopped for a decision. */
  decisions: Decision[]
  radio: RadioMessage[]
  /** The best plan from here, for the pit window. */
  plan: Plan | null
  advice: Advice | null
  debrief: DebriefState
  error: string | null

  setOptions: (options: Partial<Pick<PitWallStore, 'laps' | 'rainChance' | 'driver' | 'seed' | 'planIndex'>>) => void
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
  setPit: (compound: Compound | null) => void
  setMode: (mode: DriveMode) => void
  askEngineer: () => void
  /** Back to the setup screen. */
  leave: () => void
}

// ---------- State that changes every frame, kept out of React ----------

const anim: { before: RaceState | null; after: RaceState | null; order: PendingOrder | null; u: number } = {
  before: null,
  after: null,
  order: null,
  u: 0,
}
let path: Float32Array | null = null
let fractions = new Float32Array(0)
let params: RaceParams | null = null
let pulse: Pulse | null = null
/** The setup screen's own options, put back when an event's race is left. */
let ownOptions: { seed: number; rainChance: number; driver: number } | null = null
let adviceWorker: Worker | null = null
let debriefWorkers: Worker[] = []
let nextId = 1

function orderOf(pending: PendingOrder): CarOrder {
  return pending.pit ? { pit: pending.pit, mode: pending.mode } : { mode: pending.mode }
}

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

export const usePitWallStore = create<PitWallStore>((set, get) => {
  /** Works out the lap about to be shown, on a copy, with the order as it stands. */
  function beginLap(race: RaceState): void {
    const { setup, pending, driver } = get()
    if (!setup) return
    const after = cloneRace(race)
    stepLap(after, setup, { [driver]: orderOf(pending) })
    anim.before = race
    anim.after = after
    anim.order = { ...pending }
    anim.u = 0
    writeFrame(driver)
  }

  /** Ends the lap in progress: the order is final, the race moves on a lap. */
  function commitLap(): void {
    const state = get()
    const { setup, race, pending, driver } = state
    if (!setup || !race || !params || state.phase !== 'race') return
    const order = orderOf(pending)
    let next: RaceState
    if (anim.after && anim.order && anim.order.pit === pending.pit && anim.order.mode === pending.mode) {
      next = anim.after
    } else {
      next = cloneRace(race)
      stepLap(next, setup, { [driver]: order })
    }
    const orders = [...state.orders, order]
    const before = pulse ?? pulseOf(race, driver, state.plan)
    const me = next.cars[driver]
    const plan = workingPlan(next, driver, params)
    const radio = [...state.radio, ...radioFor(race, next, driver, params, plan, before.windowOpen)]
    let decisions = decisionPoints(before, next, driver, params, plan)

    // With the car out of the race there is nothing left to call: run to the flag.
    if (!me.running && !next.finished) {
      const rest = cloneRace(next)
      while (!rest.finished) {
        orders.push({})
        stepLap(rest, setup, {})
      }
      next = rest
      decisions = []
    }

    pulse = pulseOf(next, driver, plan)
    const finished = next.finished
    const stop = finished || (state.autoPause && decisions.length > 0)
    set({
      race: next,
      orders,
      pending: { pit: null, mode: pending.mode },
      plan,
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
      startDebrief()
    } else {
      beginLap(next)
    }
  }

  function startDebrief(): void {
    const { setup, orders } = get()
    if (!setup) return
    stopDebrief()
    const laps = reviewableLaps(setup.laps)
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
    const reviewers = Math.min(4, Math.max(1, cores - 2), Math.max(1, laps.length))
    const id = nextId++
    let waiting = reviewers + 1
    const reviews: CallReview[] = []
    set({ debrief: { status: 'running', done: 0, total: laps.length + setup.laps, reviews: [], engine: null } })

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
        set({ debrief: { status: 'done', done: debrief.total, total: debrief.total, reviews, engine } })
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
        setup,
        orders,
        // Dealt out in turn, so every worker gets early laps and late ones.
        laps: laps.filter((_, i) => i % reviewers === w),
        samples: REVIEW_SAMPLES,
      }
      worker.postMessage(request)
    }
    const worker = spawn(onReply, fail)
    debriefWorkers.push(worker)
    const request: PitWallRequest = { type: 'engine', id, setup, samples: ENGINE_SAMPLES }
    worker.postMessage(request)
  }

  return {
    laps: null,
    rainChance: 0.3,
    driver: 8,
    seed: 1,
    planIndex: 0,

    phase: 'setup',
    event: null,
    track: null,
    setup: null,
    race: null,
    orders: [],
    pending: { pit: null, mode: 'normal' },
    playing: false,
    speed: 2,
    autoPause: true,
    decisions: [],
    radio: [],
    plan: null,
    advice: null,
    debrief: NO_DEBRIEF,
    error: null,

    setOptions: (options) => set(options),

    start: (profile, laps, track, strategy, lapPath, eventRace) => {
      const now = get()
      if (eventRace && !ownOptions) ownOptions = { seed: now.seed, rainChance: now.rainChance, driver: now.driver }
      const { seed, rainChance, driver } = eventRace ?? now
      stopDebrief()
      const setup = sessionSetup({
        profile,
        laps,
        seed,
        rainChance,
        driver,
        strategy,
        grid: eventRace?.grid,
        tuning: eventRace?.tuning,
      })
      const race = createRace(setup)
      params = carParams(setup, driver)
      path = lapPath
      const me = race.cars[driver]
      const plan = workingPlan(race, driver, params)
      const kind = COMPOUNDS[me.compound].dry ? 'dry' : me.compound === 'inter' ? 'inter' : 'wet'
      // Measured against a quiet, dry grid, so a wet start or a wrong tyre is flagged before the lights.
      const calm: Pulse = { safetyCar: 'none', rain: 0, wanted: kind, wear: 0, windowOpen: true }
      const decisions = decisionPoints(
        { ...calm, wanted: bestForConditions(race.weather.wetness) === kind ? kind : 'dry' },
        race,
        driver,
        params,
        plan,
      )
      pulse = pulseOf(race, driver, plan)
      const stops = (plan?.stops ?? strategy.stops).map((s) => `lap ${s.lap} for ${COMPOUNDS[s.compound].label.toLowerCase()}`)
      const radio: RadioMessage[] = [
        {
          lap: 0,
          voice: 'engineer',
          tone: 'info',
          text:
            `Radio check, ${DRIVERS[driver].name}. ${laps} laps, P${me.grid} on the grid, ${COMPOUNDS[me.compound].label.toLowerCase()} tyres.` +
            (stops.length > 0 ? ` First thought: stop on ${stops.join(', then ')}.` : ''),
        },
      ]
      set({
        phase: 'race',
        event: eventRace?.event ?? null,
        seed,
        rainChance,
        driver,
        track,
        setup,
        race,
        orders: [],
        pending: { pit: null, mode: 'normal' },
        playing: false,
        decisions,
        radio,
        plan,
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
    setPit: (pit) => set({ pending: { ...get().pending, pit } }),
    setMode: (mode) => set({ pending: { ...get().pending, mode } }),

    askEngineer: () => {
      const { setup, race, orders, pending, phase, advice } = get()
      if (!setup || !race || phase !== 'race') return
      const lap = race.lap + 1
      if (advice && advice.lap === lap) return
      const id = nextId++
      if (!adviceWorker) {
        adviceWorker = spawn(
          (reply) => {
            if (reply.type !== 'advice') return
            const now = get()
            if (!now.advice || now.advice.lap !== reply.lap || now.phase !== 'race') return
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
              advice: { lap: reply.lap, status: 'ready', values: reply.values, best: reply.best },
              radio: [...now.radio, { lap: reply.lap - 1, voice: 'engineer', tone: 'info', text }],
            })
          },
          (message) => {
            adviceWorker?.terminate()
            adviceWorker = null
            set({ advice: null, error: message })
          },
        )
      }
      set({ advice: { lap, status: 'thinking', values: [], best: '' } })
      const request: PitWallRequest = { type: 'advise', id, setup, orders, mode: pending.mode, samples: ADVICE_SAMPLES }
      adviceWorker.postMessage(request)
    },

    leave: () => {
      stopDebrief()
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
        orders: [],
        playing: false,
        decisions: [],
        radio: [],
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
