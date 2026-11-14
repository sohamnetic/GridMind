import { useMemo } from 'react'
import type { CallReview, Verdict } from '../../core/pitwall/debrief'
import type { DecisionType } from '../../core/pitwall/session'
import type { RaceState, Stint } from '../../core/race/engine'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import { COMPOUNDS, type Compound } from '../../core/race/tyres'
import type { DebriefState } from '../../state/pitwallStore'
import { PositionChart, StintChart } from '../race/RaceCharts'

const REASONS: Record<DecisionType, string> = {
  safety: 'Safety car out',
  rain: 'Rain starting',
  crossover: 'Track changing',
  cliff: 'Tyres at the cliff',
  window: 'Pit window open',
}

const VERDICTS: Record<Verdict, string> = { good: 'Good call', fair: 'Slightly off', costly: 'Costly' }

function callText(id: string): string {
  if (id === 'stay') return 'Stay out'
  const compound = id.slice(4) as Compound
  return `Box: ${COMPOUNDS[compound]?.label ?? compound}`
}

const stintText = (stints: readonly Stint[]) =>
  stints
    .filter((s) => s.to >= s.from)
    .map((s) => `${COMPOUNDS[s.compound].label} ${s.to - s.from + 1}`)
    .join(' · ')

/** Laps in a row with the same call, the same answer from the engine and the same verdict, shown as one line. */
interface CallRun {
  from: number
  to: number
  chosen: string
  best: string
  verdict: Verdict
  /** Largest cost of any lap in the run. */
  loss: number
  seconds: number
  reasons: DecisionType[]
  safety: boolean
  wet: boolean
  position: number
}

function callRuns(reviews: readonly CallReview[]): CallRun[] {
  const runs: CallRun[] = []
  for (const r of reviews) {
    const notable = r.verdict !== 'good' || r.chosen !== 'stay' || r.reasons.length > 0
    if (!notable) continue
    const last = runs[runs.length - 1]
    if (last && last.to === r.lap - 1 && last.chosen === r.chosen && last.best === r.best && last.verdict === r.verdict) {
      last.to = r.lap
      if (r.loss > last.loss) {
        last.loss = r.loss
        last.seconds = r.seconds
      }
      for (const reason of r.reasons) if (!last.reasons.includes(reason)) last.reasons.push(reason)
      last.safety ||= r.safetyCar !== 'none'
      last.wet ||= r.wetness > 0.1
    } else {
      runs.push({
        from: r.lap,
        to: r.lap,
        chosen: r.chosen,
        best: r.best,
        verdict: r.verdict,
        loss: r.loss,
        seconds: r.seconds,
        reasons: [...r.reasons],
        safety: r.safetyCar !== 'none',
        wet: r.wetness > 0.1,
        position: r.position,
      })
    }
  }
  return runs
}

interface Props {
  race: RaceState
  driver: number
  /** The cars the player ran. With two, the debrief can be switched between them. */
  cars?: readonly number[]
  onCar?: (car: number) => void
  trackName: string
  debrief: DebriefState
}

