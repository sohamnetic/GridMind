import { del, get as idbGet, set as idbSet } from 'idb-keyval'
import { create } from 'zustand'
import { DRIVER_LAYOUT } from '../core/evolution/trainer'
import { lapPath } from '../core/pitwall/session'
import type { Strategy } from '../core/race/strategy'
import { circuitSpec } from '../core/season/circuits'
import { finishPractice } from '../core/season/practice'
import { finishQualifying, qualify } from '../core/season/qualifying'
import {
  buyUpgrade,
  createSeason,
  currentRound,
  nextRound,
  raceTuning,
  recordRace,
  roundProfile,
  simulateRace,
  type Distance,
} from '../core/season/season'
import {
  SEASON_VERSION,
  type Area,
  type CircuitSpec,
  type PracticePlan,
  type Risk,
  type Season,
} from '../core/season/types'
import { buildTrack } from '../core/track/build'
import { createPresets } from '../core/track/presets'
import type { TrackDef } from '../core/track/types'
import { loadDriver, trackKey } from './driverLibrary'
import { usePitWallStore } from './pitwallStore'

/**
 * The championship season in progress. There is one career at a time; it is
 * saved in this browser after every step, so it survives a reload.
 */

const KEY = 'gridmind:season'

export interface NewSeason {
  team: number
  seat: number
  rounds: number
  distance: Distance
  seed: number
  /** The player's own circuits to add to the calendar after the presets. */
  extra: TrackDef[]
}

interface SeasonStore {
  season: Season | null
  /** False until the saved career has been looked for. */
  loaded: boolean
  busy: boolean
  error: string | null

  hydrate: () => Promise<void>
  begin: (options: NewSeason) => Promise<void>
  /** Ends the career and forgets it. */
  abandon: () => void
  practice: (plan: PracticePlan) => void
  qualify: (risks?: [Risk, Risk]) => void
  finishQualifying: () => void
  /** Puts this round's race on the pit wall. Resolves to false if it could not start. */
  goToGrid: (strategy: Strategy) => Promise<boolean>
  /** Lets the engineer run this round's race, and enters the result. */
  simulate: (strategy: Strategy) => void
  buy: (area: Area) => void
  next: () => void
}

function isSeason(value: unknown): value is Season {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Partial<Season>
  return (
    s.version === SEASON_VERSION &&
    Array.isArray(s.rounds) &&
    s.rounds.length > 0 &&
    Array.isArray(s.results) &&
    Array.isArray(s.rivalPace) &&
    typeof s.round === 'number' &&
    typeof s.driver === 'number' &&
    typeof s.levels === 'object'
  )
}

function store(season: Season | null): void {
  const done = season ? idbSet(KEY, season) : del(KEY)
  // Without storage the career lasts for this visit only.
  done.catch(() => {})
}

/** A circuit for the calendar, measured from its trained drivers' best lap when it has one. */
async function specFor(def: TrackDef): Promise<CircuitSpec | null> {
  const saved = await loadDriver(def.id, DRIVER_LAYOUT.sizes)
  const lap =
    saved?.ghost && saved.snapshot.recordLap !== null && saved.trackKey === trackKey(def)
      ? { ghost: saved.ghost, recordLap: saved.snapshot.recordLap }
      : null
  return circuitSpec(def, lap)
}

export const useSeasonStore = create<SeasonStore>((set, get) => {
  const commit = (season: Season) => {
    set({ season, error: null })
    store(season)
  }
  /** Applies a step of the season, if there is a season to apply it to. */
  const step = (change: (season: Season) => Season) => {
    const { season } = get()
    if (!season) return
    const next = change(season)
    if (next !== season) commit(next)
  }

  return {
    season: null,
    loaded: false,
    busy: false,
    error: null,

    hydrate: async () => {
      if (get().loaded) return
      const saved: unknown = await idbGet(KEY).catch(() => null)
      // A career started while the saved one was still being looked for wins.
      if (get().season === null) set({ season: isSeason(saved) ? saved : null })
      set({ loaded: true })
    },

    begin: async (options) => {
      set({ busy: true, error: null })
      try {
        const defs = [...createPresets(), ...options.extra]
        const specs = (await Promise.all(defs.map(specFor))).filter((s): s is CircuitSpec => s !== null)
        if (specs.length === 0) throw new Error('No circuit could be raced on.')
        commit(
          createSeason({
            seed: options.seed,
            team: options.team,
            seat: options.seat,
            circuits: specs,
            rounds: options.rounds,
            distance: options.distance,
          }),
        )
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'The season could not be set up.',
        })
      } finally {
        set({ busy: false })
      }
    },

    abandon: () => {
      const pitwall = usePitWallStore.getState()
      if (pitwall.event) pitwall.leave()
      set({ season: null, error: null })
      store(null)
    },

    practice: (plan) => step((season) => finishPractice(season, plan)),
    qualify: (risks) => step((season) => qualify(season, risks)),
    finishQualifying: () => step(finishQualifying),

    goToGrid: async (strategy) => {
      const { season } = get()
      if (!season || season.stage !== 'race') return false
      const round = currentRound(season)
      const track = buildTrack(round.def)
      if (!track) {
        set({ error: `${round.name} could not be built.` })
        return false
      }
      set({ busy: true, error: null })
      const saved = await loadDriver(round.trackId, DRIVER_LAYOUT.sizes).catch(() => null)
      const ghost = saved?.ghost && saved.trackKey === trackKey(round.def) ? saved.ghost : null
      set({ busy: false })
      usePitWallStore
        .getState()
        .start(
          roundProfile(round),
          round.laps,
          { id: round.trackId, name: round.name },
          strategy,
          lapPath(track, ghost),
          {
            event: {
              kind: 'season',
              season: season.seed,
              round: season.round,
              def: round.def,
              title: `Round ${season.round + 1} of ${season.rounds.length}: ${round.name}`,
            },
            seed: round.seed,
            rainChance: round.rainChance,
            driver: season.driver,
            grid: season.qualifying?.grid ?? undefined,
            tuning: raceTuning(season),
          },
        )
      return true
    },

    simulate: (strategy) => step((season) => recordRace(season, simulateRace(season, strategy), true)),
    buy: (area) => step((season) => buyUpgrade(season, area)),
    next: () => step(nextRound),
  }
})

// A season's race is run on the pit wall. The moment it reaches the flag, the
// result goes into the season it came from.
usePitWallStore.subscribe((state, previous) => {
  if (state.phase !== 'finished' || previous.phase === 'finished') return
  const { event, race } = state
  if (!event || event.kind !== 'season' || !race) return
  const { season } = useSeasonStore.getState()
  if (!season || season.seed !== event.season || season.round !== event.round || season.stage !== 'race') return
  const next = recordRace(season, race, false)
  if (next !== season) {
    useSeasonStore.setState({ season: next })
    store(next)
  }
})
