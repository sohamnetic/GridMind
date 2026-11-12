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
import { flowSteps, nextStep, type FlowStatus } from './flow'
import type { ModuleId } from './modules'

const SEEN_KEY = 'gridmind:guide-seen'

function guideSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/** How far the open circuit has come through the five steps. */
export function useFlowStatus(): FlowStatus {
  const def = useStudioStore((s) => s.def)
  const key = trackKey(def)
  const drivable = useMemo(() => {
    const track = buildTrack(def)
    return track !== null && isDrivable(validateTrack(track))
  }, [def])

  // Drivers: the ones in this browser or shipped with a preset, looked up when another circuit is opened...
  const [found, setFound] = useState<{ id: string; trackKey: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadDriver(def.id, DRIVER_LAYOUT.sizes).then((driver) => {
      if (cancelled) return
      setFound(driver && driver.snapshot.recordLap !== null ? { id: def.id, trackKey: driver.trackKey } : null)
    })
    return () => {
      cancelled = true
    }
  }, [def.id])
  // ...and the ones a training run has just saved.
  const saved = useEvolutionStore((s) => s.saved)
  const sessionKey = useEvolutionStore((s) => s.sessionTrackKey)
  const recordLap = useEvolutionStore((s) => s.recordLap)
  const drivers =
    (found !== null && found.id === def.id && found.trackKey === key) ||
    (saved !== null && saved.trackKey === key && saved.recordLap !== null) ||
    (sessionKey === key && recordLap !== null)

  const raced = useFullRaceStore((s) => s.result?.trackId === def.id)
  const studied = useOptimiserStore((s) => s.study?.trackId === def.id)
  const debriefed = usePitWallStore((s) => s.phase === 'finished' && s.track?.id === def.id)
  return { drivable, drivers, raced, studied, debriefed }
}

interface Props {
  active: ModuleId
  status: FlowStatus
  navigate: (id: ModuleId) => void
}

/** The next step, one click away, and a short guide to all five. */
export function FlowGuide({ active, status, navigate }: Props) {
  const [open, setOpen] = useState(() => !guideSeen())
  const steps = flowSteps(status)
  const next = nextStep(status)

  const close = () => {
    setOpen(false)
    try {
      window.localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Without storage the guide simply opens again next visit.
    }
  }

  return (
    <div className="guide">
      {active !== next.id && (
        <button
          type="button"
          className="guide-next"
          onClick={() => navigate(next.id)}
          title={`${next.title}. ${next.hint}`}
          aria-label={`Next: ${next.title.toLowerCase()}`}
        >
          Next<span className="guide-next-what">: {next.title.toLowerCase()}</span> <span aria-hidden="true">→</span>
        </button>
      )}
      <button
        type="button"
        className="guide-toggle"
        aria-expanded={open}
        aria-controls="guide-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        Guide
      </button>
      {open && (
        <div className="guide-panel" id="guide-panel" role="dialog" aria-label="How GridMind works">
          <h2>From a blank page to the pit wall</h2>
          <p>Five steps, each feeding the next. A preset circuit gets you through all of them in a few minutes.</p>
          <ol>
            {steps.map((step, i) => (
              <li key={step.id} className={step.done ? 'is-done' : step.id === next.id ? 'is-next' : undefined}>
                <button
                  type="button"
                  onClick={() => {
                    navigate(step.id)
                    close()
                  }}
                >
                  <span className="guide-mark" aria-hidden="true">
                    {step.done ? '✓' : i + 1}
                  </span>
                  <span>
                    <strong>
                      {step.title}
                      {step.done ? ' (done)' : step.id === next.id ? ' (next)' : ''}
                    </strong>
                    <small>{step.hint}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="guide-foot">
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
