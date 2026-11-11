/**
 * Track data model.
 *
 * World units are metres. The y axis points DOWN (screen convention), so a
 * positive heading change / positive curvature is a clockwise, i.e. RIGHT, turn.
 * The driving direction is the order of the control points.
 *
 * Positions along the lap are stored as fractions in [0, 1) of the centreline
 * length, measured from control point 0.
 */

export interface ControlPoint {
  x: number
  y: number
  /** Optional full track width override at this point (m). */
  width?: number
}

export interface TrackZone {
  start: number
  end: number
}

export interface PitLane {
  entry: number
  exit: number
  /** Side of the track the pit lane runs on, seen in the driving direction. */
  side: 'left' | 'right'
}

export interface TrackDef {
  version: 1
  id: string
  name: string
  /** Closed loop of control points; the spline passes through each of them. */
  points: ControlPoint[]
  /** Default full track width (m). */
  width: number
  /** Kerb strip width on each side (m). */
  kerbWidth: number
  /** Gravel run-off width beyond the kerb on each side (m); the wall is behind it. */
  runoffWidth: number
  /** Start/finish line position. */
  startFraction: number
  /** Ends of sector 1 and sector 2 (sector 3 ends at the start/finish line). */
  sectors: [number, number]
  drsZones: TrackZone[]
  pit: PitLane | null
}

export const Surface = {
  Track: 0,
  Kerb: 1,
  Gravel: 2,
  Wall: 3,
} as const
export type Surface = (typeof Surface)[keyof typeof Surface]

export const SURFACE_NAMES = ['Track', 'Kerb', 'Gravel', 'Wall'] as const

/** Limits enforced by the editor and by the JSON parser. */
export const TRACK_LIMITS = {
  width: { min: 8, max: 20, default: 12 },
  kerbWidth: { min: 0.5, max: 3, default: 1.5 },
  runoffWidth: { min: 4, max: 40, default: 14 },
  minPoints: 3,
  maxPoints: 200,
  minLength: 400,
} as const

/**
 * A track resampled at a uniform arc-length step, ready for physics, sensors
 * and rendering. All arrays have length `n` and describe the centreline.
 */
export interface BuiltTrack {
  def: TrackDef
  n: number
  /** Arc length between consecutive samples (m). */
  step: number
  length: number
  x: Float64Array
  y: Float64Array
  /** Unit tangent (driving direction). */
  tx: Float64Array
  ty: Float64Array
  heading: Float64Array
  /** Signed curvature in 1/m; positive = right turn. */
  curvature: Float64Array
  halfWidth: Float64Array
  /** True when no control point overrides the width. */
  uniformWidth: boolean
  /** Control segment (between point i and i+1) each sample belongs to. */
  ctrlSegment: Int32Array
  /** Sample index closest to each control point. */
  ctrlSample: Int32Array
  /** Sample index of the start/finish line. */
  startIndex: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}
