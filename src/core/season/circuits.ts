import { estimateProfile, measureProfile } from '../profile/trackProfile'
import { analyseTrack, isDrivable, validateTrack } from '../track/analysis'
import { buildTrack } from '../track/build'
import { buildPitLane } from '../track/pit'
import type { TrackDef } from '../track/types'
import type { CircuitSpec } from './types'

/** A trained driver's best lap on a circuit: the line it drove (x, y, speed triplets) and the time. */
export interface BestLap {
  ghost: Float32Array
  recordLap: number
}

/**
 * A circuit made ready for the calendar: its profile is measured from the
 * trained drivers' best lap when there is one, and estimated from the
 * geometry otherwise. Returns null for a circuit that cannot be raced on.
 */
export function circuitSpec(def: TrackDef, lap: BestLap | null): CircuitSpec | null {
  const track = buildTrack(def)
  if (!track || !isDrivable(validateTrack(track))) return null
  const analysis = analyseTrack(track)
  const pitLength = buildPitLane(track)?.length ?? 0
  const profile = lap
    ? measureProfile(track, analysis, lap.ghost, lap.recordLap, pitLength)
    : estimateProfile(track, analysis, pitLength)
  return { def, profile }
}
