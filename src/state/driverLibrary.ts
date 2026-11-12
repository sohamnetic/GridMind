import { del, get, set } from 'idb-keyval'
import { decodeFloats, isDriverFile, type DriverFile } from '../core/evolution/driverFile'
import type { GenerationStats } from '../core/evolution/trainer'
import { trackKey } from '../core/track/serialize'
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
  /** True for the pre-trained drivers that ship with a preset circuit, until the user trains them further. */
  bundled?: boolean
}

function fromFile(file: DriverFile): SavedDriver {
  return {
    version: 1,
    trackId: file.trackId,
    trackKey: file.trackKey,
    layout: file.layout,
    populationSize: file.populationSize,
    seed: file.seed,
    snapshot: {
      population: decodeFloats(file.population),
      generation: file.generation,
      recordLap: file.recordLap,
      recordGenome: file.recordGenome ? decodeFloats(file.recordGenome) : null,
      timeLimit: file.timeLimit,
    },
    history: file.history,
    ghost: file.ghost ? decodeFloats(file.ghost) : null,
    savedAt: 0,
    bundled: true,
  }
}

const bundledFiles = new Map<string, Promise<DriverFile | null>>()

/**
 * The pre-trained drivers that ship with a preset circuit, fetched from the
 * site's own static files the first time they are wanted.
 */
async function loadBundled(trackId: string, layout: readonly number[]): Promise<SavedDriver | null> {
  if (!trackId.startsWith('preset-') || typeof fetch === 'undefined' || typeof document === 'undefined') return null
  let pending = bundledFiles.get(trackId)
  if (!pending) {
    pending = fetch(new URL(`drivers/${trackId}.json`, document.baseURI))
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then((data) => (isDriverFile(data) ? data : null))
      .catch(() => null)
    bundledFiles.set(trackId, pending)
  }
  const file = await pending
  if (!file || file.layout.join() !== layout.join()) return null
  // Decoded afresh each time, so nobody is handed arrays another caller may have changed.
  const driver = fromFile(file)
  return driver.snapshot.population.length === file.populationSize * weightCount(layout) ? driver : null
}

function weightCount(layout: readonly number[]): number {
  let count = 0
  for (let l = 0; l < layout.length - 1; l++) count += (layout[l] + 1) * layout[l + 1]
  return count
}

/** Solo-trained networks in the order racing wants them: record holder first. */
export function soloDrivers(driver: SavedDriver): Float32Array {
  const population = driver.snapshot.population.slice()
  if (driver.snapshot.recordGenome) population.set(driver.snapshot.recordGenome, 0)
  return population
}

const key = (trackId: string) => `gridmind:driver:${trackId}`

export async function loadDriver(trackId: string, layout: readonly number[]): Promise<SavedDriver | null> {
  return (await loadStored(trackId, layout)) ?? (await loadBundled(trackId, layout))
}

/** Drivers the user trained and saved in this browser. */
async function loadStored(trackId: string, layout: readonly number[]): Promise<SavedDriver | null> {
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
    // Once stored they are the user's own drivers, whatever they started from.
    const { bundled: _bundled, ...own } = driver
    void _bundled
    await set(key(driver.trackId), { ...own, savedAt: own.savedAt || Date.now() })
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

export { trackKey }
