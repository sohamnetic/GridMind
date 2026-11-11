import { useEffect, useMemo, useRef, useState } from 'react'
import { formatLapTime } from '../../core/physics/lapTimer'
import { isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { buildTrackPaths } from '../../render/trackRenderer'
import { trackKey } from '../../state/driverLibrary'
import {
  liveFrame,
  POPULATION_OPTIONS,
  useEvolutionStore,
  type SpeedMode,
} from '../../state/evolutionStore'
import { useStudioStore } from '../../state/studioStore'
import { LineChart, type ChartSeries } from '../components/LineChart'
import { EvolutionView } from './evolutionView'
import './evolution.css'

const SPEED_LABELS: { id: SpeedMode; label: string; title: string }[] = [
  { id: '1x', label: '1×', title: 'Real time' },
  { id: '8x', label: '8×', title: 'Eight times real time' },
  { id: 'turbo', label: 'Turbo', title: 'As fast as possible, with minimal drawing' },
]

const formatSeconds = (v: number) => `${v.toFixed(1)} s`
const formatPercent = (v: number) => `${Math.round(v)} %`
const formatFitness = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))

export function DriverEvolution() {
  const studioDef = useStudioStore((s) => s.def)
  const status = useEvolutionStore((s) => s.status)
  const speed = useEvolutionStore((s) => s.speed)
  const populationSize = useEvolutionStore((s) => s.populationSize)
  const seed = useEvolutionStore((s) => s.seed)
  const sessionDef = useEvolutionStore((s) => s.sessionDef)
  const sessionTrackKey = useEvolutionStore((s) => s.sessionTrackKey)
  const history = useEvolutionStore((s) => s.history)
  const recordLap = useEvolutionStore((s) => s.recordLap)
  const ghost = useEvolutionStore((s) => s.ghost)
  const saved = useEvolutionStore((s) => s.saved)
  const error = useEvolutionStore((s) => s.error)
  const actions = useEvolutionStore.getState()

  // While a run exists the screen shows the circuit it is training on, even
  // if the circuit has since been edited in the Track Studio.
  const def = sessionDef ?? studioDef
  const scene = useMemo(() => {
    const track = buildTrack(def)
    return {
      track,
      paths: track ? buildTrackPaths(track) : null,
      drivable: track !== null && isDrivable(validateTrack(track)),
    }
  }, [def])

  const studioKey = useMemo(() => trackKey(studioDef), [studioDef])
  const studioDrivable = useMemo(() => {
    const track = buildTrack(studioDef)
    return track !== null && isDrivable(validateTrack(track))
  }, [studioDef])
  const hasRun = status !== 'idle'
  const circuitChanged = hasRun && (sessionDef?.id !== studioDef.id || sessionTrackKey !== studioKey)

  useEffect(() => {
    void useEvolutionStore.getState().refreshSaved(studioDef.id)
  }, [studioDef.id])

  // Car frames are only worth sending while this screen is open.
  useEffect(() => {
    useEvolutionStore.getState().setFramesEnabled(true)
    return () => useEvolutionStore.getState().setFramesEnabled(false)
  }, [status])

  const latest = history[history.length - 1]
  const charts = useMemo(() => {
    const x = history.map((h) => h.generation)
    const lap: ChartSeries[] = [
      { label: 'Best this generation', color: '#4aa8ff', values: history.map((h) => h.bestLap) },
      { label: 'Record', color: '#ff5a36', values: history.map((h) => h.recordLap) },
    ]
    const progress: ChartSeries[] = [
      { label: 'Furthest car', color: '#3ddc97', values: history.map((h) => Math.min(100, h.bestProgress * 100)) },
    ]
    const fitness: ChartSeries[] = [
      { label: 'Best', color: '#ffc247', values: history.map((h) => h.bestFitness) },
      { label: 'Average', color: '#9aa6bd', values: history.map((h) => h.meanFitness) },
    ]
    return { x, lap, progress, fitness }
  }, [history])

  return (
    <div className="evolution">
      <div className="evolution-stage">
        <TrainingCanvas track={scene.track} paths={scene.paths} ghost={ghost} />
        <LiveReadout active={hasRun} population={populationSize} recordLap={recordLap} trackName={def.name} />
        {ghost && (
          <p className="ghost-key">
            <span className="ghost-swatch" aria-hidden="true" /> Ghost line: the best driver's lap, blue where it is
            slow, yellow where it is fast
          </p>
        )}
      </div>

      <aside className="studio-side evolution-side" aria-label="Training controls and progress">
        <section className="panel">
          <h2>Training</h2>

          {!studioDrivable && !hasRun && (
            <p className="issue issue-error">
              This circuit has problems that stop cars driving it. <a href="#/studio">Fix it in the Track Studio</a>.
            </p>
          )}
          {error && (
            <p className="issue issue-error" role="alert">
              {error}
            </p>
          )}
          {circuitChanged && (
            <div className="issue issue-warning">
              <p>The circuit in the Track Studio is different from the one these drivers are training on.</p>
              <div className="button-row">
                <button
                  type="button"
                  disabled={!studioDrivable}
                  onClick={() => void actions.start(studioDef, 'adopt')}
                  title="Keep the drivers and let them adapt to the new layout"
                >
                  Move drivers over
                </button>
                <button type="button" disabled={!studioDrivable} onClick={() => void actions.start(studioDef, 'fresh')}>
                  Start fresh
                </button>
              </div>
            </div>
          )}

          {status === 'idle' ? (
            <>
              <fieldset className="fields">
                <label className="field">
                  <span>Cars per generation</span>
                  <select
                    value={populationSize}
                    onChange={(e) => actions.setPopulationSize(Number(e.target.value))}
                  >
                    {POPULATION_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Random seed</span>
                  <input
                    type="number"
                    min={1}
                    max={999999}
                    value={seed}
                    onChange={(e) => actions.setSeed(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                  />
                </label>
              </fieldset>
              <button
                type="button"
                className="primary"
                disabled={!studioDrivable}
                onClick={() => void actions.start(studioDef, 'fresh')}
              >
                Start training
              </button>
              {saved && (
                <div className="saved-driver">
                  <p>
                    Saved drivers for this circuit: generation {saved.generation}, best lap{' '}
                    <span className="mono">{formatLapTime(saved.recordLap)}</span>
                    {saved.trackKey !== studioKey && ' (trained before the circuit was last edited)'}
                  </p>
                  <div className="button-row">
                    <button
                      type="button"
                      disabled={!studioDrivable}
                      onClick={() => void actions.start(studioDef, 'saved')}
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Delete the saved drivers for this circuit? This cannot be undone.')) {
                          void actions.discardSaved(studioDef.id)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="segmented" role="group" aria-label="Simulation speed">
                {SPEED_LABELS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.title}
                    className={speed === s.id ? 'is-active' : undefined}
                    aria-pressed={speed === s.id}
                    onClick={() => actions.setSpeed(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
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
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Stop this training run? Saved drivers are kept.')) actions.reset()
                  }}
                >
                  Stop
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Progress</h2>
          {history.length === 0 ? (
            <p className="muted">
              Drivers start with random networks and crash almost at once. Each generation keeps the ones that got
              furthest and breeds from them.
            </p>
          ) : (
            <>
              <dl className="stats">
                <Stat label="Generation" value={String(latest.generation)} />
                <Stat label="Record lap" value={formatLapTime(recordLap)} />
                <Stat label="Completed a lap" value={`${latest.finishers} of ${populationSize}`} />
                <Stat label="Crashed" value={`${latest.crashed} of ${populationSize}`} />
                <Stat label="Furthest car" value={`${Math.min(100, Math.round(latest.bestProgress * 100))} % of a lap`} />
                <Stat label="Mutation size" value={latest.sigma.toFixed(2)} />
              </dl>

              {recordLap === null ? (
                <>
                  <h3>Furthest progress round the lap</h3>
                  <LineChart x={charts.x} series={charts.progress} formatY={formatPercent} />
                </>
              ) : (
                <>
                  <h3>Lap time</h3>
                  <LineChart x={charts.x} series={charts.lap} formatY={formatSeconds} />
                </>
              )}
              <h3>Fitness</h3>
              <LineChart x={charts.x} series={charts.fitness} formatY={formatFitness} />
            </>
          )}
        </section>
      </aside>
    </div>
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

interface CanvasProps {
  track: ReturnType<typeof buildTrack>
  paths: ReturnType<typeof buildTrackPaths> | null
  ghost: Float32Array | null
}

function TrainingCanvas({ track, paths, ghost }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<EvolutionView | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const view = new EvolutionView(canvas)
    viewRef.current = view
    const resize = () => view.resize(wrap.clientWidth, wrap.clientHeight, window.devicePixelRatio || 1)
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    return () => {
      observer.disconnect()
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    viewRef.current?.setTrack(track, paths)
  }, [track, paths])

  useEffect(() => {
    viewRef.current?.setGhost(ghost)
  }, [ghost])

  return (
    <div className="evolution-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="Training view: the population of cars on the circuit" />
    </div>
  )
}

interface ReadoutProps {
  active: boolean
  population: number
  recordLap: number | null
  trackName: string
}

/** Generation clock and car count, sampled a few times a second from the live frame. */
function LiveReadout({ active, population, recordLap, trackName }: ReadoutProps) {
  const [live, setLive] = useState({ generation: 0, time: 0, running: 0 })

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      setLive({ generation: liveFrame.generation, time: liveFrame.time, running: liveFrame.running })
    }, 200)
    return () => clearInterval(id)
  }, [active])

  return (
    <div className="live-readout">
      <strong>{trackName}</strong>
      {active ? (
        <>
          <span>
            Generation <b>{live.generation}</b>
          </span>
          <span>
            <b>{live.time.toFixed(1)}</b> s
          </span>
          <span>
            <b>{live.running}</b> of {population} running
          </span>
          <span>
            Record <b>{formatLapTime(recordLap)}</b>
          </span>
        </>
      ) : (
        <span>Not training</span>
      )}
    </div>
  )
}
