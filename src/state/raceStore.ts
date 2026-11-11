import { create } from 'zustand'
import type { RaceEvent } from '../core/evolution/raceSim'
import { DRIVER_LAYOUT } from '../core/evolution/trainer'
import { widenPopulation, type TrafficStats } from '../core/evolution/trafficTrainer'
import type { GridOrder } from '../core/race/grid'
import type { TrackDef } from '../core/track/types'
import type { RaceMessage, RaceRequest, RaceTiming, TrafficSnapshot } from '../workers/raceProtocol'
import type { TrainingSpeed } from '../workers/trainingProtocol'
import { loadDriver, soloDrivers, storeDriver, trackKey } from './driverLibrary'
import { liveFrame, useEvolutionStore } from './evolutionStore'

export type RaceMode = 'none' | 'train' | 'race'
export type RaceStatus = 'idle' | 'starting' | 'running' | 'paused' | 'finished'

const AUTOSAVE_EVERY = 10
const EVENT_LIMIT = 60

/** Latest car positions of the race being watched; read by the canvas once per frame. */
export const raceFrame = {
  seq: 0,
  generation: 0,
  time: 0,
  running: 0,
  leader: 0,
  cars: null as Float32Array | null,
}

/** What is stored for a track, as far as racing is concerned. */
export interface DriverSummary {
  soloGeneration: number
  recordLap: number | null
  /** Generations of racecraft training, or null if there has been none. */
  trafficGeneration: number | null
  trackKey: string
}

interface RaceState {
  mode: RaceMode
  status: RaceStatus
  speed: TrainingSpeed
  /** Track the current training run or race is on. */
  def: TrackDef | null
  history: TrafficStats[]
  timing: RaceTiming | null
  /** Race events, newest first. */
  events: RaceEvent[]
  cars: number
  laps: number
  grid: GridOrder
  /** Stored drivers for the track last passed to refresh. */
  drivers: DriverSummary | null
  error: string | null

  refresh: (trackId: string) => Promise<void>
  setSpeed: (speed: TrainingSpeed) => void
  setRaceOptions: (options: Partial<Pick<RaceState, 'cars' | 'laps' | 'grid'>>) => void
  /** Starts (or, with `resume`, continues) racecraft training for a track. */
  startTraining: (def: TrackDef, resume: boolean) => Promise<void>
  startRace: (def: TrackDef) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  setFramesEnabled: (enabled: boolean) => void
}

let worker: Worker | null = null
let snapshotWaiters: ((snapshot: TrafficSnapshot | null) => void)[] = []

function send(message: RaceRequest): void {
  worker?.postMessage(message)
}

function stopWorker(): void {
  worker?.terminate()
  worker = null
  for (const resolve of snapshotWaiters) resolve(null)
  snapshotWaiters = []
}

function requestSnapshot(): Promise<TrafficSnapshot | null> {
  if (!worker) return Promise.resolve(null)
  return new Promise((resolve) => {
    snapshotWaiters.push(resolve)
    send({ type: 'snapshot' })
    setTimeout(() => resolve(null), 4000)
  })
}

