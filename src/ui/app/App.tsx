import { MODULES } from './modules'
import { DriverEvolution } from '../evolution/DriverEvolution'
import { StrategyOptimiser } from '../optimiser/StrategyOptimiser'
import { RaceScreen } from '../race/RaceScreen'
import { TrackStudio } from '../studio/TrackStudio'
import { ModulePlaceholder } from './ModulePlaceholder'
import { useHashRoute } from './useHashRoute'

export function App() {
  const [active, navigate] = useHashRoute()
  const current = MODULES.find((m) => m.id === active) ?? MODULES[0]

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
              className={m.id === active ? 'pipeline-step is-active' : 'pipeline-step'}
              aria-current={m.id === active ? 'page' : undefined}
              onClick={() => navigate(m.id)}
            >
              <span className="pipeline-num">{m.step}</span>
              <span className="pipeline-label">{m.name}</span>
            </button>
          ))}
        </nav>
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
          <ModulePlaceholder module={current} />
        )}
      </main>
    </div>
  )
}
