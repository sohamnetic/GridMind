import { useEffect, useMemo, useState } from 'react'
import { CarStatus } from '../../core/evolution/episode'
import type { RaceEvent } from '../../core/evolution/raceSim'
import { DRIVER_LAYOUT } from '../../core/evolution/trainer'
import { formatLapTime } from '../../core/physics/lapTimer'
import { estimateProfile, measureProfile, type TrackProfile } from '../../core/profile/trackProfile'
import { DRIVERS, TEAMS, type GridOrder } from '../../core/race/grid'
import { analyseTrack, isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { buildTrackPaths } from '../../render/trackRenderer'
import { loadDriver, trackKey } from '../../state/driverLibrary'
import { raceFrame, useRaceStore } from '../../state/raceStore'
import { useStudioStore } from '../../state/studioStore'
import type { RaceTiming, TimingRow } from '../../workers/raceProtocol'
import { PopulationCanvas } from '../components/PopulationCanvas'
import { RACE_SPEEDS, SpeedPicker } from '../components/SpeedPicker'
import '../evolution/evolution.css'
import './race.css'

const CAR_STYLE = {
  colors: DRIVERS.map((d) => TEAMS[d.team].color),
  labels: DRIVERS.map((d) => d.code),
}

const CAR_OPTIONS = [8, 12, 16, 20]
const LAP_OPTIONS = [3, 5, 8, 12]
const GRID_OPTIONS: { value: GridOrder; label: string }[] = [
  { value: 'mixed', label: 'Shuffled' },
  { value: 'pace', label: 'Fastest cars first' },
  { value: 'reversed', label: 'Fastest cars last' },
]

export function RaceScreen() {
  const studioDef = useStudioStore((s) => s.def)
  const mode = useRaceStore((s) => s.mode)
  const status = useRaceStore((s) => s.status)
  const speed = useRaceStore((s) => s.speed)
  const raceDef = useRaceStore((s) => s.def)
  const timing = useRaceStore((s) => s.timing)
  const events = useRaceStore((s) => s.events)
  const cars = useRaceStore((s) => s.cars)
  const laps = useRaceStore((s) => s.laps)
  const grid = useRaceStore((s) => s.grid)
  const drivers = useRaceStore((s) => s.drivers)
  const error = useRaceStore((s) => s.error)
  const actions = useRaceStore.getState()
  const racing = mode === 'race'

  // While a race is on, show the circuit it is being run on.
  const def = (racing ? raceDef : null) ?? studioDef
  const scene = useMemo(() => {
    const track = buildTrack(def)
    const paths = track ? buildTrackPaths(track) : null
    return {
      track,
      paths,
      analysis: track ? analyseTrack(track) : null,
      drivable: track !== null && isDrivable(validateTrack(track)),
    }
  }, [def])

  useEffect(() => {
    void useRaceStore.getState().refresh(studioDef.id)
  }, [studioDef.id, mode])

  useEffect(() => {
    if (!racing) return
    useRaceStore.getState().setFramesEnabled(true)
    return () => {
      if (useRaceStore.getState().mode === 'race') useRaceStore.getState().setFramesEnabled(false)
    }
  }, [racing, status])

  const profile = useTrackProfile(def.id, scene)
  const stale = drivers !== null && drivers.trackKey !== trackKey(studioDef)

  return (
    <div className="evolution race">
      <div className="evolution-stage">
        <PopulationCanvas
          track={scene.track}
          paths={scene.paths}
          source={raceFrame}
          style={CAR_STYLE}
          label="Race view: the cars on the circuit"
        />
        <div className="live-readout">
          <strong>{def.name}</strong>
          {timing ? (
            <>
              <span>
                Lap <b>{timing.lap}</b> of {timing.totalLaps}
              </span>
              <span>
                <b>{formatClock(timing.time)}</b>
              </span>
              <span>
                <b>{timing.overtakes}</b> overtakes
              </span>
              <span>
                <b>{timing.contacts}</b> contacts
              </span>
            </>
          ) : (
            <span>No race running</span>
          )}
        </div>
      </div>

      <aside className="studio-side evolution-side" aria-label="Race controls, timing and track profile">
        <section className="panel">
          <h2>Wheel-to-wheel race</h2>
          {error && (
            <p className="issue issue-error" role="alert">
              {error}
            </p>
          )}

          {!racing && (
            <>
              {drivers === null || drivers.recordLap === null ? (
                <p className="issue issue-warning">
                  This circuit has no drivers that can complete a lap yet.{' '}
                  <a href="#/evolution">Train them in Driver Evolution</a> first.
                </p>
              ) : (
                <p className="muted">
                  {drivers.trafficGeneration === null
                    ? 'These drivers have only trained alone, so expect contact. Racecraft training (stage 2 of Driver Evolution) teaches them to race each other.'
                    : `Drivers have ${drivers.trafficGeneration} generations of racecraft training.`}
                  {stale && ' They were trained before the circuit was last edited.'}
                </p>
              )}
              <fieldset className="fields race-setup">
                <label className="field">
                  <span>Cars</span>
                  <select value={cars} onChange={(e) => actions.setRaceOptions({ cars: Number(e.target.value) })}>
                    {CAR_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Laps</span>
                  <select value={laps} onChange={(e) => actions.setRaceOptions({ laps: Number(e.target.value) })}>
                    {LAP_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Grid</span>
                  <select value={grid} onChange={(e) => actions.setRaceOptions({ grid: e.target.value as GridOrder })}>
                    {GRID_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>
              <button
                type="button"
                className="primary"
                disabled={!scene.drivable || drivers === null || drivers.recordLap === null}
                onClick={() => void actions.startRace(studioDef)}
              >
                Start race
              </button>
            </>
          )}

          {racing && (
            <>
              <SpeedPicker options={RACE_SPEEDS} value={speed} onChange={actions.setSpeed} />
              <div className="button-row">
                {status === 'finished' ? (
                  <button type="button" onClick={() => void actions.startRace(raceDef ?? studioDef)}>
                    Race again
                  </button>
                ) : status === 'paused' ? (
                  <button type="button" onClick={actions.resume}>
                    Resume
                  </button>
                ) : (
                  <button type="button" onClick={actions.pause} disabled={status === 'starting'}>
                    Pause
                  </button>
                )}
                <button type="button" onClick={actions.stop}>
                  {status === 'finished' ? 'Close' : 'Abandon'}
                </button>
              </div>
            </>
          )}
        </section>

        {timing && (
          <section className="panel">
            <h2>{timing.finished ? 'Result' : 'Timing'}</h2>
            {timing.finished && <ResultSummary timing={timing} />}
            <TimingTower timing={timing} />
            {events.length > 0 && (
              <>
                <h3>Race log</h3>
                <ol className="race-log">
                  {events.slice(0, 12).map((event, i) => (
                    <li key={`${event.time}-${event.type}-${event.car}-${i}`}>
                      <span className="num">{formatClock(event.time)}</span>
                      <span>{describe(event)}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        )}

        {profile && <ProfileCard profile={profile} />}
      </aside>
    </div>
  )
}

/**
 * Track profile for the strategy engine: measured from the stored best lap
 * when there is one, otherwise estimated from the geometry.
 */
function useTrackProfile(
  trackId: string,
  scene: {
    track: ReturnType<typeof buildTrack>
    paths: ReturnType<typeof buildTrackPaths> | null
    analysis: ReturnType<typeof analyseTrack> | null
  },
): TrackProfile | null {
  const [measured, setMeasured] = useState<{ key: object; profile: TrackProfile } | null>(null)
  const { track, paths, analysis } = scene

  const estimate = useMemo(
    () => (track && analysis ? estimateProfile(track, analysis, paths?.pitLength ?? 0) : null),
    [track, analysis, paths],
  )

  useEffect(() => {
    if (!track || !analysis) return
    let cancelled = false
    void loadDriver(trackId, DRIVER_LAYOUT.sizes).then((driver) => {
      if (cancelled || !driver?.ghost || driver.snapshot.recordLap === null) return
      const profile = measureProfile(track, analysis, driver.ghost, driver.snapshot.recordLap, paths?.pitLength ?? 0)
      setMeasured({ key: track, profile })
    })
    return () => {
      cancelled = true
    }
  }, [trackId, track, analysis, paths])

  // A measurement belongs to the exact track it was made on.
  return measured && measured.key === track ? measured.profile : estimate
}

function TimingTower({ timing }: { timing: RaceTiming }) {
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
            <th scope="col" className="num">
              Last lap
            </th>
            <th scope="col" className="num" title="Places gained or lost from the grid">
              +/−
            </th>
          </tr>
        </thead>
        <tbody>
          {timing.rows.map((row, position) => {
            const driver = DRIVERS[row.car]
            const team = TEAMS[driver.team]
            const out = isRetired(row.status)
            const moved = row.grid - position
            return (
              <tr key={row.car} className={out ? 'is-out' : undefined}>
                <td className="num">{out ? '–' : position + 1}</td>
                <th scope="row" title={`${driver.name}, ${team.name}`}>
                  <span className="team-bar" style={{ background: team.color }} aria-hidden="true" />
                  {driver.code}
                  {row.drs && <span className="drs-tag">DRS</span>}
                </th>
                <td className="num">{formatGap(row, position)}</td>
                <td
                  className={
                    row.car === timing.fastestCar && row.lastLap === timing.fastestLap ? 'num is-fastest' : 'num'
                  }
                >
                  {formatLapTime(row.lastLap)}
                </td>
                <td className={moved > 0 ? 'num is-gain' : moved < 0 ? 'num is-loss' : 'num'}>
                  {out ? '' : moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : '·'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ResultSummary({ timing }: { timing: RaceTiming }) {
  const winner = DRIVERS[timing.rows[0].car]
  const classified = timing.rows.filter((r) => !isRetired(r.status)).length
  return (
    <p className="race-result">
      <strong style={{ color: TEAMS[winner.team].color }}>{winner.name}</strong> wins for {TEAMS[winner.team].name}.{' '}
      {classified} of {timing.rows.length} cars classified, {timing.overtakes} overtakes, {timing.contacts} contacts
      {timing.fastestLap !== null && timing.fastestCar >= 0 && (
        <>
          ; fastest lap {formatLapTime(timing.fastestLap)} by {DRIVERS[timing.fastestCar].code}
        </>
      )}
      .
    </p>
  )
}

function ProfileCard({ profile }: { profile: TrackProfile }) {
  return (
    <section className="panel">
      <h2>Track profile</h2>
      <p className="muted">
        {profile.source === 'drivers'
          ? 'Measured from the best trained driver’s lap. The strategy engine uses these numbers.'
          : 'Estimated from the circuit’s shape; it becomes a measurement once drivers have set a lap. The strategy engine uses these numbers.'}
      </p>
      <dl className="stats profile-stats">
        <Stat label="Base lap time" value={formatLapTime(profile.baseLapTime)} />
        <Stat label="Top speed" value={`${Math.round(profile.topSpeed * 3.6)} km/h`} />
        <Stat label="On the throttle" value={`${Math.round(profile.fullThrottle * 100)} %`} />
        <Stat label="Tyre stress" value={`×${profile.tyreStress.toFixed(2)}`} />
        <Stat label="Pit lane" value={`${Math.round(profile.pitLaneLength)} m`} />
        <Stat label="Pit lane time loss" value={`${profile.pitLossTime.toFixed(1)} s`} />
        <Stat label="Passing zones" value={String(profile.passingZones)} />
        <Stat
          label="Overtaking"
          value={`${difficultyWord(profile.overtakingDifficulty)} (${profile.overtakingDifficulty.toFixed(2)})`}
        />
      </dl>
    </section>
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

function isRetired(status: number): boolean {
  return status === CarStatus.Crashed || status === CarStatus.Stalled || status === CarStatus.Reversed
}

function formatGap(row: TimingRow, position: number): string {
  if (isRetired(row.status)) return 'Out'
  if (position === 0) return 'Leader'
  if (row.lapsDown > 0) return `+${row.lapsDown} lap${row.lapsDown > 1 ? 's' : ''}`
  return row.gap === null ? '–' : `+${row.gap.toFixed(row.gap < 10 ? 2 : 1)}`
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds - m * 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function describe(event: RaceEvent): string {
  const who = DRIVERS[event.car]?.code ?? '?'
  switch (event.type) {
    case 'overtake':
      return `${who} passes ${DRIVERS[event.other ?? 0]?.code ?? '?'}`
    case 'out':
      return `${who} is out of the race`
    case 'finish':
      return `${who} takes the flag`
    case 'fastest':
      return `${who} sets the fastest lap, ${formatLapTime(event.value)}`
  }
}

function difficultyWord(d: number): string {
  if (d < 0.35) return 'Easy'
  if (d < 0.55) return 'Moderate'
  if (d < 0.75) return 'Hard'
  return 'Very hard'
}
