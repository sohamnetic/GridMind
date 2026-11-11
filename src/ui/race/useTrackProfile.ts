import { useEffect, useMemo, useState } from 'react'
import { DRIVER_LAYOUT } from '../../core/evolution/trainer'
import { estimateProfile, measureProfile, type TrackProfile } from '../../core/profile/trackProfile'
import type { TrackAnalysis } from '../../core/track/analysis'
import type { BuiltTrack } from '../../core/track/types'
import { loadDriver } from '../../state/driverLibrary'

interface Scene {
  track: BuiltTrack | null
  analysis: TrackAnalysis | null
  /** Length of the drawn pit lane (m), or 0 if the circuit has none. */
  pitLength: number
}

/**
 * Track profile for the strategy engine: measured from the stored best lap
 * when there is one, otherwise estimated from the geometry.
 */
export function useTrackProfile(trackId: string, scene: Scene): TrackProfile | null {
  const [measured, setMeasured] = useState<{ key: object; profile: TrackProfile } | null>(null)
  const { track, analysis, pitLength } = scene

  const estimate = useMemo(
    () => (track && analysis ? estimateProfile(track, analysis, pitLength) : null),
    [track, analysis, pitLength],
  )

  useEffect(() => {
    if (!track || !analysis) return
    let cancelled = false
    void loadDriver(trackId, DRIVER_LAYOUT.sizes).then((driver) => {
      if (cancelled || !driver?.ghost || driver.snapshot.recordLap === null) return
      const profile = measureProfile(track, analysis, driver.ghost, driver.snapshot.recordLap, pitLength)
      setMeasured({ key: track, profile })
    })
    return () => {
      cancelled = true
    }
  }, [trackId, track, analysis, pitLength])

  // A measurement belongs to the exact track it was made on.
  return measured && measured.key === track ? measured.profile : estimate
}
