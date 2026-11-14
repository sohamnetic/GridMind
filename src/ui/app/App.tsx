import { useEffect, useSyncExternalStore } from 'react'
import '../../audio/gameSounds'
import { sound } from '../../audio/sound'
import { decodeTrack, sharedTrackParam } from '../../share/urlCodec'
import { useStudioStore } from '../../state/studioStore'
import { DriverEvolution } from '../evolution/DriverEvolution'
import { Home } from '../home/Home'
import { StrategyOptimiser } from '../optimiser/StrategyOptimiser'
import { LivePitWall } from '../pitwall/LivePitWall'
import { RaceScreen } from '../race/RaceScreen'
import { SeasonScreen } from '../season/SeasonScreen'
import { TrackStudio } from '../studio/TrackStudio'
import { Coach, useCoachPreference } from './CoachStrip'
import { flowSteps, nextStep } from './flow'
import { BrandMark, ModuleIcon } from './icons'
import { MODULES } from './modules'
import { useDrivers, useFlowStatus } from './useFlowStatus'
import { useHashRoute } from './useHashRoute'

export function App() {
  const [active, navigate] = useHashRoute()
  const drivers = useDrivers()
  const status = useFlowStatus(drivers)
  const [coachOn, setCoachOn] = useCoachPreference()
  const soundOn = useSyncExternalStore(
    (listener) => sound.subscribe(listener),
    () => sound.enabled,
  )
  const done = new Set(flowSteps(status).filter((s) => s.done).map((s) => s.id))
  const next = nextStep(status).id

  // A shared link carries a circuit after the route: open it in the studio.
  useEffect(() => {
    let cancelled = false
    const open = () => {
      const payload = sharedTrackParam(window.location.hash)
      if (!payload) return
      // The circuit comes out of the address bar at once, so a refresh does not load it again.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/studio`)
      decodeTrack(payload)
        .then((track) => {
          if (cancelled) return
          const studio = useStudioStore.getState()
          const untouched = studio.def.id.startsWith('preset-') && studio.past.length === 0
          if (
            untouched ||
            window.confirm(`Open the shared circuit “${track.name}”? It replaces the circuit you are working on.`)
          ) {
            studio.loadTrack(track)
            studio.setNotice({ kind: 'ok', text: `Opened the shared circuit “${track.name}”. Save it to keep it.` })
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return
          useStudioStore.getState().setNotice({
            kind: 'error',
            text: error instanceof Error ? error.message : 'This link does not contain a circuit.',
          })
        })
    }
    open()
    window.addEventListener('hashchange', open)
    return () => {
      cancelled = true
      window.removeEventListener('hashchange', open)
    }
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/home" aria-label="GridMind home" aria-current={active === 'home' ? 'page' : undefined}>
          <BrandMark />
          <span className="brand-name">
            Grid<b>Mind</b>
          </span>
        </a>

        <nav className="steps" aria-label="Modules">
          {MODULES.map((m) => {
            const isDone = done.has(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={[
                  'step',
                  m.id === active ? 'is-active' : '',
                  isDone ? 'is-done' : '',
                  m.id === next && !isDone ? 'is-next' : '',
                ]
                  .join(' ')
                  .trim()}
                title={isDone ? `${m.name}: done for this circuit` : m.name}
                aria-current={m.id === active ? 'page' : undefined}
                onClick={() => navigate(m.id)}
              >
                <span className="step-chip">{isDone ? '✓' : m.step}</span>
                <span className="step-icon">
                  <ModuleIcon id={m.id} size={16} />
                </span>
                <span className="step-name">{m.name}</span>
              </button>
            )
          })}
        </nav>

        <div className="topbar-end">
          <a
            className={active === 'season' ? 'season-link is-active' : 'season-link'}
            href="#/season"
            aria-current={active === 'season' ? 'page' : undefined}
            title="Championship: a season of race weekends"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M7 4h10v3a5 5 0 0 1-10 0V4Zm-3 1h3v2a3 3 0 0 1-3-2Zm16 0h-3v2a3 3 0 0 0 3-2ZM10 13.5h4V17h2.5v3h-9v-3H10v-3.5Z"
                fill="currentColor"
              />
            </svg>
            <span>Season</span>
          </a>
          <button
            type="button"
            className={soundOn ? 'sound-toggle is-on' : 'sound-toggle'}
            aria-pressed={soundOn}
            title={soundOn ? 'Sound is on: click to mute' : 'Sound is off: click to turn it on'}
            aria-label={soundOn ? 'Mute sound' : 'Turn sound on'}
            onClick={() => sound.setEnabled(!soundOn)}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" fill="currentColor" />
              {soundOn ? (
                <path
                  d="M15 9a4.2 4.2 0 0 1 0 6M17.4 6.6a7.6 7.6 0 0 1 0 10.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              ) : (
                <path d="m15.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
          {!coachOn && active !== 'home' && (
            <button type="button" className="coach-toggle" onClick={() => setCoachOn(true)} title="Show what to do on this screen">
              Coach
            </button>
          )}
        </div>
      </header>

      {coachOn && (
        <Coach route={active} status={status} drivers={drivers} navigate={navigate} onHide={() => setCoachOn(false)} />
      )}

      <main className={active === 'home' || active === 'season' ? 'workspace is-home' : 'workspace'}>
        {active === 'home' ? (
          <Home status={status} navigate={navigate} />
        ) : active === 'season' ? (
          <SeasonScreen navigate={navigate} />
        ) : active === 'studio' ? (
          <TrackStudio />
        ) : active === 'evolution' ? (
          <DriverEvolution />
        ) : active === 'race' ? (
          <RaceScreen />
        ) : active === 'optimiser' ? (
          <StrategyOptimiser />
        ) : (
          <LivePitWall />
        )}
      </main>
    </div>
  )
}
