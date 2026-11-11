import { create } from 'zustand'
import type { TrackProfile } from '../core/profile/trackProfile'
import { runRace, type RaceState } from '../core/race/engine'
import { raceParams, rankStrategies, type RankedStrategy } from '../core/race/strategy'

/** Race distances offered, in laps. */
export const LAP_OPTIONS = [20, 30, 40, 50, 60, 70] as const

/** A sensible race distance for a circuit: about 150 km, within the options offered. */
export function defaultLaps(lapLength: number): number {
  const ideal = 150_000 / Math.max(lapLength, 1)
  return LAP_OPTIONS.reduce((best, n) => (Math.abs(n - ideal) < Math.abs(best - ideal) ? n : best), LAP_OPTIONS[0])
}

export interface FullRaceResult {
  race: RaceState
  /** Dry strategies ranked by clean-air time before the race. */
  ranked: RankedStrategy[]
  trackId: string
  trackName: string
  baseLap: number
}

interface FullRaceStore {
  /** Chosen race distance, or null to use the circuit's default. */
  laps: number | null
  rainChance: number
  seed: number
  result: FullRaceResult | null
  /** Lap the timing and log are showing (0 = the grid). */
  viewLap: number
  /** Driver highlighted in the charts. */
  selected: number | null

  setOptions: (options: Partial<Pick<FullRaceStore, 'laps' | 'rainChance' | 'seed'>>) => void
  run: (profile: TrackProfile, laps: number, track: { id: string; name: string }) => void
  setViewLap: (lap: number) => void
  select: (driver: number | null) => void
}

/**
 * The lap-level race takes about a millisecond, so it runs on the main thread
 * the moment it is asked for; the store only keeps the result between visits.
 */
export const useFullRaceStore = create<FullRaceStore>((set, get) => ({
  laps: null,
  rainChance: 0.2,
  seed: 1,
  result: null,
  viewLap: 0,
  selected: null,

  setOptions: (options) => set(options),

  run: (profile, laps, track) => {
    const { seed, rainChance } = get()
    const ranked = rankStrategies(raceParams(profile, laps))
    const race = runRace({
      profile,
      laps,
      seed,
      rainChance,
      cars: 20,
      plans: ranked.map((r) => r.strategy),
    })
    set({
      result: { race, ranked, trackId: track.id, trackName: track.name, baseLap: profile.baseLapTime },
      viewLap: laps,
      selected: null,
    })
  },

  setViewLap: (viewLap) => set({ viewLap }),
  select: (selected) => set({ selected }),
}))
