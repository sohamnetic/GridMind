import { create } from 'zustand'
import { createPresets } from '../core/track/presets'
import { createTrack, newTrackId } from '../core/track/serialize'
import type { TrackDef } from '../core/track/types'
import { loadSavedTracks, loadWorkingTrack, storeSavedTracks, storeWorkingTrack } from './trackLibrary'

export type StudioTool = 'edit' | 'draw' | 'start' | 'sector1' | 'sector2' | 'drs' | 'pit' | 'drive'

const HISTORY_LIMIT = 100

interface StudioState {
  def: TrackDef
  selected: number | null
  tool: StudioTool
  past: TrackDef[]
  future: TrackDef[]
  saved: TrackDef[]
  /** Bumped whenever a different track is loaded, so the view can re-fit. */
  loadCount: number

  setTool: (tool: StudioTool) => void
  select: (index: number | null) => void
  /**
   * Replaces the track. 'push' records the previous state for undo; 'none' is
   * for the intermediate frames of a drag, after its first frame pushed.
   */
  update: (def: TrackDef, history?: 'push' | 'none') => void
  undo: () => void
  redo: () => void
  loadTrack: (def: TrackDef) => void
  newTrack: () => void
  hydrateLibrary: () => Promise<void>
  saveCurrent: () => Promise<void>
  deleteSaved: (id: string) => Promise<void>
}

function initialTrack(): TrackDef {
  return loadWorkingTrack() ?? createPresets()[0]
}

export const useStudioStore = create<StudioState>((set, get) => ({
  def: initialTrack(),
  selected: null,
  tool: 'edit',
  past: [],
  future: [],
  saved: [],
  loadCount: 0,

  setTool: (tool) => set({ tool }),
  select: (selected) => set({ selected }),

  update: (def, history = 'push') => {
    const state = get()
    if (history === 'push') {
      set({ def, past: [...state.past, state.def].slice(-HISTORY_LIMIT), future: [] })
    } else {
      set({ def })
    }
    storeWorkingTrack(def)
  },

  undo: () => {
    const { past, future, def } = get()
    const previous = past[past.length - 1]
    if (!previous) return
    set({ def: previous, past: past.slice(0, -1), future: [def, ...future], selected: null })
    storeWorkingTrack(previous)
  },

  redo: () => {
    const { past, future, def } = get()
    const next = future[0]
    if (!next) return
    set({ def: next, past: [...past, def], future: future.slice(1), selected: null })
    storeWorkingTrack(next)
  },

  loadTrack: (def) => {
    const copy = structuredClone(def)
    set((s) => ({
      def: copy,
      past: [],
      future: [],
      selected: null,
      tool: 'edit',
      loadCount: s.loadCount + 1,
    }))
    storeWorkingTrack(copy)
  },

  newTrack: () => {
    const def = createTrack('Untitled circuit')
    set((s) => ({
      def,
      past: [],
      future: [],
      selected: null,
      tool: 'draw',
      loadCount: s.loadCount + 1,
    }))
    storeWorkingTrack(def)
  },

  hydrateLibrary: async () => {
    set({ saved: await loadSavedTracks() })
  },

  saveCurrent: async () => {
    let { def } = get()
    // A preset is never overwritten: saving one creates the user's own copy.
    if (def.id.startsWith('preset-')) {
      def = { ...def, id: newTrackId() }
      set({ def })
      storeWorkingTrack(def)
    }
    const copy = structuredClone(def)
    const others = get().saved.filter((t) => t.id !== copy.id)
    const saved = [copy, ...others]
    set({ saved })
    await storeSavedTracks(saved)
  },

  deleteSaved: async (id) => {
    const saved = get().saved.filter((t) => t.id !== id)
    set({ saved })
    await storeSavedTracks(saved)
  },
}))
