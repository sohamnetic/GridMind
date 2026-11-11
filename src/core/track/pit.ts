import { smoothstep, wrap } from '../math/util'
import { fractionToIndex } from './build'
import type { BuiltTrack } from './types'

export const PIT_LANE_WIDTH = 8
/** Gap between the kerb and the pit lane (m). */
const PIT_LANE_GAP = 3

export interface PitLaneGeometry {
  x: Float64Array
  y: Float64Array
  /** Length of the lane from entry to exit (m). */
  length: number
}

/**
 * Centreline of the pit lane: it peels off the racing surface at the entry,
 * runs alongside the track beyond the kerb, and merges back at the exit.
 * Returns null when the circuit has no pit lane or it is too short to be one.
 */
export function buildPitLane(track: BuiltTrack): PitLaneGeometry | null {
  const pit = track.def.pit
  if (!pit) return null
  const { n, step } = track
  const from = fractionToIndex(pit.entry, n)
  const count = Math.round(wrap(pit.exit - pit.entry, 1) * n)
  if (count < 20) return null

  const side = pit.side === 'left' ? 1 : -1
  const blend = Math.min(Math.round(60 / step), Math.floor(count / 3))
  const x = new Float64Array(count + 1)
  const y = new Float64Array(count + 1)
  let length = 0
  for (let k = 0; k <= count; k++) {
    const i = (from + k) % n
    const hw = track.halfWidth[i]
    const full = hw + track.def.kerbWidth + PIT_LANE_GAP + PIT_LANE_WIDTH / 2
    const ramp = smoothstep(Math.min(k, count - k) / blend)
    const offset = side * (hw * 0.5 + (full - hw * 0.5) * ramp)
    x[k] = track.x[i] + track.ty[i] * offset
    y[k] = track.y[i] - track.tx[i] * offset
    if (k > 0) length += Math.hypot(x[k] - x[k - 1], y[k] - y[k - 1])
  }
  return { x, y, length }
}
