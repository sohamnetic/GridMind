import { clamp, wrap } from '../math/util'
import { TRACK_LIMITS, type ControlPoint, type PitLane, type TrackDef, type TrackZone } from './types'

export const TRACK_VERSION = 1

/** Identifier for a saved track. Not part of the simulation, so it need not be seeded. */
export function newTrackId(): string {
  return `t_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function createTrack(name: string, points: ControlPoint[] = [], id = newTrackId()): TrackDef {
  return {
    version: TRACK_VERSION,
    id,
    name,
    points,
    width: TRACK_LIMITS.width.default,
    kerbWidth: TRACK_LIMITS.kerbWidth.default,
    runoffWidth: TRACK_LIMITS.runoffWidth.default,
    startFraction: 0,
    sectors: [1 / 3, 2 / 3],
    drsZones: [],
    pit: null,
  }
}

export function trackToJson(def: TrackDef): string {
  return JSON.stringify(def, null, 2)
}

/**
 * Validates and normalises untrusted track data (an imported file or a shared
 * link). Throws an Error with a readable message when the data is not a track.
 */
export function parseTrack(input: unknown): TrackDef {
  const data = typeof input === 'string' ? safeJson(input) : input
  if (!isRecord(data)) throw new Error('Not a GridMind track file.')
  if (data.version !== TRACK_VERSION) {
    throw new Error(`Unsupported track version: ${String(data.version)}.`)
  }
  if (!Array.isArray(data.points)) throw new Error('Track has no control points.')
  if (data.points.length > TRACK_LIMITS.maxPoints) {
    throw new Error(`Track has too many control points (max ${TRACK_LIMITS.maxPoints}).`)
  }

  const width = range(data.width, TRACK_LIMITS.width)
  const points: ControlPoint[] = data.points.map((raw, i) => {
    if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
      throw new Error(`Control point ${i + 1} is invalid.`)
    }
    const point: ControlPoint = { x: clamp(raw.x, -50000, 50000), y: clamp(raw.y, -50000, 50000) }
    if (isFiniteNumber(raw.width)) {
      point.width = clamp(raw.width, TRACK_LIMITS.width.min, TRACK_LIMITS.width.max)
    }
    return point
  })

  const startFraction = fraction(data.startFraction, 0)
  const rawSectors = Array.isArray(data.sectors) ? data.sectors : []

  return {
    version: TRACK_VERSION,
    id: typeof data.id === 'string' && data.id.length > 0 ? data.id.slice(0, 64) : newTrackId(),
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 60) : 'Untitled circuit',
    points,
    width,
    kerbWidth: range(data.kerbWidth, TRACK_LIMITS.kerbWidth),
    runoffWidth: range(data.runoffWidth, TRACK_LIMITS.runoffWidth),
    startFraction,
    sectors: [
      fraction(rawSectors[0], wrap(startFraction + 1 / 3, 1)),
      fraction(rawSectors[1], wrap(startFraction + 2 / 3, 1)),
    ],
    drsZones: Array.isArray(data.drsZones) ? data.drsZones.slice(0, 8).flatMap(parseZone) : [],
    pit: parsePit(data.pit),
  }
}

function parseZone(raw: unknown): TrackZone[] {
  if (!isRecord(raw) || !isFiniteNumber(raw.start) || !isFiniteNumber(raw.end)) return []
  return [{ start: wrap(raw.start, 1), end: wrap(raw.end, 1) }]
}

function parsePit(raw: unknown): PitLane | null {
  if (!isRecord(raw) || !isFiniteNumber(raw.entry) || !isFiniteNumber(raw.exit)) return null
  return {
    entry: wrap(raw.entry, 1),
    exit: wrap(raw.exit, 1),
    side: raw.side === 'left' ? 'left' : 'right',
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function range(value: unknown, limits: { min: number; max: number; default: number }): number {
  return isFiniteNumber(value) ? clamp(value, limits.min, limits.max) : limits.default
}

function fraction(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? wrap(value, 1) : fallback
}

/** Reverses the driving direction, keeping every marker at the same place on the ground. */
export function reverseTrack(def: TrackDef): TrackDef {
  if (def.points.length < 2) return def
  const [first, ...rest] = def.points
  const flip = (f: number) => wrap(1 - f, 1)
  return {
    ...def,
    points: [first, ...rest.reverse()],
    startFraction: flip(def.startFraction),
    // Sector order follows the driving direction, so the two markers swap roles.
    sectors: [flip(def.sectors[1]), flip(def.sectors[0])],
    drsZones: def.drsZones.map((z) => ({ start: flip(z.end), end: flip(z.start) })),
    pit: def.pit
      ? {
          entry: flip(def.pit.exit),
          exit: flip(def.pit.entry),
          side: def.pit.side === 'left' ? 'right' : 'left',
        }
      : null,
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
