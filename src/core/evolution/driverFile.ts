import type { GenerationStats } from './trainer'

/**
 * Trained drivers as a plain JSON file, for the pre-trained drivers that
 * ship with the preset circuits. Weights are exact: the bytes of the
 * Float32Arrays in base64, so a bundled champion drives the same lap it
 * drove when it was trained.
 */
export interface DriverFile {
  version: 1
  trackId: string
  /** Fingerprint of the track geometry the drivers were trained on. */
  trackKey: string
  layout: number[]
  populationSize: number
  seed: number
  generation: number
  recordLap: number | null
  timeLimit: number
  population: string
  recordGenome: string | null
  /** Racing line of the record lap (x, y, speed triplets). */
  ghost: string | null
  history: GenerationStats[]
}

/** The bytes of a Float32Array as base64. */
export function encodeFloats(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function decodeFloats(text: string): Float32Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
}

/** Whether something read from a file has the shape of a DriverFile. */
export function isDriverFile(value: unknown): value is DriverFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.version === 1 &&
    typeof v.trackId === 'string' &&
    typeof v.trackKey === 'string' &&
    Array.isArray(v.layout) &&
    typeof v.populationSize === 'number' &&
    typeof v.population === 'string' &&
    Array.isArray(v.history)
  )
}