/** After the flag: the result, the engine's run of the same race, and every call that mattered. */
export function Debrief({ race, driver, cars = [], onCar, trackName, debrief }: Props) {
  const me = race.cars[driver]
  const who = DRIVERS[driver]
  const { reviews, engine } = debrief
  const runs = useMemo(() => callRuns(reviews), [reviews])
  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { good: 0, fair: 0, costly: 0 }
    for (const r of reviews) c[r.verdict]++
    return c
  }, [reviews])
  const result = me.running ? `P${me.position}` : `Retired on lap ${me.outLap}`
  const share = debrief.total > 0 ? debrief.done / debrief.total : 0

  let versus = ''
  if (engine && me.running) {
    const diff = me.position - engine.position
    versus = engine.retired
      ? 'In the engine’s run the car retired.'
      : diff === 0
        ? 'You matched the strategy engine.'
        : diff < 0
          ? `You beat the strategy engine by ${-diff} place${diff === -1 ? '' : 's'}.`
          : `The strategy engine finished ${diff} place${diff === 1 ? '' : 's'} higher.`
  }

  return (
    <div className="fullrace-main pw-debrief">
      <header className="fullrace-head">
        <h1>
          Debrief: {trackName}, {result}
        </h1>
        <p>
          {who.name} ({TEAMS[who.team].name}) started P{me.grid}
          {me.running ? ` and finished P${me.position}` : ''} on {stintText(me.stints) || 'no laps'}.
          {me.penalty > 0 ? ` Includes a ${me.penalty} s penalty for using only one dry compound.` : ''}
        </p>
        {cars.length > 1 && (
          <div className="pw-cars pw-debrief-cars" role="tablist" aria-label="Whose calls to review">
            {cars.map((car) => (
              <button
                key={car}
                type="button"
                role="tab"
                aria-selected={car === driver}
                className={car === driver ? 'pw-car-tab is-active' : 'pw-car-tab'}
                onClick={() => onCar?.(car)}
              >
                <span className="pw-car-code">{DRIVERS[car].name}</span>
                <span className="pw-car-place">
                  {race.cars[car].running ? `P${race.cars[car].position}` : 'Retired'}
                </span>
              </button>
            ))}
          </div>
        )}
      </header>

      {debrief.status === 'running' && (
        <div className="opt-progress">
          <div
            className="opt-progress-track"
            role="progressbar"
            aria-label="Debrief progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
          >
            <div className="opt-progress-fill" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="muted">
            Replaying every call: the strategy engine plays the race out from each lap, for each option.
          </p>
        </div>
      )}

      {engine && (
        <>
          <h3>The strategy engine, same race</h3>
          <div className="pw-versus">
            <div>
              <span className="pw-versus-who">You</span>
              <b>{result}</b>
              <span>{stintText(me.stints)}</span>
            </div>
            <div>
              <span className="pw-versus-who">Engine</span>
              <b>{engine.retired ? 'Retired' : `P${engine.position}`}</b>
              <span>{stintText(engine.stints)}</span>
            </div>
          </div>
          <p className="muted opt-note">
            {versus} It had the same grid, weather, safety cars and luck, and no more of the forecast than you did.
          </p>
        </>
      )}

      {debrief.status === 'done' && (
        <>
          <h3>Your calls, lap by lap</h3>
          <div className="pw-strip" role="img" aria-label={`${counts.good} good calls, ${counts.fair} slightly off, ${counts.costly} costly`}>
            {reviews.map((r) => (
              <span
                key={r.lap}
                className={`pw-strip-cell is-${r.verdict}`}
                title={`Lap ${r.lap}: ${callText(r.chosen)}. ${VERDICTS[r.verdict]}${r.verdict === 'good' ? '' : `, engine: ${callText(r.best).toLowerCase()}, about ${r.loss.toFixed(1)} places`}`}
              />
            ))}
          </div>
          <ul className="chart-key">
            <li>
              <span className="key-swatch pw-key-good" /> Good call ({counts.good})
            </li>
            <li>
              <span className="key-swatch pw-key-fair" /> Slightly off ({counts.fair})
            </li>
            <li>
              <span className="key-swatch pw-key-costly" /> Costly ({counts.costly})
            </li>
          </ul>

          <h3>Calls that mattered</h3>
          {runs.length === 0 ? (
            <p className="muted">Nothing to pick over: no stops, no decision points and no costly laps.</p>
          ) : (
            <div className="opt-table">
              <table className="timing pw-calls">
                <thead>
                  <tr>
                    <th scope="col">Lap</th>
                    <th scope="col">Situation</th>
                    <th scope="col">Your call</th>
                    <th scope="col">Engine’s call</th>
                    <th scope="col" className="num" title="Expected finishing places lost against the engine’s call, with race time counted in">
                      Cost
                    </th>
                    <th scope="col">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const situation = [
                      `P${run.position}`,
                      ...run.reasons.map((r) => REASONS[r]),
                      run.safety && !run.reasons.includes('safety') ? 'Behind the safety car' : '',
                      run.wet && !run.reasons.includes('rain') && !run.reasons.includes('crossover') ? 'Wet track' : '',
                    ].filter(Boolean)
                    const many = run.to > run.from
                    return (
                      <tr key={run.from}>
                        <td className="num">{many ? `${run.from}–${run.to}` : run.from}</td>
                        <td className="pw-wrap">{situation.join(' · ')}</td>
                        <th scope="row">{callText(run.chosen)}</th>
                        <td>{run.chosen === run.best ? 'Same' : callText(run.best)}</td>
                        <td className="num">
                          {run.loss < 0.05
                            ? '–'
                            : `${many ? 'up to ' : ''}${run.loss.toFixed(1)} places${run.seconds > 0.5 ? ` (${run.seconds.toFixed(0)} s)` : ''}${many ? ' a lap' : ''}`}
                        </td>
                        <td>
                          <span className={`pw-verdict is-${run.verdict}`}>{VERDICTS[run.verdict]}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted opt-note">
            Each call is judged by playing the rest of the race out many times from that lap, once for each option, with
            the engine in charge afterwards. Cost is the average finishing places lost; small differences are noise and
            count as good calls.
          </p>
        </>
      )}

      <h3>Lap chart</h3>
      <PositionChart race={race} viewLap={race.totalLaps} selected={driver} onSelect={() => {}} />
      <h3>Tyre stints, in finishing order</h3>
      <StintChart race={race} viewLap={race.totalLaps} selected={driver} onSelect={() => {}} />
    </div>
  )
}
