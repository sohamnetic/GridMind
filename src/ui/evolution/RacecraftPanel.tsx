import { useEffect, useMemo } from 'react'
import { formatLapTime } from '../../core/physics/lapTimer'
import type { TrackDef } from '../../core/track/types'
import { trackKey } from '../../state/driverLibrary'
import { useEvolutionStore } from '../../state/evolutionStore'
import { useRaceStore } from '../../state/raceStore'
import { LineChart, type ChartSeries } from '../components/LineChart'
import { SpeedPicker, TRAINING_SPEEDS } from '../components/SpeedPicker'

const formatRate = (v: number) => v.toFixed(1)
const formatFitness = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))

interface Props {
  studioDef: TrackDef
  drivable: boolean
}

/** Second training stage: drivers that can lap are raced against each other in heats. */
export function RacecraftPanel({ studioDef, drivable }: Props) {
  const mode = useRaceStore((s) => s.mode)
  const status = useRaceStore((s) => s.status)
  const speed = useRaceStore((s) => s.speed)
  const history = useRaceStore((s) => s.history)
  const drivers = useRaceStore((s) => s.drivers)
  const error = useRaceStore((s) => s.error)
  const lapStatus = useEvolutionStore((s) => s.status)
  const lapSaved = useEvolutionStore((s) => s.saved)
  const actions = useRaceStore.getState()
  const training = mode === 'train'

  // Re-read what is stored whenever lap training saves something new.
  useEffect(() => {
    void useRaceStore.getState().refresh(studioDef.id)
  }, [studioDef.id, lapStatus, lapSaved])

  const latest = history[history.length - 1]
  const charts = useMemo(() => {
    const x = history.map((h) => h.generation)
    const racing: ChartSeries[] = [
      { label: 'Overtakes', color: '#3ddc97', values: history.map((h) => h.overtakes / h.entries) },
      { label: 'Contacts', color: '#ff5a36', values: history.map((h) => h.contacts / h.entries) },
    ]
    const fitness: ChartSeries[] = [
      { label: 'Best', color: '#ffc247', values: history.map((h) => h.bestFitness) },
      { label: 'Average', color: '#9aa6bd', values: history.map((h) => h.meanFitness) },
    ]
    return { x, racing, fitness }
  }, [history])

  const ready = drivers !== null && drivers.recordLap !== null
  const stale = drivers !== null && drivers.trackKey !== trackKey(studioDef)

  return (
    <>
      <section className="panel">
        <h2>Racecraft</h2>
        <p className="muted">
          Drivers race each other in heats of eight. Faster cars start behind slower ones, and drivers are scored on
          distance, passes made and contact avoided.
        </p>
        {error && (
          <p className="issue issue-error" role="alert">
            {error}
          </p>
        )}

        {!training && !ready && (
          <p className="issue issue-warning">
            {drivers === null
              ? 'No saved drivers for this circuit yet. Train them in “Learn the lap” first; they are saved when you pause.'
              : 'These drivers have not completed a lap yet. Keep training them in “Learn the lap”.'}
          </p>
        )}

        {!training && ready && (
          <>
            <p className="saved-driver-note">
              Lap training: generation {drivers.soloGeneration}, best lap{' '}
              <span className="mono">{formatLapTime(drivers.recordLap)}</span>
              {stale && ' (trained before the circuit was last edited)'}
            </p>
            <button
              type="button"
              className="primary"
              disabled={!drivable}
              onClick={() => void actions.startTraining(studioDef, false)}
            >
              {drivers.trafficGeneration ? 'Restart racecraft training' : 'Start racecraft training'}
            </button>
            {drivers.trafficGeneration !== null && (
              <div className="button-row">
                <button type="button" disabled={!drivable} onClick={() => void actions.startTraining(studioDef, true)}>
                  Continue from generation {drivers.trafficGeneration}
                </button>
                <a className="button-link" href="#/race">
                  Watch a race
                </a>
              </div>
            )}
          </>
        )}

        {training && (
          <>
            <SpeedPicker options={TRAINING_SPEEDS} value={speed} onChange={actions.setSpeed} />
            <div className="button-row">
              {status === 'paused' ? (
                <button type="button" onClick={actions.resume}>
                  Resume
                </button>
              ) : (
                <button type="button" onClick={actions.pause} disabled={status === 'starting'}>
                  Pause
                </button>
              )}
              <button type="button" onClick={actions.stop} title="Saves the drivers and ends this run">
                Save and stop
              </button>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Progress</h2>
        {!latest ? (
          <p className="muted">
            At first the drivers ignore each other, because they learned to lap alone. Contact should fall and clean
            passes should appear within a few dozen generations.
          </p>
        ) : (
          <>
            <dl className="stats">
              <Stat label="Generation" value={String(latest.generation)} />
              <Stat label="Best lap in traffic" value={formatLapTime(latest.bestLap)} />
              <Stat label="Overtakes per car" value={(latest.overtakes / latest.entries).toFixed(1)} />
              <Stat label="Contacts per car" value={(latest.contacts / latest.entries).toFixed(1)} />
              <Stat label="Finished" value={`${Math.round((latest.finished / latest.entries) * 100)} %`} />
              <Stat label="Crashed" value={`${Math.round((latest.crashed / latest.entries) * 100)} %`} />
            </dl>
            <h3>Per car, per heat</h3>
            <LineChart x={charts.x} series={charts.racing} formatY={formatRate} />
            <h3>Fitness</h3>
            <LineChart x={charts.x} series={charts.fitness} formatY={formatFitness} />
          </>
        )}
      </section>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
