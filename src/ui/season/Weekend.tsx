import { useMemo, useState } from 'react'
import { formatLapTime } from '../../core/physics/lapTimer'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import { rankStrategies, STATIONARY_TIME } from '../../core/race/strategy'
import { COMPOUNDS } from '../../core/race/tyres'
import { playerParams } from '../../core/season/practice'
import {
  gridPosition,
  mistakeChance,
  playerRunning,
  QUALI_PARTS,
  RISKS,
  startQualifying,
  THROUGH,
} from '../../core/season/qualifying'
import { currentRound, heatFactor, roundProfile, teamMate } from '../../core/season/season'
import { PRACTICE_BLOCKS, planBlocks, setupGains } from '../../core/season/setup'
import type { LongRun, PracticePlan, QualiSegment, Risk, Season } from '../../core/season/types'
import { buildTrack } from '../../core/track/build'
import type { TrackDef } from '../../core/track/types'
import { usePitWallStore } from '../../state/pitwallStore'
import { useSeasonStore } from '../../state/seasonStore'
import type { Route } from '../app/useHashRoute'
import { Thumbnail } from '../home/Home'
import { describePlan, gap, ordinal } from './format'

// ---------- The weekend at a glance ----------

/** The same four words the Race Engine's circuit card uses. */
function overtakingWord(difficulty: number): string {
  if (difficulty < 0.35) return 'Easy to pass'
  if (difficulty < 0.55) return 'Passing takes work'
  if (difficulty < 0.75) return 'Hard to pass'
  return 'Very hard to pass'
}

function heatWord(temperature: number): string {
  const change = Math.round((heatFactor(temperature) - 1) * 100)
  if (change >= 3) return `tyres wear ${change} % faster`
  if (change <= -3) return `tyres wear ${-change} % slower`
  return 'normal tyre wear'
}

function RoundThumb({ def }: { def: TrackDef }) {
  const track = useMemo(() => buildTrack(def), [def])
  return track ? <Thumbnail track={track} /> : null
}

