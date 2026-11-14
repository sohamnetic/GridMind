import { useMemo, useState } from 'react'
import { formatLapTime } from '../../core/physics/lapTimer'
import type { CarRace, RaceLog, RaceState } from '../../core/race/engine'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import { COMPOUNDS } from '../../core/race/tyres'
import { analyseTrack, isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { buildPitLane } from '../../core/track/pit'
import { defaultLaps, LAP_OPTIONS, useFullRaceStore } from '../../state/fullRaceStore'
import { useStudioStore } from '../../state/studioStore'
import { GapChart, PositionChart, safetyPeriods, StintChart } from './RaceCharts'
import { useTrackProfile } from './useTrackProfile'
import { ProfileCard } from './WheelRace'

/** The lap-level race: a whole grand prix with tyres, fuel, stops, safety cars and weather. */
export function FullRace() {
  const def = useStudioStore((s) => s.def)
  const lapsChoice = useFullRaceStore((s) => s.laps)
  const rainChance = useFullRaceStore((s) => s.rainChance)
  const seed = useFullRaceStore((s) => s.seed)
  const result = useFullRaceStore((s) => s.result)
  const viewLap = useFullRaceStore((s) => s.viewLap)
  const selected = useFullRaceStore((s) => s.selected)
  const actions = useFullRaceStore.getState()
  const [showPasses, setShowPasses] = useState(false)

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

  const race = result?.race ?? null
  const lap = race ? Math.min(viewLap, race.totalLaps) : 0

  return (
    <div className="fullrace">
      <div className="fullrace-main">
        {!race || !result ? (
          <div className="fullrace-empty">
            <h1>Full race</h1>
            <p>
              Runs a complete race for twenty cars, lap by lap: tyre wear and the cliff, fuel burning off, pit stops,
              safety cars and changing weather. Every team follows a strategy and reacts to what happens. The circuit’s
              lap time, tyre stress, pit-lane loss and overtaking difficulty come from its track profile.
            </p>
            <p className="muted">Choose a distance and a chance of rain, then run the race.</p>
          </div>
        ) : (
          <>
            <header className="fullrace-head">
              <h1>{result.trackName}</h1>
              <p>{summary(race)}</p>
            </header>
            <h3>Lap chart</h3>
            <PositionChart race={race} viewLap={lap} selected={selected} onSelect={actions.select} />
            <h3>Gap to the leader</h3>
            <GapChart
              race={race}
              viewLap={lap}
              selected={selected}
              onSelect={actions.select}
              baseLap={result.baseLap}
            />
            <h3>Tyre stints, in finishing order</h3>
            <StintChart race={race} viewLap={lap} selected={selected} onSelect={actions.select} />
            <ul className="chart-key">
              {(['soft', 'medium', 'hard', 'inter', 'wet'] as const).map((c) => (
                <li key={c}>
                  <span className="key-swatch" style={{ background: COMPOUNDS[c].color }} /> {COMPOUNDS[c].label}
                </li>
              ))}
              <li>
                <span className="key-swatch key-sc" /> Safety car
              </li>
              <li>
                <span className="key-swatch key-vsc" /> Virtual safety car
              </li>
              <li>
                <span className="key-swatch key-rain" /> Rain
              </li>
            </ul>
          </>
        )}
      </div>

      <aside className="studio-side evolution-side" aria-label="Race setup, timing and log">
        <section className="panel">
          <h2>Race setup</h2>
          {!scene.drivable && (
            <p className="issue issue-error">
              This circuit has problems. <a href="#/studio">Fix it in the Track Studio</a> before racing on it.
            </p>
          )}
          <fieldset className="fields race-setup">
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
              <span>Seed</span>
              <input
                type="number"
                min={1}
                max={999999}
                value={seed}
                onChange={(e) => actions.setOptions({ seed: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
              />
            </label>
            <label className="field">
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
          </fieldset>
          <button
            type="button"
            className="primary"
            disabled={!profile || !scene.drivable}
            data-coach="run-race"
            onClick={() => profile && actions.run(profile, laps, { id: def.id, name: def.name })}
          >
            Run race
          </button>
          <div className="button-row">
            <button
              type="button"
              disabled={!profile || !scene.drivable}
              title="Run again with the next seed: same circuit and settings, different luck"
              onClick={() => {
                if (!profile) return
                actions.setOptions({ seed: seed + 1 })
                actions.run(profile, laps, { id: def.id, name: def.name })
              }}
            >
              Next seed
            </button>
            <button type="button" disabled={selected === null} onClick={() => actions.select(null)}>
              Clear highlight
            </button>
          </div>
        </section>

        {race && result && (
          <>
            <section className="panel">
              <h2>{lap === 0 ? 'Grid' : lap >= race.totalLaps ? 'Result' : `After lap ${lap} of ${race.totalLaps}`}</h2>
              <label className="field">
                <span>
                  Lap
                  <output>
                    {lap} / {race.totalLaps}
                  </output>
                </span>
                <input
                  type="range"
                  min={0}
                  max={race.totalLaps}
                  step={1}
                  value={lap}
                  onChange={(e) => actions.setViewLap(Number(e.target.value))}
                />
              </label>
              <p className="conditions">{conditions(race, lap)}</p>
              <Timing race={race} lap={lap} selected={selected} onSelect={actions.select} />
            </section>

            <section className="panel">
              <h2>Race log</h2>
              <label className="check">
                <input type="checkbox" checked={showPasses} onChange={(e) => setShowPasses(e.target.checked)} />
                <span>Include overtakes</span>
              </label>
              <RaceLogList race={race} lap={lap} showPasses={showPasses} />
            </section>

            <section className="panel">
              <h2>Strategies before the race</h2>
              <p className="muted">Fastest dry strategies with a clear track and no incidents.</p>
              <table className="timing strategy-table">
                <thead>
                  <tr>
                    <th scope="col">Tyres</th>
                    <th scope="col">Stops on lap</th>
                    <th scope="col" className="num">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.slice(0, 6).map((r, i) => (
                    <tr key={r.label + i}>
                      <th scope="row">{r.label}</th>
                      <td>{r.strategy.stops.map((s) => s.lap).join(', ')}</td>
                      <td className="num">{i === 0 ? 'Best' : `+${(r.time - result.ranked[0].time).toFixed(1)} s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {profile && <ProfileCard profile={profile} />}
      </aside>
    </div>
  )
}

/** One-paragraph account of how the race went. */
function summary(race: RaceState): string {
  const count = (type: RaceLog['type']) => race.log.filter((e) => e.type === type).length
  const winner = race.cars[race.order[0]]
  const driver = DRIVERS[winner.driver]
  const tyres = winner.stints.map((s) => COMPOUNDS[s.compound].short).join('-')
  const parts = [
    `${driver.name} (${TEAMS[driver.team].name}) wins from P${winner.grid} on ${tyres}`,
    `${count('overtake')} overtakes`,
    `${count('pit')} pit stops`,
  ]
  const safety = count('sc') + count('vsc')
  if (safety > 0) parts.push(`${safety} safety car period${safety > 1 ? 's' : ''}`)
  const out = count('out')
  if (out > 0) parts.push(`${out} retirement${out > 1 ? 's' : ''}`)
  const wetLaps = race.weather.plan.filter((r) => r > 0).length
  parts.push(wetLaps > 0 ? `rain on ${wetLaps} of ${race.totalLaps} laps` : 'dry throughout')
  return `${parts.join(' · ')}.`
}

/** Weather and flag state on the lap being viewed. */
function conditions(race: RaceState, lap: number): string {
  if (lap === 0) return 'Before the start.'
  const rain = race.weather.plan[lap - 1] ?? 0
  const sky = rain === 0 ? 'No rain' : rain < 0.4 ? 'Light rain' : rain < 0.7 ? 'Rain' : 'Heavy rain'
  const period = safetyPeriods(race).find((p) => lap >= p.from && lap <= p.to)
  const flag = !period ? 'green flag' : period.type === 'sc' ? 'safety car' : 'virtual safety car'
  return `${sky}, ${flag}.`
}

/** The tyre a car ran on lap `lap`, and how many laps old it was. */
function tyreAt(car: CarRace, lap: number): { short: string; color: string; age: number } | null {
  const at = Math.max(1, lap)
  const stint = car.stints.find((s) => at >= s.from && at <= s.to) ?? car.stints[car.stints.length - 1]
  if (!stint) return null
  const spec = COMPOUNDS[stint.compound]
  return { short: spec.short, color: spec.color, age: lap === 0 ? 0 : Math.max(0, at - stint.from + 1) }
}

interface TimingProps {
  race: RaceState
  lap: number
  selected: number | null
  onSelect: (driver: number | null) => void
}

function Timing({ race, lap, selected, onSelect }: TimingProps) {
  const rows = useMemo(() => {
    const list = race.cars.map((car) => {
      const out = !car.running && car.outLap <= lap
      return {
        car,
        out,
        position: out ? 99 + (race.totalLaps - car.outLap) : (car.positions[lap] ?? 99),
        gap: car.gaps[lap] ?? 0,
        stops: car.stints.filter((s) => s.from > 1 && s.from <= lap + 1).length,
      }
    })
    return list.sort((a, b) => a.position - b.position)
  }, [race, lap])

  return (
    <div className="table-scroll timing-scroll">
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
          {rows.map(({ car, out, position, gap, stops }) => {
            const driver = DRIVERS[car.driver]
            const tyre = tyreAt(car, lap)
            return (
              <tr
                key={car.driver}
                className={
                  [out ? 'is-out' : '', car.driver === selected ? 'is-selected' : ''].join(' ').trim() || undefined
                }
                onClick={() => onSelect(car.driver === selected ? null : car.driver)}
              >
                <td className="num">{out ? '–' : position}</td>
                <th scope="row" title={`${driver.name}, ${TEAMS[driver.team].name}`}>
                  <span className="team-bar" style={{ background: TEAMS[driver.team].color }} aria-hidden="true" />
                  {driver.code}
                </th>
                <td className="num">
                  {out
                    ? `Out, lap ${car.outLap}`
                    : position === 1
                      ? lap === 0
                        ? 'Pole'
                        : 'Leader'
                      : lap === 0
                        ? ''
                        : `+${gap.toFixed(1)}`}
                </td>
                <td>
                  {tyre && !out && (
                    <span className="tyre">
                      <span className="tyre-dot" style={{ background: tyre.color }} aria-hidden="true" />
                      {tyre.short}
                      {lap > 0 && <span className="tyre-age">{tyre.age}</span>}
                    </span>
                  )}
                </td>
                <td className="num">{out ? '' : stops}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RaceLogList({ race, lap, showPasses }: { race: RaceState; lap: number; showPasses: boolean }) {
  const entries = useMemo(
    () =>
      race.log
        .filter((e) => e.lap <= lap && (showPasses || e.type !== 'overtake'))
        .slice(-16)
        .reverse(),
    [race, lap, showPasses],
  )
  if (entries.length === 0) return <p className="muted">Nothing has happened yet.</p>
  return (
    <ol className="race-log">
      {entries.map((entry, i) => (
        <li key={`${entry.lap}-${entry.type}-${entry.car ?? ''}-${i}`}>
          <span className="num">L{entry.lap}</span>
          <span>{describe(entry)}</span>
        </li>
      ))}
    </ol>
  )
}

function describe(entry: RaceLog): string {
  const who = entry.car !== undefined ? DRIVERS[entry.car].code : ''
  switch (entry.type) {
    case 'pit':
      return `${who} pits for ${COMPOUNDS[entry.compound ?? 'medium'].label.toLowerCase()} tyres (${(entry.value ?? 0).toFixed(1)} s)`
    case 'overtake':
      return `${who} passes ${entry.other !== undefined ? DRIVERS[entry.other].code : ''}`
    case 'sc':
      return 'Safety car deployed'
    case 'vsc':
      return 'Virtual safety car'
    case 'green':
      return 'Green flag: racing resumes'
    case 'rain':
      return 'Rain begins'
    case 'dry':
      return 'Rain stops'
    case 'out':
      return `${who} retires`
    case 'fastest':
      return `Fastest lap: ${who}, ${formatLapTime(entry.value)}`
    case 'slowstop':
      return `${who} has a slow stop (${(entry.value ?? 0).toFixed(1)} s stationary)`
    case 'stack':
      return `${who} waits ${(entry.value ?? 0).toFixed(1)} s behind a team-mate in the pits`
    case 'penalty':
      return `${who}: ${entry.value} s penalty for using only one dry compound`
    case 'flag':
      return `${who} takes the chequered flag`
  }
}
