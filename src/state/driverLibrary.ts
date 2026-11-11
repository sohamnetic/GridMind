import { del, get, set } from 'idb-keyval'
import type { GenerationStats } from '../core/evolution/trainer'
import type { TrackDef } from '../core/track/types'
import type { TrafficStats } from '../core/evolution/trafficTrainer'
import type { TrafficSnapshot } from '../workers/raceProtocol'
import type { TrainingSnapshot } from '../workers/trainingProtocol'

/**
 * Trained drivers are stored per track in IndexedDB, which holds typed arrays
 * directly (a population is a few hundred kilobytes).
 */
export interface SavedDriver {
  version: 1
  trackId: string
  /** Fingerprint of the track geometry the drivers were trained on. */
  trackKey: string
  /** Network layer sizes, to reject drivers from an incompatible build. */
  layout: number[]
  populationSize: number
  seed: number
  snapshot: TrainingSnapshot
  history: GenerationStats[]
  /** Racing line of the record lap (x, y, speed triplets). */
  ghost: Float32Array | null
  savedAt: number
  /** Second-stage training: the same drivers after learning to race each other. */
  traffic?: {
    snapshot: TrafficSnapshot
    history: TrafficStats[]
  }
}

/** Solo-trained networks in the order racing wants them: record holder first. */
export function soloDrivers(driver: SavedDriver): Float32Array {
  const population = driver.snapshot.population.slice()
  if (driver.snapshot.recordGenome) population.set(driver.snapshot.recordGenome, 0)
  return population
}

const key = (trackId: string) => `gridmind:driver:${trackId}`

export async function loadDriver(trackId: string, layout: readonly number[]): Promise<SavedDriver | null> {
  try {
    const saved = await get<SavedDriver>(key(trackId))
    if (!saved || saved.version !== 1) return null
    if (saved.layout.join() !== layout.join()) return null
    if (!(saved.snapshot?.population instanceof Float32Array)) return null
    return saved
  } catch {
    return null
  }
}

export async function storeDriver(driver: SavedDriver): Promise<boolean> {
  try {
    await set(key(driver.trackId), driver)
    return true
  } catch {
    return false
  }
}

export async function deleteDriver(trackId: string): Promise<void> {
  try {
    await del(key(trackId))
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/**
 * Short fingerprint of everything that changes how a track drives. Used to
 * notice that a circuit was edited after its drivers were trained.
 */
export function trackKey(def: TrackDef): string {
  const text = JSON.stringify([
    def.points,
    def.width,
    def.kerbWidth,
    def.runoffWidth,
    def.startFraction,
    def.sectors,
  ])
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
