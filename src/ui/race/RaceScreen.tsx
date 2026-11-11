import { useState } from 'react'
import { useRaceStore } from '../../state/raceStore'
import { FullRace } from './FullRace'
import { WheelRace } from './WheelRace'
import '../evolution/evolution.css'
import './race.css'

type View = 'full' | 'wheel'

/**
 * The Race Engine tab holds two kinds of race:
 *  - the full race, simulated lap by lap with tyres, fuel, stops and weather;
 *  - the wheel-to-wheel race, where the trained drivers physically race each other.
 */
export function RaceScreen() {
  // Come back to a wheel-to-wheel race that is still in progress.
  const [view, setView] = useState<View>(() => (useRaceStore.getState().mode === 'race' ? 'wheel' : 'full'))

  return (
    <div className="race-screen">
      <div className="view-switch" role="tablist" aria-label="Kind of race">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'full'}
          className={view === 'full' ? 'is-active' : undefined}
          onClick={() => setView('full')}
        >
          Full race
          <small>Strategy, tyres, weather — lap by lap</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'wheel'}
          className={view === 'wheel' ? 'is-active' : undefined}
          onClick={() => setView('wheel')}
        >
          Wheel-to-wheel
          <small>Trained drivers racing on track</small>
        </button>
      </div>
      {view === 'full' ? <FullRace /> : <WheelRace />}
    </div>
  )
}
