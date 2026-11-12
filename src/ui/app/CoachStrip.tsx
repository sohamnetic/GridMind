import { useEffect, useState } from 'react'
import { trackKey } from '../../state/driverLibrary'
import { useEvolutionStore } from '../../state/evolutionStore'
import { useOptimiserStore } from '../../state/optimiserStore'
import { usePitWallStore } from '../../state/pitwallStore'
import { useStudioStore } from '../../state/studioStore'
import { coachTip, type CoachState } from './coachTips'
import type { FlowStatus } from './flow'
import type { ModuleId } from './modules'
import type { DriversFound } from './useFlowStatus'
import type { Route } from './useHashRoute'

const PREFERENCE = 'gridmind:coach'

/** Whether the coach is shown. It is on until switched off, and the choice is remembered. */
export function useCoachPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(PREFERENCE) !== 'off'
    } catch {
      return true
    }
  })
  const set = (value: boolean) => {
    setOn(value)
    try {
      window.localStorage.setItem(PREFERENCE, value ? 'on' : 'off')
    } catch {
      // Without storage the choice lasts for this visit only.
    }
  }
  return [on, set]
}

/** Everything the coach's advice depends on, read from the stores. */
function useCoachState(route: ModuleId, status: FlowStatus, drivers: DriversFound): CoachState {
  const def = useStudioStore((s) => s.def)
  const key = trackKey(def)
  const trainingStatus = useEvolutionStore((s) => s.status)
  const sessionKey = useEvolutionStore((s) => s.sessionTrackKey)
  const sessionLap = useEvolutionStore((s) => s.recordLap)
  const generation = useEvolutionStore((s) => (s.history.length > 0 ? s.history[s.history.length - 1].generation : 0))
  const optimiserRunning = useOptimiserStore((s) => s.status === 'running')
  const phase = usePitWallStore((s) => s.phase)
  const playing = usePitWallStore((s) => s.playing)
  const lap = usePitWallStore((s) => s.race?.lap ?? 0)
  const deciding = usePitWallStore((s) => s.decisions.length > 0)
  const retired = usePitWallStore((s) => s.race !== null && s.race.cars[s.driver]?.running === false)
  const debriefDone = usePitWallStore((s) => s.debrief.status === 'done')
  const here = sessionKey === key

  return {
    route,
    status,
    trackName: def.name,
    points: def.points.length,
    training: {
      running: here && trainingStatus === 'running',
      generation,
      recordLap: here ? sessionLap : null,
    },
    bundledDrivers: drivers.bundled,
    bestLap: drivers.recordLap,
    optimiserRunning,
    pitwall: { phase, playing, lap, deciding, retired, debriefDone },
  }
}

const TARGET_CLASS = 'coach-target'

function findTarget(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-coach="${id}"]`)
}

interface Props {
  route: Route
  status: FlowStatus
  drivers: DriversFound
  navigate: (route: Route) => void
  onHide: () => void
}

/** A strip under the top bar: where you are, what to do here, and the button that takes you on. */
export function Coach({ route, status, drivers, navigate, onHide }: Props) {
  const state = useCoachState(route === 'home' ? 'studio' : route, status, drivers)
  const tip = coachTip(state)
  const target = route === 'home' ? undefined : tip.target

  // The control the coach is talking about glows. Screens redraw and drop the
  // mark, so it is put back on a short timer for as long as it applies.
  useEffect(() => {
    if (!target) return
    const mark = () => {
      const el = findTarget(target)
      for (const old of document.querySelectorAll(`.${TARGET_CLASS}`)) {
        if (old !== el) old.classList.remove(TARGET_CLASS)
      }
      el?.classList.add(TARGET_CLASS)
    }
    mark()
    const timer = window.setInterval(mark, 400)
    return () => {
      window.clearInterval(timer)
      for (const old of document.querySelectorAll(`.${TARGET_CLASS}`)) old.classList.remove(TARGET_CLASS)
    }
  }, [target])

  if (route === 'home') return null

  const show = () => {
    const el = target ? findTarget(target) : null
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus({ preventScroll: true })
  }

  return (
    <aside className={tip.done ? 'coach is-done' : 'coach'} aria-label="Coach: what to do on this screen">
      <div className="coach-step" aria-hidden="true">
        <span>Step</span>
        <b>{tip.step}</b>
        <span>of 5</span>
      </div>
      <div className="coach-body" aria-live="polite">
        <strong>{tip.title}</strong>
        <span>{tip.text}</span>
      </div>
      <div className="coach-actions">
        {target && (
          <button type="button" className="coach-show" onClick={show}>
            Show me
          </button>
        )}
        {tip.next && (
          <button type="button" className="coach-next" onClick={() => navigate(tip.next!.to)}>
            {tip.next.label} <span aria-hidden="true">→</span>
          </button>
        )}
        <button type="button" className="coach-hide" onClick={onHide} aria-label="Hide the coach" title="Hide the coach">
          ×
        </button>
      </div>
    </aside>
  )
}
