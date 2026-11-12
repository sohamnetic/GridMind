import { useMemo } from 'react'
import { createRng, deriveSeed, nextFloat } from '../../core/math/rng'
import { formatLapTime } from '../../core/physics/lapTimer'
import type { RadioMessage } from '../../core/pitwall/radio'
import type { Plan } from '../../core/pitwall/replan'
import { lapsToCliff, pitCost, rejoinPosition } from '../../core/pitwall/session'
import type { RaceSetup, RaceState } from '../../core/race/engine'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import type { RaceParams } from '../../core/race/strategy'
import {
  ALL_COMPOUNDS,
  bestForConditions,
  CLIFF_WEAR,
  COMPOUNDS,
  type Compound,
  type DriveMode,
} from '../../core/race/tyres'
import { forecast } from '../../core/race/weather'
import { usePitWallStore, type Advice, type PendingOrder } from '../../state/pitwallStore'

const KIND_WORDS = { dry: 'Slicks', inter: 'Intermediates', wet: 'Full wets' } as const
const MODES: { id: DriveMode; label: string; title: string }[] = [
  { id: 'push', label: 'Push', title: 'Quicker laps, tyres wear about a third faster' },
  { id: 'normal', label: 'Normal', title: 'The pace the tyres were made for' },
  { id: 'conserve', label: 'Conserve', title: 'Slower laps, tyres last about a third longer' },
]

export function rainWord(rain: number): string {
  return rain === 0 ? 'No rain' : rain < 0.4 ? 'Light rain' : rain < 0.7 ? 'Rain' : 'Heavy rain'
}

export function Tyre({ compound, age }: { compound: Compound; age?: number }) {
  const spec = COMPOUNDS[compound]
  return (
    <span className="tyre">
      <span className="tyre-dot" style={{ background: spec.color }} aria-hidden="true" />
      {spec.short}
      {age !== undefined && <span className="tyre-age">{age}</span>}
    </span>
  )
}

// ---------- Your car ----------

interface CarPanelProps {
  race: RaceState
  driver: number
  params: RaceParams
  pending: PendingOrder
  advice: Advice | null
}

