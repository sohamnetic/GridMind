import { useEffect } from 'react'
import { decodeTrack, sharedTrackParam } from '../../share/urlCodec'
import { useStudioStore } from '../../state/studioStore'
import { flowSteps } from './flow'
import { FlowGuide, useFlowStatus } from './FlowGuide'
import { MODULES } from './modules'
import { DriverEvolution } from '../evolution/DriverEvolution'
import { StrategyOptimiser } from '../optimiser/StrategyOptimiser'
import { LivePitWall } from '../pitwall/LivePitWall'
import { RaceScreen } from '../race/RaceScreen'
import { TrackStudio } from '../studio/TrackStudio'
import { useHashRoute } from './useHashRoute'

export function App() {
  const [active, navigate] = useHashRoute()
  const status = useFlowStatus()
  const done = new Set(flowSteps(status).filter((s) => s.done).map((s) => s.id))

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
        <a className="brand" href="#/studio" aria-label="GridMind home">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M9 21c-3-5 0-12 7-12s10 6 7 10-6 1-8 3-4 2-6-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
            <circle cx="22.5" cy="12" r="2.2" className="brand-dot" />
          </svg>
          <span className="brand-name">GridMind</span>
        </a>

        <nav className="pipeline" aria-label="Modules">
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={['pipeline-step', m.id === active ? 'is-active' : '', done.has(m.id) ? 'is-done' : '']
                .join(' ')
                .trim()}
              title={done.has(m.id) ? `${m.name}: done for this circuit` : m.name}
              aria-current={m.id === active ? 'page' : undefined}
              onClick={() => navigate(m.id)}
            >
              <span className="pipeline-num">{m.step}</span>
              <span className="pipeline-label">{m.name}</span>
            </button>
          ))}
        </nav>

        <FlowGuide active={active} status={status} navigate={navigate} />
      </header>

      <main className="workspace">
        {active === 'studio' ? (
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