export const useRaceStore = create<RaceState>((set, get) => {
  const save = async (): Promise<void> => {
    const def = get().def
    if (!def || get().mode !== 'train') return
    const snapshot = await requestSnapshot()
    if (!snapshot || get().def !== def) return
    const driver = await loadDriver(def.id, DRIVER_LAYOUT.sizes)
    if (!driver) return
    driver.traffic = { snapshot, history: get().history }
    if (await storeDriver(driver)) void get().refresh(def.id)
  }

  const onMessage = (msg: RaceMessage): void => {
    switch (msg.type) {
      case 'ready':
        if (get().status === 'starting') {
          set({ status: 'running' })
          send({ type: 'run', speed: get().speed })
        }
        break
      case 'frame': {
        // Training heats are shown in the Driver Evolution view, races in the Race view.
        const target = msg.mode === 'train' ? liveFrame : raceFrame
        target.seq++
        target.generation = msg.generation
        target.time = msg.time
        target.running = msg.running
        target.leader = msg.leader
        target.cars = msg.cars
        break
      }
      case 'generation':
        set((s) => ({ history: [...s.history, msg.stats].slice(-5000) }))
        if (msg.stats.generation % AUTOSAVE_EVERY === 0) void save()
        break
      case 'snapshot': {
        const waiters = snapshotWaiters
        snapshotWaiters = []
        for (const resolve of waiters) resolve(msg.snapshot)
        break
      }
      case 'timing':
        set((s) => ({
          timing: msg.timing,
          events: [...msg.timing.events.slice().reverse(), ...s.events].slice(0, EVENT_LIMIT),
          status: msg.timing.finished ? 'finished' : s.status,
        }))
        break
      case 'error':
        stopWorker()
        set({ mode: 'none', status: 'idle', error: msg.message })
        break
    }
  }

  const launch = (): Worker => {
    stopWorker()
    worker = new Worker(new URL('../workers/race.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<RaceMessage>) => onMessage(e.data)
    worker.onerror = (e) => {
      stopWorker()
      set({ mode: 'none', status: 'idle', error: e.message || 'The race worker stopped unexpectedly.' })
    }
    return worker
  }

  return {
    mode: 'none',
    status: 'idle',
    speed: 8,
    def: null,
    history: [],
    timing: null,
    events: [],
    cars: 12,
    laps: 5,
    grid: 'mixed',
    drivers: null,
    error: null,

    refresh: async (trackId) => {
      const driver = await loadDriver(trackId, DRIVER_LAYOUT.sizes)
      set({
        drivers: driver
          ? {
              soloGeneration: driver.snapshot.generation,
              recordLap: driver.snapshot.recordLap,
              trafficGeneration: driver.traffic?.snapshot.generation ?? null,
              trackKey: driver.trackKey,
            }
          : null,
      })
    },

    setSpeed: (speed) => {
      set({ speed })
      if (get().status === 'running') send({ type: 'run', speed })
    },

    setRaceOptions: (options) => set(options),

    startTraining: async (def, resume) => {
      // Lap training and racecraft training share the drivers, so the first is
      // paused and written to storage before the second reads it.
      const lap = useEvolutionStore.getState()
      if (lap.status === 'running') lap.pause()
      if (lap.status !== 'idle') await lap.saveNow()

      const driver = await loadDriver(def.id, DRIVER_LAYOUT.sizes)
      if (!driver) {
        set({ error: 'Train drivers to lap this circuit first.' })
        return
      }
      const previous = resume ? driver.traffic : undefined
      launch()
      liveFrame.cars = null
      liveFrame.seq++
      set({
        mode: 'train',
        status: 'starting',
        speed: get().mode === 'train' ? get().speed : 8,
        def: structuredClone(def),
        history: previous?.history ?? [],
        timing: null,
        events: [],
        error: null,
      })
      send({
        type: 'train',
        def,
        solo: soloDrivers(driver),
        seed: driver.seed,
        resume: previous?.snapshot,
      })
    },

    startRace: async (def) => {
      // Stop a racecraft run cleanly first so its latest drivers are the ones that race.
      if (get().mode === 'train') {
        send({ type: 'pause' })
        await save()
      }
      const driver = await loadDriver(def.id, DRIVER_LAYOUT.sizes)
      if (!driver) {
        set({ error: 'Train drivers on this circuit before racing them.' })
        return
      }
      // Drivers that never trained in traffic can still race; they just ignore each other.
      const drivers = driver.traffic?.snapshot.ranked ?? widenPopulation(DRIVER_LAYOUT, soloDrivers(driver))
      const { cars, laps, grid } = get()
      launch()
      raceFrame.cars = null
      raceFrame.seq++
      set({
        mode: 'race',
        status: 'starting',
        // A race is for watching: never start one at a training speed.
        speed: get().mode === 'race' && typeof get().speed === 'number' ? get().speed : 3,
        def: structuredClone(def),
        timing: null,
        events: [],
        error: null,
      })
      send({ type: 'race', def, drivers, cars, laps, grid, seed: Date.now() % 100000 })
    },

    pause: () => {
      if (get().status !== 'running') return
      send({ type: 'pause' })
      set({ status: 'paused' })
      void save()
    },

    resume: () => {
      if (get().status !== 'paused') return
      set({ status: 'running' })
      send({ type: 'run', speed: get().speed })
    },

    stop: () => {
      const wasTraining = get().mode === 'train'
      const finish = () => {
        stopWorker()
        if (wasTraining) {
          liveFrame.cars = null
          liveFrame.seq++
        } else {
          raceFrame.cars = null
          raceFrame.seq++
        }
        set({ mode: 'none', status: 'idle', def: null, timing: null, events: [], history: [] })
      }
      // Keep what a training run learned before letting the worker go.
      if (wasTraining) {
        send({ type: 'pause' })
        void save().then(finish)
      } else {
        finish()
      }
    },

    setFramesEnabled: (enabled) => send({ type: 'frames', enabled }),
  }
})

/** Fingerprint check used by the screens to warn about drivers trained on an older layout. */
export function driversMatch(summary: DriverSummary | null, def: TrackDef): boolean {
  return summary !== null && summary.trackKey === trackKey(def)
}