export function WeekendHeader({ season }: { season: Season }) {
  const round = currentRound(season)
  const profile = roundProfile(round)
  return (
    <section className="season-card weekend-head">
      <div className="weekend-thumb">
        <RoundThumb def={round.def} />
      </div>
      <div className="weekend-facts">
        <p className="season-eyebrow">
          Round {season.round + 1} of {season.rounds.length}
        </p>
        <h2>{round.name}</h2>
        <dl className="fact-row">
          <div>
            <dt>Race</dt>
            <dd>
              {round.laps} laps · {((round.laps * profile.length) / 1000).toFixed(0)} km
            </dd>
          </div>
          <div>
            <dt>Track</dt>
            <dd>
              {round.temperature} °C · {heatWord(round.temperature)}
            </dd>
          </div>
          <div>
            <dt>Rain</dt>
            <dd>{Math.round(round.rainChance * 100)} % chance in the race</dd>
          </div>
          <div>
            <dt>Racing</dt>
            <dd>{overtakingWord(profile.overtakingDifficulty)}</dd>
          </div>
          <div>
            <dt>Pit stop</dt>
            <dd>about {(profile.pitLossTime + STATIONARY_TIME).toFixed(0)} s</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

// ---------- Practice ----------

const PROGRAMMES: readonly {
  id: keyof PracticePlan
  label: string
  text: string
}[] = [
  {
    id: 'quali',
    label: 'Qualifying runs',
    text: 'Low fuel, soft tyres. Finds one-lap pace for your grid slot.',
  },
  {
    id: 'race',
    label: 'Race runs',
    text: 'Long runs on race fuel. Finds race pace, and shows how each tyre wears.',
  },
  {
    id: 'pit',
    label: 'Pit-stop drills',
    text: 'The crew practises. Quicker stops, and fewer slow ones.',
  },
]

function gainText(id: keyof PracticePlan, plan: PracticePlan, baseLap: number): string {
  const gains = setupGains(plan)
  if (id === 'quali')
    return gains.quali > 0 ? `${(gains.quali * baseLap).toFixed(2)} s a lap quicker in qualifying` : 'No gain'
  if (id === 'race')
    return gains.race > 0 ? `${(gains.race * baseLap).toFixed(2)} s a lap quicker in the race` : 'No gain'
  return gains.pit > 0 ? `${gains.pit.toFixed(2)} s quicker at every stop` : 'No gain'
}

/** Lap times of the long runs, one line per compound. */
function LongRunChart({ runs }: { runs: LongRun[] }) {
  const W = 560
  const H = 210
  const pad = { left: 66, right: 66, top: 12, bottom: 42 }
  const longest = Math.max(...runs.map((r) => r.laps.length))
  const all = runs.flatMap((r) => r.laps)
  const low = Math.min(...all)
  // The laps past the cliff shoot off the top: the scale stops a little above the last good lap.
  const good = runs.flatMap((r) => r.laps.slice(0, (r.cliffLap ?? r.laps.length + 1) - 1))
  const high = Math.min(Math.max(...all), Math.max(...good) + (Math.max(...good) - low) * 0.6 + 0.2)
  const x = (lap: number) => pad.left + ((lap - 1) / Math.max(1, longest - 1)) * (W - pad.left - pad.right)
  const y = (t: number) =>
    pad.top + (1 - (Math.min(t, high) - low) / Math.max(1e-6, high - low)) * (H - pad.top - pad.bottom)
  const ticks = [low, (low + high) / 2, high]
  const lapTicks: number[] = []
  for (let lap = 1; lap <= longest; lap += longest > 20 ? 5 : longest > 10 ? 2 : 1) lapTicks.push(lap)
  // Labels at the line ends, moved apart where two lines finish close together.
  const labels = runs
    .map((run) => ({
      compound: run.compound,
      x: x(run.laps.length) + 8,
      y: y(run.laps[run.laps.length - 1]) + 4,
    }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14)

  return (
    <figure className="run-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lap times of the long runs, by tyre compound">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="run-grid" />
            <text x={pad.left - 8} y={y(t) + 4} className="run-axis" textAnchor="end">
              {formatLapTime(t)}
            </text>
          </g>
        ))}
        {lapTicks.map((lap) => (
          <text key={lap} x={x(lap)} y={H - 24} className="run-axis" textAnchor="middle">
            {lap}
          </text>
        ))}
        <text x={(pad.left + W - pad.right) / 2} y={H - 7} className="run-axis run-axis-title" textAnchor="middle">
          lap of the run
        </text>
        {runs.map((run) => {
          const color = COMPOUNDS[run.compound].color
          const d = run.laps.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i + 1).toFixed(1)} ${y(t).toFixed(1)}`).join('')
          return (
            <g key={run.compound}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              {run.laps.map((t, i) => (
                <circle
                  key={i}
                  cx={x(i + 1)}
                  cy={y(t)}
                  r={i + 1 === run.cliffLap ? 4.5 : 2.2}
                  fill={color}
                  className="run-point"
                >
                  <title>
                    {COMPOUNDS[run.compound].label}, lap {i + 1}: {formatLapTime(t)}
                    {i + 1 === run.cliffLap ? ' (the cliff)' : ''}
                  </title>
                </circle>
              ))}
            </g>
          )
        })}
        {labels.map((label) => (
          <text key={label.compound} x={label.x} y={label.y} className="run-label">
            {COMPOUNDS[label.compound].label}
          </text>
        ))}
      </svg>
      <figcaption>
        Each line is one set of tyres on race fuel. The large dot is the cliff, where the grip goes; laps beyond it are
        off the top of the chart.
      </figcaption>
    </figure>
  )
}

function RunTable({ runs }: { runs: LongRun[] }) {
  return (
    <div className="season-scroll">
      <table className="season-table run-table">
        <thead>
          <tr>
            <th scope="col">Tyre</th>
            <th scope="col" className="num">
              First lap
            </th>
            <th scope="col" className="num">
              Loses per lap
            </th>
            <th scope="col" className="num">
              Cliff
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const good = run.laps.slice(0, (run.cliffLap ?? run.laps.length + 1) - 1)
            const loss = good.length > 1 ? (good[good.length - 1] - good[0]) / (good.length - 1) : 0
            return (
              <tr key={run.compound}>
                <th scope="row">
                  <span className="tyre-dot" style={{ background: COMPOUNDS[run.compound].color }} aria-hidden="true" />{' '}
                  {COMPOUNDS[run.compound].label}
                </th>
                <td className="num">{formatLapTime(run.laps[0])}</td>
                <td className="num">{loss.toFixed(3)} s</td>
                <td className="num">{run.cliffLap ? `lap ${run.cliffLap}` : `not in ${run.laps.length} laps`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function PracticeCard({ season }: { season: Season }) {
  const practice = useSeasonStore((s) => s.practice)
  const [plan, setPlan] = useState<PracticePlan>({ quali: 2, race: 3, pit: 1 })
  const baseLap = roundProfile(currentRound(season)).baseLapTime
  const done = season.practice
  const left = PRACTICE_BLOCKS - planBlocks(plan)

  if (done) {
    const g = done.gains
    return (
      <section className="season-card stage-card is-done">
        <h2>
          <span className="stage-chip">✓</span> Practice
        </h2>
        <p className="season-note">
          Set-up found: <strong>{(g.quali * baseLap).toFixed(2)} s</strong> a lap for qualifying,{' '}
          <strong>{(g.race * baseLap).toFixed(2)} s</strong> a lap for the race, <strong>{g.pit.toFixed(2)} s</strong>{' '}
          at each pit stop.
        </p>
        {done.runs.length > 0 ? (
          <>
            <LongRunChart runs={done.runs} />
            <RunTable runs={done.runs} />
          </>
        ) : (
          <p className="season-note">No race runs were done, so there is no tyre data from this session.</p>
        )}
      </section>
    )
  }

  if (season.stage !== 'practice') return null
  return (
    <section className="season-card stage-card is-open">
      <h2>
        <span className="stage-chip">1</span> Practice
      </h2>
      <p className="season-note">
        The session is six blocks of track time. Each extra block on the same programme finds less than the one before,
        so the question is what to be good at this weekend.
      </p>
      <div className="programmes">
        {PROGRAMMES.map((p) => (
          <div key={p.id} className="programme">
            <div className="programme-text">
              <strong>{p.label}</strong>
              <span>{p.text}</span>
              <em>{gainText(p.id, plan, baseLap)}</em>
            </div>
            <div className="stepper" role="group" aria-label={`${p.label}: blocks`}>
              <button
                type="button"
                aria-label={`One block fewer for ${p.label.toLowerCase()}`}
                disabled={plan[p.id] === 0}
                onClick={() => setPlan({ ...plan, [p.id]: plan[p.id] - 1 })}
              >
                −
              </button>
              <output>{plan[p.id]}</output>
              <button
                type="button"
                aria-label={`One block more for ${p.label.toLowerCase()}`}
                disabled={left === 0}
                onClick={() => setPlan({ ...plan, [p.id]: plan[p.id] + 1 })}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="stage-actions">
        <button type="button" className="cta" data-coach="season-practice" onClick={() => practice(plan)}>
          Run practice
        </button>
        <span className="season-note">
          {left === 0 ? 'All six blocks used.' : `${left} block${left === 1 ? '' : 's'} not used.`} The first race run
          is on mediums, the second on hards, the third on softs.
        </span>
      </div>
    </section>
  )
}

// ---------- Qualifying ----------

const RISK_ORDER: readonly Risk[] = ['safe', 'push', 'limit']
const NOTE_TEXT = {
  clean: '',
  mistake: 'mistake',
  crash: 'crashed',
  none: 'no lap',
} as const

function riskDetail(risk: Risk, wet: boolean, baseLap: number): string {
  const info = RISKS[risk]
  const pace =
    info.pace === 0
      ? 'normal pace'
      : `${Math.abs(info.pace * baseLap).toFixed(2)} s ${info.pace < 0 ? 'quicker' : 'slower'}`
  return `${pace} · ${Math.round(mistakeChance(risk, wet) * 100)} % ruined`
}

function SegmentTable({ segment, driver }: { segment: QualiSegment; driver: number }) {
  const pole = segment.times[0]?.best ?? 0
  const cut = segment.through.length
  return (
    <div className="season-scroll">
      <table className="season-table quali-table">
        <thead>
          <tr>
            <th scope="col" className="num">
              Pos
            </th>
            <th scope="col">Driver</th>
            <th scope="col" className="num">
              Run 1
            </th>
            <th scope="col" className="num">
              Run 2
            </th>
            <th scope="col" className="num">
              Gap
            </th>
          </tr>
        </thead>
        <tbody>
          {segment.times.map((t, i) => {
            const d = DRIVERS[t.driver]
            const classes = [
              t.driver === driver ? 'is-me' : '',
              cut > 0 && i === cut ? 'is-cut' : '',
              cut > 0 && i >= cut ? 'is-out' : '',
            ]
            return (
              <tr key={t.driver} className={classes.join(' ').trim() || undefined}>
                <td className="num">{i + 1}</td>
                <th scope="row">
                  <span className="team-bar" style={{ background: TEAMS[d.team].color }} aria-hidden="true" />
                  {d.name}
                </th>
                {[0, 1].map((r) => (
                  <td key={r} className={t.runs[r] === t.best && Number.isFinite(t.best) ? 'num is-best' : 'num'}>
                    {Number.isFinite(t.runs[r]) ? formatLapTime(t.runs[r]) : '–'}
                    {NOTE_TEXT[t.notes[r]] && <small> {NOTE_TEXT[t.notes[r]]}</small>}
                  </td>
                ))}
                <td className="num">{Number.isFinite(t.best) ? (i === 0 ? '' : gap(t.best - pole)) : 'no time'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function QualifyingCard({ season }: { season: Season }) {
  const qualify = useSeasonStore((s) => s.qualify)
  const finish = useSeasonStore((s) => s.finishQualifying)
  const [risks, setRisks] = useState<[Risk, Risk]>(['safe', 'push'])
  const baseLap = roundProfile(currentRound(season)).baseLapTime

  if (season.stage === 'practice') {
    return (
      <section className="season-card stage-card is-waiting">
        <h2>
          <span className="stage-chip">2</span> Qualifying
        </h2>
        <p className="season-note">Three knockout parts decide the grid. It opens after practice.</p>
      </section>
    )
  }

  const quali = season.qualifying ?? startQualifying(season)
  const part = quali.segments.length
  const running = playerRunning(season, quali)
  const last = quali.segments[part - 1]
  const mine = gridPosition(quali, season.driver)

  if (quali.grid) {
    return (
      <section className="season-card stage-card is-done">
        <h2>
          <span className="stage-chip">✓</span> Qualifying
        </h2>
        <p className="season-note">
          {DRIVERS[season.driver].name} starts <strong>{ordinal(mine)}</strong>. Pole: {DRIVERS[quali.grid[0]].name}.
          {quali.wet ? ' The session was wet.' : ''}
        </p>
        <details className="season-details">
          <summary>The whole grid, and each part’s times</summary>
          <ol className="grid-list">
            {quali.grid.map((d) => (
              <li key={d} className={d === season.driver ? 'is-me' : undefined}>
                <span className="team-bar" style={{ background: TEAMS[DRIVERS[d].team].color }} aria-hidden="true" />
                {DRIVERS[d].name}
              </li>
            ))}
          </ol>
          {quali.segments.map((segment) => (
            <div key={segment.number}>
              <h3>Q{segment.number}</h3>
              <SegmentTable segment={segment} driver={season.driver} />
            </div>
          ))}
        </details>
      </section>
    )
  }

  const cars = quali.remaining.length
  const through = THROUGH[part] ?? 0
  return (
    <section className="season-card stage-card is-open">
      <h2>
        <span className="stage-chip">2</span> Qualifying
        <span className={quali.wet ? 'pill pill-wet' : 'pill'}>{quali.wet ? 'Wet session' : 'Dry session'}</span>
      </h2>

      {last && (
        <>
          <h3>Q{last.number} times</h3>
          <SegmentTable segment={last} driver={season.driver} />
        </>
      )}

      {running ? (
        <>
          <h3>
            Q{part + 1} of {QUALI_PARTS}: {cars} cars
            {through > 0 ? `, the quickest ${through} go through` : ', for pole'}
          </h3>
          <p className="season-note">
            Every car gets two runs and its better lap counts. A ruined lap is a second or more slow; on the limit, one
            ruined lap in four ends in the barriers and ends your qualifying.
            {quali.wet ? ' On a wet track every lap is riskier.' : ''}
          </p>
          <div className="risk-rows">
            {[0, 1].map((r) => (
              <div key={r} className="risk-row">
                <span className="risk-run">Run {r + 1}</span>
                <div className="choice-row" role="radiogroup" aria-label={`Run ${r + 1}: how hard to push`}>
                  {RISK_ORDER.map((risk) => (
                    <button
                      key={risk}
                      type="button"
                      role="radio"
                      aria-checked={risks[r] === risk}
                      className={risks[r] === risk ? 'choice is-chosen' : 'choice'}
                      onClick={() => setRisks(r === 0 ? [risk, risks[1]] : [risks[0], risk])}
                    >
                      <strong>{RISKS[risk].label}</strong>
                      <span>{riskDetail(risk, quali.wet, baseLap)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="stage-actions">
            <button type="button" className="cta" data-coach="season-qualify" onClick={() => qualify(risks)}>
              Run Q{part + 1}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="season-note">
            {quali.crashed.includes(season.driver)
              ? `${DRIVERS[season.driver].name} is in the barriers: no more laps today.`
              : `${DRIVERS[season.driver].name} is out, and starts ${ordinal(mine)}.`}{' '}
            The rest of the session runs without you.
          </p>
          <div className="stage-actions">
            <button type="button" className="cta" data-coach="season-qualify" onClick={finish}>
              Run the rest of qualifying
            </button>
          </div>
        </>
      )}
    </section>
  )
}

// ---------- The race ----------

export function RaceCard({ season, navigate }: { season: Season; navigate: (route: Route) => void }) {
  const goToGrid = useSeasonStore((s) => s.goToGrid)
  const simulate = useSeasonStore((s) => s.simulate)
  const busy = useSeasonStore((s) => s.busy)
  const error = useSeasonStore((s) => s.error)
  const event = usePitWallStore((s) => s.event)
  const phase = usePitWallStore((s) => s.phase)
  const [planIndex, setPlanIndex] = useState(0)
  const [matePlanIndex, setMatePlanIndex] = useState(0)

  const params = useMemo(() => playerParams(season), [season])
  const plans = useMemo(() => rankStrategies(params).slice(0, 6), [params])

  if (season.stage !== 'race') {
    return (
      <section className="season-card stage-card is-waiting">
        <h2>
          <span className="stage-chip">3</span> Race
        </h2>
        <p className="season-note">
          You call it from the pit wall, or leave it to the engineer. It opens after qualifying.
        </p>
      </section>
    )
  }

  const quali = season.qualifying
  const position = quali ? gridPosition(quali, season.driver) : 0
  const chosen = plans[Math.min(planIndex, plans.length - 1)]
  const mate = teamMate(season)
  const mateChosen = plans[Math.min(matePlanIndex, plans.length - 1)]
  const matePosition = quali ? gridPosition(quali, mate) : 0
  const planOptions = plans.map((p, i) => (
    <option key={p.label + i} value={i}>
      {describePlan(p.strategy)}
      {i === 0 ? ' (quickest on a clear track)' : ` (+${(p.time - plans[0].time).toFixed(1)} s)`}
    </option>
  ))
  const onPitWall = event !== null && event.season === season.seed && event.round === season.round && phase === 'race'

  return (
    <section className="season-card stage-card is-open">
      <h2>
        <span className="stage-chip">3</span> Race
      </h2>
      {onPitWall ? (
        <>
          <p className="season-note">This race is under way on the pit wall.</p>
          <div className="stage-actions">
            <button type="button" className="cta" data-coach="season-grid" onClick={() => navigate('pitwall')}>
              Back to the pit wall <span aria-hidden="true">→</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="season-note">
            {DRIVERS[season.driver].name} starts <strong>{position > 0 ? ordinal(position) : 'on the grid'}</strong> of
            twenty
            {season.bothCars && matePosition > 0 ? `, ${DRIVERS[mate].name} ${ordinal(matePosition)}` : ''}, over{' '}
            {currentRound(season).laps} laps. The plans below are worked out for this weekend’s temperature and your
            car’s tyre wear.
          </p>
          <label className="plan-field">
            <span>{season.bothCars ? `Starting plan for ${DRIVERS[season.driver].name}` : 'Starting plan'}</span>
            <select
              value={Math.min(planIndex, plans.length - 1)}
              onChange={(e) => setPlanIndex(Number(e.target.value))}
            >
              {planOptions}
            </select>
          </label>
          {season.bothCars && (
            <label className="plan-field">
              <span>Starting plan for {DRIVERS[mate].name}</span>
              <select
                value={Math.min(matePlanIndex, plans.length - 1)}
                onChange={(e) => setMatePlanIndex(Number(e.target.value))}
              >
                {planOptions}
              </select>
            </label>
          )}
          {error && <p className="season-error">{error}</p>}
          <div className="stage-actions">
            <button
              type="button"
              className="cta"
              data-coach="season-grid"
              disabled={busy || !chosen}
              onClick={() => {
                if (!chosen) return
                void goToGrid(chosen.strategy, mateChosen?.strategy).then((started) => {
                  if (started) navigate('pitwall')
                })
              }}
            >
              Go to the grid <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className="cta cta-ghost"
              disabled={busy || !chosen}
              onClick={() => chosen && simulate(chosen.strategy, mateChosen?.strategy)}
            >
              Let the engineer run it
            </button>
          </div>
          <p className="season-note stage-foot">
            On the pit wall every stop is your call{season.bothCars ? ', for both cars' : ''}, and the debrief rates
            each one afterwards. The engineer follows the plan and reacts to rain, safety cars and worn tyres, but will
            not out-think the field.
          </p>
        </>
      )}
    </section>
  )
}
