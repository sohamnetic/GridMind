import { create } from 'zustand'
import { DRIVER_LAYOUT, type GenerationStats } from '../core/evolution/trainer'
import type { TrackDef } from '../core/track/types'
import type {
  TrainingEvent,
  TrainingRequest,
  TrainingSnapshot,
  TrainingSpeed,
} from '../workers/trainingProtocol'
import { deleteDriver, loadDriver, storeDriver, trackKey, type SavedDriver } from './driverLibrary'

export type RunStatus = 'idle' | 'starting' | 'running' | 'paused'
export type SpeedMode = '1x' | '8x' | 'turbo'

const SPEEDS: Record<SpeedMode, TrainingSpeed> = { '1x': 1, '8x': 8, turbo: 'turbo' }
export const POPULATION_OPTIONS = [60, 100, 150, 250] as const
const HISTORY_LIMIT = 5000
const AUTOSAVE_EVERY = 10

/**
 * Latest car positions from the worker. Deliberately outside the store: it
 * changes ~30 times a second and only the canvas reads it, once per frame.
 */
export const liveFrame = {
  seq: 0,
  generation: 0,
  time: 0,
  running: 0,
  leader: 0,
  cars: null as Float32Array | null,
}

export interface SavedSummary {
  generation: number
  recordLap: number | null
  savedAt: number
  trackKey: string
}

interface EvolutionState {
  status: RunStatus
  speed: SpeedMode
  populationSize: number
  seed: number
  /** Track (and geometry fingerprint) the current run is training on. */
  sessionDef: TrackDef | null
  sessionTrackKey: string | null
  history: GenerationStats[]
  recordLap: number | null
  /** Racing line of the best driver so far (x, y, speed triplets). */
  ghost: Float32Array | null
  /** Stored driver for the track last passed to refreshSaved. */
  saved: SavedSummary | null
  error: string | null

  setSpeed: (speed: SpeedMode) => void
  setPopulationSize: (size: number) => void
  setSeed: (seed: number) => void
  refreshSaved: (trackId: string) => Promise<void>
  /**
   * Starts training on a track.
   *  - 'fresh': new random drivers
   *  - 'saved': continue the stored drivers for this track
   *  - 'adopt': carry the current population over to this (edited) track
   */
  start: (def: TrackDef, mode: 'fresh' | 'saved' | 'adopt') => Promise<void>
  pause: () => void
  resume: () => void
  reset: () => void
  discardSaved: (trackId: string) => Promise<void>
  setFramesEnabled: (enabled: boolean) => void
}

// ---- Worker session (module-level: it outlives the Driver Evolution view) ----

let worker: Worker | null = null
let snapshotWaiters: ((snapshot: TrainingSnapshot) => void)[] = []

function send(message: TrainingRequest): void {
  worker?.postMessage(message)
}

function stopWorker(): void {
  worker?.terminate()
  worker = null
  snapshotWaiters = []
}

function requestSnapshot(): Promise<TrainingSnapshot | null> {
  if (!worker) return Promise.resolve(null)
  return new Promise((resolve) => {
    snapshotWaiters.push(resolve)
    send({ type: 'snapshot' })
    // A worker that died must not leave the caller waiting forever.
    setTimeout(() => resolve(null), 4000)
  })
}

