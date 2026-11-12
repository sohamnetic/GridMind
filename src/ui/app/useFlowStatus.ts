import { useEffect, useMemo, useState } from 'react'
import { DRIVER_LAYOUT } from '../../core/evolution/trainer'
import { isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { loadDriver, trackKey } from '../../state/driverLibrary'
import { useEvolutionStore } from '../../state/evolutionStore'
import { useFullRaceStore } from '../../state/fullRaceStore'
import { useOptimiserStore } from '../../state/optimiserStore'
import { usePitWallStore } from '../../state/pitwallStore'
import { useStudioStore } from '../../state/studioStore'
import type { FlowStatus } from './flow'

/** What is known about the drivers of the open circuit. */
export interface DriversFound {
  /** Drivers that can lap the circuit as it is now exist. */
  ready: boolean
  /** They are the ones shipped with a preset, not trained in this browser. */
  bundled: boolean
  recordLap: number | null
}

/** Drivers for the open circuit: saved in this browser, shipped with a preset, or training right now. */
export function useDrivers(): DriversFound {
  const def = useStudioStore((s) => s.def)
  const key = trackKey(def)
  const [found, setFound] = useState<{ id: string; trackKey: string; bundled: boolean; lap: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadDriver(def.id, DRIVER_LAYOUT.sizes).then((driver) => {
      if (cancelled) return
      const lap = driver?.snapshot.recordLap ?? null
      setFound(
        driver && lap !== null
          ? { id: def.id, trackKey: driver.trackKey, bundled: driver.bundled === true, lap }
          : null,
      )
    })
    return () => {
      cancelled = true
    }
  }, [def.id])
  // A training run that has just set a lap counts before it is next looked up.
  const saved = useEvolutionStore((s) => s.saved)
  const sessionKey = useEvolutionStore((s) => s.sessionTrackKey)
  const sessionLap = useEvolutionStore((s) => s.recordLap)

  if (sessionKey === key && sessionLap !== null) return { ready: true, bundled: false, recordLap: sessionLap }
  if (saved !== null && saved.trackKey === key && saved.recordLap !== null) {
    return { ready: true, bundled: saved.bundled, recordLap: saved.recordLap }
  }
  if (found !== null && found.id === def.id && found.trackKey === key) {
    return { ready: true, bundled: found.bundled, recordLap: found.lap }
  }
  return { ready: false, bundled: false, recordLap: null }
}

/** How far the open circuit has come through the five steps. */
export function useFlowStatus(drivers: DriversFound): FlowStatus {
  const def = useStudioStore((s) => s.def)
  const drivable = useMemo(() => {
    const track = buildTrack(def)
    return track !== null && isDrivable(validateTrack(track))
  }, [def])
  const raced = useFullRaceStore((s) => s.result?.trackId === def.id)
  const studied = useOptimiserStore((s) => s.study?.trackId === def.id)
  const debriefed = usePitWallStore((s) => s.phase === 'finished' && s.track?.id === def.id)
  return { drivable, drivers: drivers.ready, raced, studied, debriefed }
}