export function CarPanel({ race, driver, params, pending, advice }: CarPanelProps) {
  const actions = usePitWallStore.getState()
  const me = race.cars[driver]
  const place = race.order.indexOf(driver)
  const ahead = place > 0 ? race.cars[race.order[place - 1]] : null
  const behind = place + 1 < race.order.length ? race.cars[race.order[place + 1]] : null
  const cost = pitCost(race, params)
  const rejoin = rejoinPosition(race, driver, cost)
  const left = lapsToCliff(race, driver, params)
  const wear = Math.min(1.2, me.wear)
  const canCall = me.running && race.totalLaps - race.lap >= 2
  const lapNo = Math.min(race.totalLaps, race.lap + 1)

  if (!me.running) {
    return (
      <section className="panel">
        <h2>Your car</h2>
        <p className="issue issue-error">Retired on lap {me.outLap}.</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>
        Your car · {DRIVERS[driver].code} · P{me.position}
      </h2>
      <dl className="stats pw-stats">
        <div>
          <dt>Car ahead</dt>
          <dd>{ahead ? `${DRIVERS[ahead.driver].code} +${(me.time - ahead.time).toFixed(1)}` : 'Leading'}</dd>
        </div>
        <div>
          <dt>Car behind</dt>
          <dd>{behind && behind.running ? `${DRIVERS[behind.driver].code} +${(behind.time - me.time).toFixed(1)}` : '–'}</dd>
        </div>
        <div>
          <dt>Tyres</dt>
          <dd>
            <Tyre compound={me.compound} /> {me.tyreAge} laps
          </dd>
        </div>
        <div>
          <dt>Last lap</dt>
          <dd>{me.lastLap > 0 ? formatLapTime(me.lastLap) : '–'}</dd>
        </div>
      </dl>

      <div className="pw-wear" title="Share of the tyre's life used. Past the marker, lap times fall away sharply.">
        <div className="pw-wear-head">
          <span>Tyre wear</span>
          <span>
            {Math.round(me.wear * 100)} % ·{' '}
            {left > 0 ? `about ${left} lap${left === 1 ? '' : 's'} to the cliff` : 'past the cliff'}
          </span>
        </div>
        <div
          className="pw-wear-track"
          role="meter"
          aria-label="Tyre wear"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(me.wear * 100)}
        >
          <div
            className={me.wear >= CLIFF_WEAR ? 'pw-wear-fill is-over' : 'pw-wear-fill'}
            style={{ width: `${(wear / 1.2) * 100}%` }}
          />
          <div className="pw-wear-cliff" style={{ left: `${(CLIFF_WEAR / 1.2) * 100}%` }} />
        </div>
      </div>

      <h3 className="pw-sub">Driving</h3>
      <div className="segmented" role="group" aria-label="How hard to drive">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.title}
            className={pending.mode === m.id ? 'is-active' : undefined}
            aria-pressed={pending.mode === m.id}
            onClick={() => actions.setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <h3 className="pw-sub">Pit call for lap {lapNo}</h3>
      <div className="pw-box" role="group" aria-label="Tyres to stop for at the end of this lap" data-coach="pit-call">
        {ALL_COMPOUNDS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={!canCall}
            title={`Box at the end of this lap for ${COMPOUNDS[c].label.toLowerCase()} tyres`}
            className={pending.pit === c ? 'is-active' : undefined}
            aria-pressed={pending.pit === c}
            onClick={() => actions.setPit(pending.pit === c ? null : c)}
          >
            <span className="tyre-dot" style={{ background: COMPOUNDS[c].color }} aria-hidden="true" />
            {COMPOUNDS[c].short}
          </button>
        ))}
      </div>
      <p className={pending.pit ? 'pw-call is-box' : 'pw-call'}>
        {pending.pit
          ? `Box, box: ${COMPOUNDS[pending.pit].label.toLowerCase()} tyres at the end of this lap. About ${cost.toFixed(0)} s, rejoining near P${rejoin}.`
          : canCall
            ? `Staying out. A stop now would cost about ${cost.toFixed(0)} s and rejoin near P${rejoin}.`
            : 'Too late to stop: run to the flag.'}
      </p>

      <div className="button-row">
        <button
          type="button"
          disabled={!canCall || (advice !== null && advice.lap === race.lap + 1)}
          title="The strategy engine plays the rest of the race out many times for each option"
          onClick={actions.askEngineer}
        >
          {advice?.status === 'thinking' ? 'Engineer is working…' : 'Ask the engineer'}
        </button>
      </div>
      {advice?.status === 'ready' && advice.lap === race.lap + 1 && (
        <table className="timing strategy-table pw-advice">
          <thead>
            <tr>
              <th scope="col">Call</th>
              <th scope="col" className="num">
                Avg. finish
              </th>
              <th scope="col" className="num" title="Places gained or lost against staying out, with race time counted in">
                vs staying out
              </th>
            </tr>
          </thead>
          <tbody>
            {advice.values.map((v) => (
              <tr key={v.id} className={v.id === advice.best ? 'is-selected' : undefined}>
                <th scope="row">{v.pit ? `Box: ${COMPOUNDS[v.pit].label}` : 'Stay out'}</th>
                <td className="num">P{v.meanPosition.toFixed(1)}</td>
                <td className="num">
                  {v.pit === null ? '–' : `${v.score <= 0 ? '+' : '−'}${Math.abs(v.score).toFixed(1)} places`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ---------- Timing tower ----------

export function Tower({ race, driver }: { race: RaceState; driver: number }) {
  const leader = race.cars[race.order[0]]
  return (
    <div className="table-scroll timing-scroll pw-tower">
      <table className="timing">
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Driver</th>
            <th scope="col" className="num">
              Gap
            </th>
            <th scope="col">Tyre</th>
            <th scope="col" className="num">
              Stops
            </th>
          </tr>
        </thead>
        <tbody>
          {race.order.map((i, p) => {
            const car = race.cars[i]
            const who = DRIVERS[i]
            return (
              <tr
                key={i}
                className={[car.running ? '' : 'is-out', i === driver ? 'is-selected' : ''].join(' ').trim() || undefined}
              >
                <td className="num">{car.running ? p + 1 : '–'}</td>
                <th scope="row" title={`${who.name}, ${TEAMS[who.team].name}`}>
                  <span className="team-bar" style={{ background: TEAMS[who.team].color }} aria-hidden="true" />
                  {who.code}
                </th>
                <td className="num">
                  {!car.running
                    ? `Out, lap ${car.outLap}`
                    : race.lap === 0
                      ? p === 0
                        ? 'Pole'
                        : ''
                      : p === 0
                        ? 'Leader'
                        : `+${(car.time - leader.time).toFixed(1)}`}
                </td>
                <td>{car.running && <Tyre compound={car.compound} age={car.tyreAge} />}</td>
                <td className="num">{car.running ? car.stops : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Weather radar ----------

const HORIZON = 10

export function WeatherPanel({ race, setup }: { race: RaceState; setup: RaceSetup }) {
  const { rain, wetness } = race.weather
  // A forecast is made once a lap and does not flicker between redraws.
  const ahead = useMemo(() => {
    const rng = createRng(deriveSeed(setup.seed ^ 0xf0ca57, race.lap))
    return forecast(race.weather, race.lap, HORIZON, () => nextFloat(rng))
  }, [race, setup.seed])
  const wanted = bestForConditions(wetness)
  const W = 300
  const H = 74
  const slot = W / HORIZON
  const wet = ahead.some((r) => r > 0.08)

  return (
    <section className="pw-card" aria-label="Weather">
      <h3 title="Rain expected on each of the next laps. The forecast is good for a few laps and a guess after that.">
        Weather radar: next {ahead.length} laps
      </h3>
      <p className="pw-weather-now">
        <b>{rainWord(rain)}</b> · track {wetness < 0.05 ? 'dry' : `${Math.round(wetness * 100)} % wet`} ·{' '}
        {KIND_WORDS[wanted].toLowerCase()} are quickest
      </p>
      <svg className="pw-radar" viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="Rain forecast for the next ten laps">
        <line x1={0} x2={W} y1={H} y2={H} className="chart-grid" />
        {ahead.map((r, k) => {
          // The further ahead, the wider the doubt: drawn as a paler cap above the bar.
          const doubt = 0.04 + 0.03 * k
          const h = r * H
          const top = Math.min(1, r + doubt) * H
          const lap = race.lap + 1 + k
          return (
            <g key={lap}>
              <title>{`Lap ${lap}: ${r < 0.05 ? 'dry' : rainWord(r).toLowerCase()} expected${k > 2 ? ', give or take' : ''}`}</title>
              <rect x={k * slot} y={0} width={slot} height={H + 16} fill="transparent" />
              {r > 0.02 && (
                <rect x={k * slot + 3} y={H - top} width={slot - 6} height={top - h} rx={2} className="pw-radar-doubt" />
              )}
              {h > 0.5 && <rect x={k * slot + 3} y={H - h} width={slot - 6} height={h} rx={2} className="pw-radar-bar" />}
              <text x={k * slot + slot / 2} y={H + 12} textAnchor="middle" className="chart-tick">
                {lap}
              </text>
            </g>
          )
        })}
        {!wet && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="pw-radar-clear">
            Nothing on the radar for {ahead.length} laps
          </text>
        )}
      </svg>
    </section>
  )
}

// ---------- Pit window ----------

export function PitWindow({ race, driver, plan }: { race: RaceState; driver: number; plan: Plan | null }) {
  const me = race.cars[driver]
  const total = race.totalLaps
  const W = 300
  const x = (lap: number) => (lap / total) * W
  const next = plan?.stops[0]
  let text = 'No stop needed: these tyres will see the flag.'
  if (!me.running) text = 'Car retired.'
  else if (!COMPOUNDS[me.compound].dry) text = 'On rain tyres: the weather decides the next stop.'
  else if (bestForConditions(race.weather.wetness) !== 'dry') text = 'The track wants rain tyres: the weather decides the next stop.'
  else if (plan?.window && next) {
    const { from, to } = plan.window
    const lapNo = race.lap + 1
    const state = lapNo < from ? `opens on lap ${from}` : lapNo <= to ? 'open now' : 'closed'
    text =
      `Next stop: ${COMPOUNDS[next.compound].label.toLowerCase()} tyres, ${from === to ? `lap ${from}` : `laps ${from} to ${to}`} (${state}).` +
      (plan.stops[1] ? ` Then ${COMPOUNDS[plan.stops[1].compound].label.toLowerCase()} on lap ${plan.stops[1].lap}.` : '')
  }
  return (
    <section className="pw-card" aria-label="Pit window">
      <h3>Pit window</h3>
      <svg className="pw-window" viewBox={`0 0 ${W} 30`} role="img" aria-label={text}>
        <rect x={0} y={8} width={W} height={10} rx={3} className="pw-window-track" />
        <rect x={0} y={8} width={x(race.lap)} height={10} rx={3} className="pw-window-done" />
        {plan?.window && me.running && (
          <rect
            x={x(plan.window.from - 1)}
            y={5}
            width={Math.max(3, x(plan.window.to) - x(plan.window.from - 1))}
            height={16}
            rx={3}
            className="pw-window-open"
          />
        )}
        {me.running &&
          plan?.stops.map((s) => (
            <circle key={s.lap} cx={x(s.lap)} cy={13} r={4.5} fill={COMPOUNDS[s.compound].color} className="pw-window-stop" />
          ))}
        <line x1={x(race.lap)} x2={x(race.lap)} y1={2} y2={24} className="pw-window-now" />
        <text x={0} y={29} className="chart-tick">
          1
        </text>
        <text x={W} y={29} textAnchor="end" className="chart-tick">
          {total}
        </text>
      </svg>
      <p className="pw-note">{text}</p>
    </section>
  )
}

// ---------- Team radio ----------

const VOICES = { engineer: 'Engineer', driver: 'Driver', control: 'Race control' } as const

export function Radio({ messages, limit = 40 }: { messages: readonly RadioMessage[]; limit?: number }) {
  const recent = messages.slice(-limit).reverse()
  return (
    <section className="pw-card pw-radio" aria-label="Team radio">
      <h3>Team radio</h3>
      {recent.length === 0 ? (
        <p className="muted">Radio is quiet.</p>
      ) : (
        <ol className="pw-radio-list" aria-live="polite">
          {recent.map((m, i) => (
            <li key={`${m.lap}-${i}-${m.text}`} className={`is-${m.voice} is-${m.tone}`}>
              <span className="num">L{m.lap}</span>
              <span className="pw-voice">{VOICES[m.voice]}</span>
              <span>{m.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
