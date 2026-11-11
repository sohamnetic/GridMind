import { create } from 'zustand'
import type { TrackProfile } from '../core/profile/trackProfile'
import { optimise, type OptimiserProgress, type OptimiserResult } from '../core/strategy/optimiser'
import type { StudySetup } from '../core/strategy/monteCarlo'
import { MonteCarloPool, PoolCancelled } from '../workers/pool'

/** How many races each finalist gets. */
export const DEPTHS = [
  { id: 'quick', label: 'Quick', runs: 200 },
  { id: 'standard', label: 'Standard', runs: 600 },
  { id: 'deep', label: 'Deep', runs: 2000 },
] as const

export type DepthId = (typeof DEPTHS)[number]['id']

export interface OptimiserStudy {
  result: OptimiserResult
  trackId: string
  trackName: string
  /** Wall-clock time the study took (s) and workers it ran on. */
  seconds: number
  workers: number
}

interface OptimiserStore {
  /** Chosen race distance, or null to use the circuit's default. */
  laps: number | null
  rainChance: number
  /** The car being advised (index into DRIVERS). */
  driver: number
  depth: DepthId
  seed: number

  status: 'idle' | 'running'
  progress: OptimiserProgress | null
  error: string | null
  study: OptimiserStudy | null
  /** strategyKey of the plan shown in detail, or null for the best one. */
  selected: string | null

  setOptions: (options: Partial<Pick<OptimiserStore, 'laps' | 'rainChance' | 'driver' | 'depth' | 'seed'>>) => void
  run: (profile: TrackProfile, laps: number, track: { id: string; name: string }) => void
  cancel: () => void
  select: (key: string | null) => void
}

let pool: MonteCarloPool | null = null

export const useOptimiserStore = create<OptimiserStore>((set, get) => ({
  laps: null,
  rainChance: 0.2,
  driver: 8,
  depth: 'standard',
  seed: 1,

  status: 'idle',
  progress: null,
  error: null,
  study: null,
  selected: null,

  setOptions: (options) => set(options),

  run: (profile, laps, track) => {
    if (get().status === 'running') return
    const { rainChance, driver, depth, seed } = get()
    const setup: StudySetup = { profile, laps, rainChance, cars: 20, driver, seed }
    const runs = DEPTHS.find((d) => d.id === depth)?.runs ?? 600
    const started = performance.now()
    const mine = new MonteCarloPool(setup)
    pool = mine
    set({ status: 'running', progress: null, error: null })

    let lastReport = 0
    optimise(setup, { finalRuns: runs }, mine.evaluate, (progress) => {
      // Progress arrives a few hundred times a second; the screen needs it far less often.
      const now = performance.now()
      if (now - lastReport < 80 && progress.done < progress.total) return
      lastReport = now
      if (pool === mine) set({ progress })
    })
      .then((result) => {
        if (pool !== mine) return
        set({
          status: 'idle',
          progress: null,
          selected: null,
          study: {
            result,
            trackId: track.id,
            trackName: track.name,
            seconds: (performance.now() - started) / 1000,
            workers: mine.size,
          },
        })
      })
      .catch((error: unknown) => {
        if (pool !== mine) return
        const cancelled = error instanceof PoolCancelled
        set({
          status: 'idle',
          progress: null,
          error: cancelled ? null : error instanceof Error ? error.message : 'The optimiser stopped unexpectedly.',
        })
      })
      .finally(() => {
        mine.dispose()
        if (pool === mine) pool = null
      })
  },

  cancel: () => {
    const running = pool
    pool = null
    running?.cancel()
    set({ status: 'idle', progress: null })
  },

  select: (selected) => set({ selected }),
}))
