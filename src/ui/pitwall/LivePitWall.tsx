import { useEffect, useMemo, useState } from 'react'
import { DRIVER_LAYOUT } from '../../core/evolution/trainer'
import type { Plan } from '../../core/pitwall/replan'
import type { RaceState } from '../../core/race/engine'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import {
  bestDryCompound,
  raceParams,
  rankStrategies,
  strategyLabel,
  type RaceParams,
  type Strategy,
} from '../../core/race/strategy'
import { bestForConditions, COMPOUNDS, type Compound } from '../../core/race/tyres'
import { analyseTrack, isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import type { BuiltTrack } from '../../core/track/types'
import { buildTrackPaths } from '../../render/trackRenderer'
import { loadDriver, trackKey } from '../../state/driverLibrary'
import { defaultLaps, LAP_OPTIONS } from '../../state/fullRaceStore'
import { useOptimiserStore } from '../../state/optimiserStore'
import { PITWALL_SPEEDS, pitwallFrame, tickPitWall, usePitWallStore } from '../../state/pitwallStore'
import { useStudioStore } from '../../state/studioStore'
import { PopulationCanvas } from '../components/PopulationCanvas'
import { useTrackProfile } from '../race/useTrackProfile'
import { ProfileCard } from '../race/WheelRace'
import { Debrief } from './Debrief'
import { CarPanel, PitWindow, Radio, rainWord, Tower, WeatherPanel } from './PitWallPanels'
import '../evolution/evolution.css'
import '../race/race.css'
import '../optimiser/optimiser.css'
import './pitwall.css'

const CAR_STYLE = {
  colors: DRIVERS.map((d) => TEAMS[d.team].color),
  labels: DRIVERS.map((d) => d.code),
}

/** The lap the cars are drawn along: the trained drivers' racing line if there is one, else the centreline. */
function lapPath(track: BuiltTrack, ghost: Float32Array | null): Float32Array {
  if (ghost && ghost.length >= 90) {
    const out = new Float32Array((ghost.length / 3) * 2)
    for (let i = 0, o = 0; i + 2 < ghost.length; i += 3, o += 2) {
      out[o] = ghost[i]
      out[o + 1] = ghost[i + 1]
    }
    return out
  }
  const out = new Float32Array(track.n * 2)
  for (let k = 0; k < track.n; k++) {
    const i = (track.startIndex + k) % track.n
    out[k * 2] = track.x[i]
    out[k * 2 + 1] = track.y[i]
  }
  return out
}

function describePlan(strategy: Strategy): string {
  const stops = strategy.stops.map((s) => s.lap)
  return `${strategyLabel(strategy)}: stop${stops.length > 1 ? 's' : ''} on lap${stops.length > 1 ? 's' : ''} ${stops.join(', ')}`
}

/** The tyres a stop would most likely be for right now. */
function suggestedTyre(race: RaceState, driver: number, plan: Plan | null, params: RaceParams): Compound | null {
  const me = race.cars[driver]
  const kind = COMPOUNDS[me.compound].dry ? 'dry' : me.compound === 'inter' ? 'inter' : 'wet'
  const wanted = bestForConditions(race.weather.wetness)
  // Slicks with rain falling: the track is only going one way.
  if (kind === 'dry' && race.weather.rain > 0 && race.weather.wetness > 0.2) {
    return race.weather.rain > 0.75 ? 'wet' : 'inter'
  }
  if (wanted !== kind) {
    if (wanted !== 'dry') return wanted
    return plan?.stops[0]?.compound ?? bestDryCompound(race.totalLaps - race.lap - 1, me.fuel, params)
  }
  return plan?.stops[0]?.compound ?? null
}

/** The Live Pit Wall: run one car's race from the pit wall, lap by lap, then go through the debrief. */
export function LivePitWall() {
  const def = useStudioStore((s) => s.def)
  const phase = usePitWallStore((s) => s.phase)
  const lapsChoice = usePitWallStore((s) => s.laps)
  const rainChance = usePitWallStore((s) => s.rainChance)
  const driver = usePitWallStore((s) => s.driver)
  const seed = usePitWallStore((s) => s.seed)
  const planIndex = usePitWallStore((s) => s.planIndex)
  const setup = usePitWallStore((s) => s.setup)
  const race = usePitWallStore((s) => s.race)
  const raceTrack = usePitWallStore((s) => s.track)
  const pending = usePitWallStore((s) => s.pending)
  const playing = usePitWallStore((s) => s.playing)
  const speed = usePitWallStore((s) => s.speed)
  const autoPause = usePitWallStore((s) => s.autoPause)
  const decisions = usePitWallStore((s) => s.decisions)
  const radio = usePitWallStore((s) => s.radio)
  const plan = usePitWallStore((s) => s.plan)
  const advice = usePitWallStore((s) => s.advice)
  const debrief = usePitWallStore((s) => s.debrief)
  const error = usePitWallStore((s) => s.error)
  const actions = usePitWallStore.getState()
  const study = useOptimiserStore((s) => s.study)

  const scene = useMemo(() => {
    const track = buildTrack(def)
    const paths = track ? buildTrackPaths(track) : null
    return {
      track,
      paths,
      analysis: track ? analyseTrack(track) : null,
      pitLength: paths?.pitLength ?? 0,
      drivable: track !== null && isDrivable(validateTrack(track)),
    }
  }, [def])
  const profile = useTrackProfile(def.id, scene)
  const laps = lapsChoice ?? (profile ? defaultLaps(profile.length) : LAP_OPTIONS[2])

  // The racing line of the trained drivers, if this circuit has any.
  const key = trackKey(def)
  const [ghost, setGhost] = useState<{ key: string; line: Float32Array } | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadDriver(def.id, DRIVER_LAYOUT.sizes).then((saved) => {
      if (!cancelled && saved?.ghost && saved.trackKey === key) setGhost({ key, line: saved.ghost })
    })
    return () => {
      cancelled = true
    }
  }, [def.id, key])
  const line = ghost && ghost.key === key ? ghost.line : null

  // The clock: each animation frame moves the lap on screen forward.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      tickPitWall((now - last) / 1000)
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Starting plans on offer: the optimiser's pick for this car and race, if it has one, then the quickest on a clear track.
  const plans = useMemo(() => {
    if (!profile) return []
    const out: { label: string; strategy: Strategy }[] = []
    const result = study?.result
    if (study && result && study.trackId === def.id && result.setup.laps === laps && result.setup.driver === driver) {
      const top = result.ranked[0].candidate.strategy
      out.push({ label: `Optimiser’s pick: ${describePlan(top)}`, strategy: top })
    }
    for (const r of rankStrategies(raceParams(profile, laps)).slice(0, 6)) {
      out.push({ label: describePlan(r.strategy), strategy: r.strategy })
    }
    return out
  }, [profile, laps, driver, study, def.id])
  const chosen = plans[Math.min(planIndex, Math.max(0, plans.length - 1))]

  const params = useMemo(() => (setup ? raceParams(setup.profile, setup.laps) : null), [setup])
  const active = phase !== 'setup' && race !== null && setup !== null && params !== null
  const me = active ? race.cars[driver] : null
  const otherTrack = active && raceTrack !== null && raceTrack.id !== def.id
  const suggestion = active && me?.running ? suggestedTyre(race, driver, plan, params) : null

  if (active && phase === 'finished') {
    return (
      <div className="fullrace">
        <Debrief race={race} driver={driver} trackName={raceTrack?.name ?? def.name} debrief={debrief} />
        <aside className="studio-side evolution-side" aria-label="Result and radio">
          <section className="panel">
            <h2>Race over</h2>
            {error && <p className="issue issue-error">{error}</p>}
            <button type="button" className="primary" data-coach="new-race" onClick={actions.leave}>
              New race
            </button>
          </section>
          <section className="panel">
            <h2>Result</h2>
            <Tower race={race} driver={driver} />
          </section>
          <section className="panel">
            <Radio messages={radio} limit={200} />
          </section>
        </aside>
      </div>
    )
  }

  return (
    <div className="pitwall">
      <div className="pitwall-main">
        <div className="evolution-stage">
          <PopulationCanvas
            track={scene.track}
            paths={scene.paths}
            ghost={line}
            source={pitwallFrame}
            style={CAR_STYLE}
            label="Track map: every car's position on the lap"
          />
          <div className="live-readout">
            <strong>{active ? (raceTrack?.name ?? def.name) : def.name}</strong>
            {active ? (
              <>
                <span>
                  Lap <b>{Math.min(race.totalLaps, race.lap + 1)}</b> of {race.totalLaps}
                </span>
                <span>
                  <b>
                    {race.safetyCar === 'sc' ? 'Safety car' : race.safetyCar === 'vsc' ? 'Virtual safety car' : 'Green flag'}
                  </b>
                </span>
                <span>{rainWord(race.weather.rain)}</span>
                {!playing && <span>Clock stopped</span>}
              </>
            ) : (
              <span>Not started</span>
            )}
          </div>
          {active && decisions.length > 0 && (
            <div className="pw-decision" role="alertdialog" aria-label="Decision point">
              <h3>Your call</h3>
              <ul>
                {decisions.map((d) => (
                  <li key={d.type}>{d.text}</li>
                ))}
              </ul>
              <div className="pw-decision-buttons" data-coach="decision">
                {suggestion && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      actions.setPit(suggestion)
                      actions.play()
                    }}
                  >
                    Box for {COMPOUNDS[suggestion].label.toLowerCase()}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    actions.setPit(null)
                    actions.play()
                  }}
                >
                  Stay out
                </button>
              </div>
              <p className="muted">Other tyres and driving modes are in the panel on the right.</p>
            </div>
          )}
        </div>

        {active ? (
          <div className="pitwall-under">
            <Radio messages={radio} />
            <WeatherPanel race={race} setup={setup} />
          </div>
        ) : (
          <div className="pitwall-under pitwall-intro">
            <div>
              <h1>Live Pit Wall</h1>
              <p>
                Run one car’s race from the pit wall. The race plays out lap by lap and the clock stops when there is a
                decision to make: a safety car, rain, tyres reaching the cliff, the pit window opening. You call the
                stops and the pace; the other nineteen cars are run by their own pit walls.
              </p>
              <p className="muted">
                After the flag the debrief replays every call against the strategy engine and shows what each one cost.
              </p>
            </div>
          </div>
        )}
      </div>

      <aside className="studio-side evolution-side" aria-label="Race controls, your car and timing">
        {!active ? (
          <>
            <section className="panel">
              <h2>Race setup</h2>
              {!scene.drivable && (
                <p className="issue issue-error">
                  This circuit has problems. <a href="#/studio">Fix it in the Track Studio</a> before racing on it.
                </p>
              )}
              <fieldset className="fields race-setup">
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
                  <select
                    value={laps}
                    onChange={(e) => actions.setOptions({ laps: Number(e.target.value), planIndex: 0 })}
                  >
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
                  <span>Starting plan</span>
                  <select
                    value={Math.min(planIndex, Math.max(0, plans.length - 1))}
                    onChange={(e) => actions.setOptions({ planIndex: Number(e.target.value) })}
                  >
                    {plans.map((p, i) => (
                      <option key={p.label} value={i}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
              <button
                type="button"
                className="primary"
                disabled={!profile || !scene.drivable || !scene.track || !chosen}
                data-coach="go-grid"
                onClick={() => {
                  if (!profile || !scene.track || !chosen) return
                  actions.start(profile, laps, { id: def.id, name: def.name }, chosen.strategy, lapPath(scene.track, line))
                }}
              >
                Go to the grid
              </button>
              <p className="muted">
                The plan only sets your starting tyres and the engineer’s first thought. Every stop is your call.
                {line ? ' Cars follow the trained drivers’ racing line.' : ' Cars follow the centre of the track until drivers have been trained on it.'}
              </p>
            </section>
            {profile && <ProfileCard profile={profile} />}
          </>
        ) : (
          <>
            <section className="panel">
              <h2>Race control</h2>
              {error && <p className="issue issue-error">{error}</p>}
              {otherTrack && (
                <p className="issue issue-warning">
                  This race is on {raceTrack?.name}; the map shows the circuit now open in the Track Studio.
                </p>
              )}
              <button
                type="button"
                className={playing ? 'primary is-stop' : 'primary'}
                data-coach="lights-out"
                onClick={playing ? actions.pause : actions.play}
              >
                {playing ? 'Stop the clock' : race.lap === 0 ? 'Lights out' : 'Resume'}
              </button>
              <div className="button-row">
                <button type="button" onClick={actions.nextLap} title="Finish this lap at once">
                  Next lap
                </button>
                <button type="button" onClick={actions.leave} title="Abandon this race and go back to the setup">
                  Abandon
                </button>
              </div>
              <div className="segmented pw-speed" role="group" aria-label="Race speed">
                {PITWALL_SPEEDS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    title={`A lap takes ${s.seconds} s`}
                    className={speed === s.value ? 'is-active' : undefined}
                    aria-pressed={speed === s.value}
                    onClick={() => actions.setSpeed(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={autoPause} onChange={(e) => actions.setAutoPause(e.target.checked)} />
                <span>Stop the clock at decision points</span>
              </label>
            </section>

            <CarPanel race={race} driver={driver} params={params} pending={pending} advice={advice} />

            <section className="panel">
              <PitWindow race={race} driver={driver} plan={plan} />
            </section>

            <section className="panel">
              <h2>Timing</h2>
              <Tower race={race} driver={driver} />
            </section>
          </>
        )}
      </aside>
    </div>
  )
}
