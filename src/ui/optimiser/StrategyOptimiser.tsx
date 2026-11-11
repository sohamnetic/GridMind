import { useMemo } from 'react'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import type { Strategy } from '../../core/race/strategy'
import { COMPOUNDS } from '../../core/race/tyres'
import type { OptimiserProgress, RankedPlan } from '../../core/strategy/optimiser'
import type { Slice, StrategyStats } from '../../core/strategy/stats'
import { analyseTrack, isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { buildPitLane } from '../../core/track/pit'
import { defaultLaps, LAP_OPTIONS } from '../../state/fullRaceStore'
import { DEPTHS, useOptimiserStore, type DepthId, type OptimiserStudy } from '../../state/optimiserStore'
import { useStudioStore } from '../../state/studioStore'
import { useTrackProfile } from '../race/useTrackProfile'
import { ProfileCard } from '../race/WheelRace'
import {
  formatPosition,
  formatShare,
  PitWindowMap,
  PositionHistogram,
  SpreadBar,
  StintBar,
} from './OptimiserCharts'
import '../evolution/evolution.css'
import '../race/race.css'
import './optimiser.css'

const STAGES: Record<OptimiserProgress['stage'], string> = {
  first: 'First round: every candidate',
  final: 'Final: the leaders, on fresh races',
  window: 'Mapping the pit window',
}

/** "Soft, then hard: stop on lap 15". */
function describePlan(strategy: Strategy): string {
  const tyres = [strategy.start, ...strategy.stops.map((s) => s.compound)].map((c) => COMPOUNDS[c].label.toLowerCase())
  const laps = strategy.stops.map((s) => s.lap)
  const stops =
    laps.length === 1
      ? `stop on lap ${laps[0]}`
      : `stops on laps ${laps.slice(0, -1).join(', ')} and ${laps[laps.length - 1]}`
  const sequence = tyres.join(', then ')
  return `${sequence.charAt(0).toUpperCase()}${sequence.slice(1)}: ${stops}`
}

/** The strategy optimiser: thousands of simulated races to rank one car's strategies. */
export function StrategyOptimiser() {
  const def = useStudioStore((s) => s.def)
  const lapsChoice = useOptimiserStore((s) => s.laps)
  const rainChance = useOptimiserStore((s) => s.rainChance)
  const driver = useOptimiserStore((s) => s.driver)
  const depth = useOptimiserStore((s) => s.depth)
  const seed = useOptimiserStore((s) => s.seed)
  const status = useOptimiserStore((s) => s.status)
  const progress = useOptimiserStore((s) => s.progress)
  const error = useOptimiserStore((s) => s.error)
  const study = useOptimiserStore((s) => s.study)
  const selected = useOptimiserStore((s) => s.selected)
  const actions = useOptimiserStore.getState()

  const scene = useMemo(() => {
    const track = buildTrack(def)
    return {
      track,
      analysis: track ? analyseTrack(track) : null,
      pitLength: track ? (buildPitLane(track)?.length ?? 0) : 0,
      drivable: track !== null && isDrivable(validateTrack(track)),
    }
  }, [def])
  const profile = useTrackProfile(def.id, scene)
  const laps = lapsChoice ?? (profile ? defaultLaps(profile.length) : LAP_OPTIONS[2])
  const running = status === 'running'
  const ready = profile !== null && scene.drivable

  const ranked = study?.result.ranked ?? []
  const plan = ranked.find((r) => r.candidate.key === selected) ?? ranked[0] ?? null

  return (
    <div className="fullrace">
      <div className="fullrace-main">
        {!study || !plan ? (
          <div className="fullrace-empty">
            <h1>Strategy optimiser</h1>
            <p>
              Picks the best race strategy for one car by racing it thousands of times. Every candidate plan meets the
              same grids, weather and safety cars, so the plans are compared on equal terms. Your car starts from the
              plan and its pit wall still reacts to rain, safety cars and worn-out tyres, as the rest of the field does.
            </p>
            <p className="muted">Choose a car, a distance and a chance of rain, then find the best strategy.</p>
            {running && <ProgressBar progress={progress} />}
          </div>
        ) : (
          <Results study={study} plan={plan} currentTrackId={def.id} />
        )}
      </div>

      <aside className="studio-side evolution-side" aria-label="Study setup and selected plan">
        <section className="panel">
          <h2>Study setup</h2>
          {!scene.drivable && (
            <p className="issue issue-error">
              This circuit has problems. <a href="#/studio">Fix it in the Track Studio</a> before racing on it.
            </p>
          )}
          <fieldset className="fields race-setup" disabled={running}>
            <label className="field opt-wide">
              <span>Your car</span>
              <select value={driver} onChange={(e) => actions.setOptions({ driver: Number(e.target.value) })}>
                {TEAMS.map((team, t) => (
                  <optgroup key={team.id} label={team.name}>
                    {DRIVERS.map((d, i) =>
                      d.team === t ? (
                        <option key={d.code} value={i}>
                          {d.name}
                        </option>
                      ) : null,
                    )}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Laps</span>
              <select value={laps} onChange={(e) => actions.setOptions({ laps: Number(e.target.value) })}>
                {LAP_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Depth</span>
              <select value={depth} onChange={(e) => actions.setOptions({ depth: e.target.value as DepthId })}>
                {DEPTHS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.runs} races a plan)
                  </option>
                ))}
              </select>
            </label>
            <label className="field opt-wide">
              <span>
                Chance of rain
                <output>{Math.round(rainChance * 100)} %</output>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={rainChance}
                onChange={(e) => actions.setOptions({ rainChance: Number(e.target.value) })}
              />
            </label>
            <label className="field opt-wide">
              <span>Seed</span>
              <input
                type="number"
                min={1}
                max={999999}
                value={seed}
                onChange={(e) => actions.setOptions({ seed: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
              />
            </label>
          </fieldset>
          {running ? (
            <>
              <button type="button" className="primary is-stop" onClick={actions.cancel}>
                Cancel
              </button>
              {study && <ProgressBar progress={progress} />}
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!ready}
              onClick={() => profile && actions.run(profile, laps, { id: def.id, name: def.name })}
            >
              Find the best strategy
            </button>
          )}
          {error && <p className="issue issue-error">{error}</p>}
        </section>

        {study && plan && <PlanCard study={study} plan={plan} best={ranked[0]} />}
        {profile && <ProfileCard profile={profile} />}
      </aside>
    </div>
  )
}

function ProgressBar({ progress }: { progress: OptimiserProgress | null }) {
  const share = progress && progress.total > 0 ? progress.done / progress.total : 0
  return (
    <div className="opt-progress">
      <div
        className="opt-progress-track"
        role="progressbar"
        aria-label="Optimiser progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div className="opt-progress-fill" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="muted">
        {progress
          ? `${STAGES[progress.stage]} · ${progress.done.toLocaleString('en-GB')} of about ${progress.total.toLocaleString('en-GB')} races`
          : 'Starting the simulation workers…'}
      </p>
    </div>
  )
}

function Results({ study, plan, currentTrackId }: { study: OptimiserStudy; plan: RankedPlan; currentTrackId: string }) {
  const { result } = study
  const { setup, ranked } = result
  const best = ranked[0]
  const who = DRIVERS[setup.driver]
  const select = useOptimiserStore.getState().select
  const finalists = useMemo(() => new Set(result.ranked.map((r) => r.candidate.key)), [result])
  const pick = (key: string) => select(key === best.candidate.key ? null : key)
  const isBest = plan === best

  return (
    <>
      <header className="fullrace-head">
        <h1>{study.trackName}</h1>
        <p>
          Best plan for {who.name} ({TEAMS[who.team].name}) over {setup.laps} laps: {describePlan(best.candidate.strategy)}.
          Average finish {formatPosition(best.stats.meanPosition)}, in the points in {formatShare(best.stats.points)} of
          races.
        </p>
        {study.trackId !== currentTrackId && (
          <p className="muted">These results are for {study.trackName}, not the circuit now open in the Track Studio.</p>
        )}
      </header>

      <h3>Strategy ranking</h3>
      <div className="opt-table">
        <table className="timing opt-ranking">
          <thead>
            <tr>
              <th scope="col" className="num">
                #
              </th>
              <th scope="col">Plan</th>
              <th scope="col">Stops on lap</th>
              <th scope="col" className="num">
                Avg. finish
              </th>
              <th scope="col" title="Where the car finishes in the middle 80 % of races; the dot is the median">
                P1 … P{setup.cars}
              </th>
              <th scope="col" className="num">
                Win
              </th>
              <th scope="col" className="num">
                Podium
              </th>
              <th scope="col" className="num">
                Points
              </th>
              <th scope="col" className="num" title="Average race time against the top plan">
                Race time
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const delta = r.stats.meanTime - best.stats.meanTime
              return (
                <tr
                  key={r.candidate.key}
                  className={r === plan ? 'is-selected' : undefined}
                  onClick={() => pick(r.candidate.key)}
                >
                  <td className="num">{i + 1}</td>
                  <th scope="row">
                    <span className="opt-plan">
                      <span className="opt-plan-label">{r.candidate.label}</span>
                      <StintBar strategy={r.candidate.strategy} laps={setup.laps} />
                    </span>
                  </th>
                  <td>{r.candidate.strategy.stops.map((s) => s.lap).join(', ')}</td>
                  <td className="num">{formatPosition(r.stats.meanPosition)}</td>
                  <td>
                    <SpreadBar stats={r.stats} cars={setup.cars} />
                  </td>
                  <td className="num">{formatShare(r.stats.win)}</td>
                  <td className="num">{formatShare(r.stats.podium)}</td>
                  <td className="num">{formatShare(r.stats.points)}</td>
                  <td className="num">{i === 0 ? 'Top plan' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} s`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="chart-key">
        {(['soft', 'medium', 'hard'] as const).map((c) => (
          <li key={c}>
            <span className="key-swatch" style={{ background: COMPOUNDS[c].color }} /> {COMPOUNDS[c].label}
          </li>
        ))}
        <li className="muted">Select a row to see that plan in detail.</li>
      </ul>

      <h3>
        Finishing positions: {plan.candidate.label}, {stopsText(plan.candidate.strategy)}
      </h3>
      <PositionHistogram stats={plan.stats} reference={isBest ? null : best.stats} cars={setup.cars} />
      {!isBest && (
        <ul className="chart-key">
          <li>
            <span className="key-swatch opt-key-bar" /> This plan
          </li>
          <li>
            <span className="opt-key-ref" /> Top plan ({best.candidate.label}, {stopsText(best.candidate.strategy)})
          </li>
        </ul>
      )}

      <h3>Pit window: one stop</h3>
      <p className="muted opt-note">
        Average finish for every one-stop plan, by tyres and stop lap ({result.oneStop.runs} races a cell). Plans with a
        stint too long for its tyres are marked: the car is forced into an extra stop, so they are not ranked above.
      </p>
      <PitWindowMap
        map={result.oneStop}
        describe={(r, c) => `${result.oneStop.rows[r]}, stop on lap ${result.oneStop.laps[c]}`}
        rowTitle="Tyres"
        columnTitle="Stop lap"
        selected={plan.candidate.key}
        onPick={pick}
        pickable={finalists}
      />

      {result.twoStop && (
        <>
          <h3>Pit window: two stops on {result.twoStop.label}</h3>
          <p className="muted opt-note">
            The best two-stop tyre sequence at every pair of stop laps ({result.twoStop.runs} races a cell).
          </p>
          <PitWindowMap
            map={result.twoStop}
            describe={(r, c) =>
              `${result.twoStop!.label}, stops on laps ${result.twoStop!.laps[c]} and ${result.twoStop!.laps[r]}`
            }
            rowTitle="Second stop lap"
            columnTitle="First stop lap"
            selected={plan.candidate.key}
            onPick={pick}
            pickable={finalists}
          />
        </>
      )}

      <p className="muted opt-note">
        {result.candidates} plans raced {result.coarseRuns} times each, then the best {ranked.length} raced{' '}
        {result.finalRuns.toLocaleString('en-GB')} times each on fresh races: {result.races.toLocaleString('en-GB')} races
        in {study.seconds.toFixed(1)} s on {study.workers} worker{study.workers === 1 ? '' : 's'}.
      </p>
    </>
  )
}

function stopsText(strategy: Strategy): string {
  const laps = strategy.stops.map((s) => s.lap)
  return laps.length === 1 ? `stop on lap ${laps[0]}` : `stops on laps ${laps.join(', ')}`
}

/** The selected plan in numbers, and how it fares when the race changes. */
function PlanCard({ study, plan, best }: { study: OptimiserStudy; plan: RankedPlan; best: RankedPlan }) {
  const { stats } = plan
  const isBest = plan === best
  const conditions: { label: string; pick: (s: StrategyStats) => Slice }[] = [
    { label: 'Safety car', pick: (s) => s.safety },
    { label: 'No safety car', pick: (s) => s.green },
    { label: 'Rain', pick: (s) => s.rain },
    { label: 'Dry', pick: (s) => s.dry },
  ]
  return (
    <section className="panel">
      <h2>{isBest ? 'Top plan' : 'Selected plan'}</h2>
      <p className="opt-plan-text">{describePlan(plan.candidate.strategy)}.</p>
      <StintBar strategy={plan.candidate.strategy} laps={study.result.setup.laps} />
      <dl className="stats opt-stats">
        <div>
          <dt>Average finish</dt>
          <dd>{formatPosition(stats.meanPosition)}</dd>
        </div>
        <div>
          <dt>Typical range</dt>
          <dd>
            P{stats.p10} to P{stats.p90}
          </dd>
        </div>
        <div>
          <dt>Win</dt>
          <dd>{formatShare(stats.win)}</dd>
        </div>
        <div>
          <dt>Podium</dt>
          <dd>{formatShare(stats.podium)}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{formatShare(stats.points)}</dd>
        </div>
        <div>
          <dt>Retires</dt>
          <dd>{formatShare(stats.retired)}</dd>
        </div>
        <div>
          <dt>Stops planned</dt>
          <dd>{plan.candidate.strategy.stops.length}</dd>
        </div>
        <div>
          <dt>Stops made</dt>
          <dd>{stats.meanStops.toFixed(1)} on average</dd>
        </div>
      </dl>

      <h3 className="opt-sub">When the race changes</h3>
      <table className="timing strategy-table">
        <thead>
          <tr>
            <th scope="col">Races with</th>
            <th scope="col" className="num">
              Share
            </th>
            <th scope="col" className="num">
              This plan
            </th>
            {!isBest && (
              <th scope="col" className="num">
                Top plan
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {conditions.map(({ label, pick }) => {
            const mine = pick(stats)
            const top = pick(best.stats)
            return (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className="num">{formatShare(mine.runs / Math.max(1, stats.runs))}</td>
                <td className="num">{mine.runs > 0 ? formatPosition(mine.meanPosition) : '–'}</td>
                {!isBest && <td className="num">{top.runs > 0 ? formatPosition(top.meanPosition) : '–'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted">Average finish in the races where each thing happened.</p>
    </section>
  )
}