export const useEvolutionStore = create<EvolutionState>((set, get) => {
  const save = async (): Promise<void> => {
    const def = get().sessionDef
    if (!def) return
    const snapshot = await requestSnapshot()
    if (!snapshot || get().sessionDef !== def) return
    const state = get()
    const driver: SavedDriver = {
      version: 1,
      trackId: def.id,
      trackKey: trackKey(def),
      layout: [...DRIVER_LAYOUT.sizes],
      populationSize: state.populationSize,
      seed: state.seed,
      snapshot,
      history: state.history,
      ghost: state.ghost,
      savedAt: Date.now(),
    }
    if (await storeDriver(driver)) {
      set({
        saved: {
          generation: snapshot.generation,
          recordLap: snapshot.recordLap,
          savedAt: driver.savedAt,
          trackKey: driver.trackKey,
        },
      })
    }
  }

  const onEvent = (event: TrainingEvent): void => {
    switch (event.type) {
      case 'ready':
        if (get().status === 'starting') {
          set({ status: 'running' })
          send({ type: 'run', speed: SPEEDS[get().speed] })
        }
        break
      case 'frame':
        liveFrame.seq++
        liveFrame.generation = event.generation
        liveFrame.time = event.time
        liveFrame.running = event.running
        liveFrame.leader = event.leader
        liveFrame.cars = event.cars
        break
      case 'generation': {
        const { stats, ghost } = event
        set((s) => ({
          history: [...s.history, stats].slice(-HISTORY_LIMIT),
          recordLap: stats.recordLap,
          ghost: ghost ?? s.ghost,
        }))
        if (stats.newRecord || stats.generation % AUTOSAVE_EVERY === 0) void save()
        break
      }
      case 'snapshot': {
        const waiters = snapshotWaiters
        snapshotWaiters = []
        for (const resolve of waiters) resolve(event.snapshot)
        break
      }
      case 'error':
        stopWorker()
        set({ status: 'idle', error: event.message })
        break
    }
  }

  return {
    status: 'idle',
    speed: '8x',
    populationSize: 150,
    seed: 1,
    sessionDef: null,
    sessionTrackKey: null,
    history: [],
    recordLap: null,
    ghost: null,
    saved: null,
    error: null,

    setSpeed: (speed) => {
      set({ speed })
      if (get().status === 'running') send({ type: 'run', speed: SPEEDS[speed] })
    },
    setPopulationSize: (populationSize) => set({ populationSize }),
    setSeed: (seed) => set({ seed }),

    refreshSaved: async (trackId) => {
      const driver = await loadDriver(trackId, DRIVER_LAYOUT.sizes)
      set({
        saved: driver
          ? {
              generation: driver.snapshot.generation,
              recordLap: driver.snapshot.recordLap,
              savedAt: driver.savedAt,
              trackKey: driver.trackKey,
            }
          : null,
      })
    },

    start: async (def, mode) => {
      let resume: TrainingSnapshot | undefined
      let history: GenerationStats[] = []
      let ghost: Float32Array | null = null
      let { populationSize, seed } = get()

      if (mode === 'saved') {
        const driver = await loadDriver(def.id, DRIVER_LAYOUT.sizes)
        if (driver) {
          resume = driver.snapshot
          history = driver.history
          ghost = driver.ghost
          populationSize = driver.populationSize
          seed = driver.seed
        }
      } else if (mode === 'adopt') {
        const snapshot = await requestSnapshot()
        if (snapshot) {
          // Lap times from the old layout mean nothing on the new one.
          resume = { ...snapshot, recordLap: null, recordGenome: null }
          history = get().history
        }
      }

      stopWorker()
      liveFrame.cars = null
      liveFrame.seq++
      const sessionDef = structuredClone(def)
      worker = new Worker(new URL('../workers/training.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<TrainingEvent>) => onEvent(e.data)
      worker.onerror = (e) => {
        stopWorker()
        set({ status: 'idle', error: e.message || 'The training worker stopped unexpectedly.' })
      }

      set({
        status: 'starting',
        error: null,
        populationSize,
        seed,
        sessionDef,
        sessionTrackKey: trackKey(def),
        history,
        ghost: mode === 'adopt' ? null : ghost,
        recordLap: resume?.recordLap ?? null,
      })
      send({ type: 'init', def: sessionDef, populationSize, seed, resume })
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
      send({ type: 'run', speed: SPEEDS[get().speed] })
    },

    reset: () => {
      stopWorker()
      liveFrame.cars = null
      liveFrame.seq++
      set({
        status: 'idle',
        sessionDef: null,
        sessionTrackKey: null,
        history: [],
        recordLap: null,
        ghost: null,
        error: null,
      })
    },

    discardSaved: async (trackId) => {
      await deleteDriver(trackId)
      set({ saved: null })
    },

    setFramesEnabled: (enabled) => send({ type: 'frames', enabled }),
  }
})
