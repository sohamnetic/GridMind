import { useEffect, useMemo, useRef, useState } from 'react'
import { DRIVER_LAYOUT } from '../../core/evolution/trainer'
import { lapPath } from '../../core/pitwall/session'
import type { RaceState } from '../../core/race/engine'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import {
  buildReplay,
  replayDistances,
  replayFractions,
  replayInPit,
  replayLap,
  replayMoments,
  replayOrder,
  type ReplayMoment,
} from '../../core/race/replay'
import { buildTrack } from '../../core/track/build'
import type { TrackDef } from '../../core/track/types'
import { buildTrackPaths } from '../../render/trackRenderer'
import { loadDriver, trackKey } from '../../state/driverLibrary'
import { PopulationCanvas } from '../components/PopulationCanvas'
import type { FrameSource } from '../evolution/evolutionView'
import { safetyPeriods } from './RaceCharts'

const CAR_STYLE = {
  colors: DRIVERS.map((d) => TEAMS[d.team].color),
  labels: DRIVERS.map((d) => d.code),
}

/** How many seconds of the race pass in one second of watching. */
const SPEEDS = [
  { rate: 1, label: '1×', title: 'As it happened' },
  { rate: 5, label: '5×', title: 'Five times as fast' },
  { rate: 20, label: '20×', title: 'A lap every few seconds' },
  { rate: 60, label: '60×', title: 'The whole race in a minute or two' },
] as const

/** Pixels per metre when the camera follows a car. */
const FOLLOW_ZOOM = 2.6

/** Car positions for the replay's map. One replay is on screen at a time. */
const replayFrame: FrameSource = { seq: 0, leader: 0, cars: null, follow: -1, followZoom: FOLLOW_ZOOM }

const code = (driver: number | undefined) => (driver === undefined ? '' : DRIVERS[driver].code)

function momentText(m: ReplayMoment): string {
  switch (m.type) {
    case 'start':
      return 'The start'
    case 'overtake':
      return `${code(m.car)} passes ${code(m.other)}`
    case 'passed':
      return `${code(m.other)} passes ${code(m.car)}`
    case 'pit':
      return `${code(m.car)} pits`
    case 'sc':
      return 'Safety car'
    case 'green':
      return 'Green flag'
    case 'rain':
      return 'Rain begins'
    case 'dry':
      return 'Rain stops'
    case 'out':
      return `${code(m.car)} retires`
    case 'flag':
      return 'The flag'
  }
}

function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

interface Props {
  race: RaceState
  /** The circuit the race was run on. */
  def: TrackDef
  /** The car to follow to begin with. */
  focus: number
  title: string
  onClose: () => void
}

/**
 * A finished race played back on the track map: every car where it was,
 * with a camera that can ride along with one of them, a bar to move through
 * the race and buttons that jump to what happened.
 */
export function RaceReplay({ race, def, focus, title, onClose }: Props) {
  const scene = useMemo(() => {
    const track = buildTrack(def)
    return { track, paths: track ? buildTrackPaths(track) : null }
  }, [def])
  const replay = useMemo(() => buildReplay(race), [race])

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
  const path = useMemo(() => (scene.track ? lapPath(scene.track, line) : null), [scene.track, line])

  const [playing, setPlaying] = useState(true)
  const [rate, setRate] = useState<number>(5)
  const [follow, setFollow] = useState(focus)
  /** The camera rides with the followed car, or shows the whole circuit. */
  const [riding, setRiding] = useState(true)
  /** The clock as last shown: the true one runs in a ref, between redraws. */
  const [shown, setShown] = useState(0)
  const clock = useRef(0)
  const live = useRef({ playing, rate, follow, riding })
  useEffect(() => {
    live.current = { playing, rate, follow, riding }
  }, [playing, rate, follow, riding])

  const moments = useMemo(() => replayMoments(race, replay, follow), [race, replay, follow])
  const periods = useMemo(() => safetyPeriods(race), [race])

  // The animation: move the clock on, put every car where it was.
  useEffect(() => {
    if (!path || path.length < 4) return
    const count = replay.crossings.length
    const fractions = new Float32Array(count)
    const cars = new Float32Array(count * 4)
    const points = path.length / 2
    let raf = 0
    let last = performance.now()
    let sinceShown = 0

    const place = () => {
      replayFractions(replay, clock.current, fractions)
      for (let i = 0; i < count; i++) {
        const o = i * 4
        const f = fractions[i]
        if (f < 0) {
          cars[o + 3] = 4 // not drawn
          continue
        }
        const s = f * points
        const a = Math.floor(s) % points
        const b = (a + 1) % points
        const t = s - Math.floor(s)
        const ax = path[a * 2]
        const ay = path[a * 2 + 1]
        const bx = path[b * 2]
        const by = path[b * 2 + 1]
        cars[o] = ax + (bx - ax) * t
        cars[o + 1] = ay + (by - ay) * t
        cars[o + 2] = Math.atan2(by - ay, bx - ax)
        cars[o + 3] = 0
      }
      const now = live.current
      replayFrame.cars = cars
      replayFrame.leader = now.follow
      replayFrame.follow = now.riding ? now.follow : -1
      replayFrame.seq++
    }

    const loop = (time: number) => {
      const dt = Math.min(0.25, (time - last) / 1000)
      last = time
      const now = live.current
      if (now.playing) {
        clock.current = Math.min(replay.duration, clock.current + dt * now.rate)
        if (clock.current >= replay.duration) setPlaying(false)
      }
      place()
      sinceShown += dt
      if (sinceShown >= 0.12) {
        sinceShown = 0
        setShown(clock.current)
      }
      raf = requestAnimationFrame(loop)
    }
    place()
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      replayFrame.cars = null
      replayFrame.follow = -1
      replayFrame.seq++
    }
  }, [path, replay])

  const seek = (time: number) => {
    clock.current = Math.min(replay.duration, Math.max(0, time))
    setShown(clock.current)
  }
  const next = moments.find((m) => m.time > shown + 1)
  const previous = [...moments].reverse().find((m) => m.time < shown - 3)
  const current = [...moments].reverse().find((m) => m.time <= shown + 1)
  const lap = replayLap(replay, shown)
  const order = useMemo(() => replayOrder(replay, shown), [replay, shown])
  // Who has gone from the track and who is in the pits, by the same clock the map is drawn from.
  const status = useMemo(() => {
    const distance = new Float32Array(replay.crossings.length)
    replayDistances(replay, shown, distance)
    return Array.from(distance, (d, car) => (d < 0 ? 'out' : replayInPit(replay, car, shown) ? 'pit' : 'running'))
  }, [replay, shown])
  const x = (time: number) => (replay.duration > 0 ? (time / replay.duration) * 1000 : 0)
  const leaderTimes = replay.crossings[race.order[0]]
  const lapTime = (n: number) => leaderTimes[Math.min(leaderTimes.length - 1, Math.max(0, n))] ?? 0

  if (!scene.track || !scene.paths) {
    return (
      <div className="replay">
        <p className="issue issue-error">This circuit can no longer be drawn, so the race cannot be replayed on it.</p>
        <button type="button" onClick={onClose}>
          Close the replay
        </button>
      </div>
    )
  }

  return (
    <div className="replay">
      <div className="replay-stage">
        <PopulationCanvas
          track={scene.track}
          paths={scene.paths}
          ghost={line}
          source={replayFrame}
          style={CAR_STYLE}
          label="Race replay: every car's position on the track"
        />
        <div className="live-readout">
          <strong>{title}</strong>
          <span>
            Lap <b>{lap}</b> of {replay.laps}
          </span>
          <span>{clockText(shown)}</span>
          {current && <span>{momentText(current)}</span>}
        </div>
        <ol className="replay-order" aria-label="Running order">
          {order.map((driver, place) => {
            const out = status[driver] === 'out'
            return (
              <li key={driver} className={driver === follow ? 'is-followed' : out ? 'is-out' : undefined}>
                <button type="button" onClick={() => setFollow(driver)} title={`Follow ${DRIVERS[driver].name}`}>
                  <span className="num">{out ? '–' : place + 1}</span>
                  <span
                    className="team-bar"
                    style={{ background: TEAMS[DRIVERS[driver].team].color }}
                    aria-hidden="true"
                  />
                  {DRIVERS[driver].code}
                  {status[driver] === 'pit' && <span className="replay-pit">PIT</span>}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="replay-bar">
        <div className="replay-controls">
          <button
            type="button"
            className="replay-play"
            onClick={() => {
              if (!playing && shown >= replay.duration) seek(0)
              setPlaying(!playing)
            }}
          >
            {playing ? 'Pause' : shown >= replay.duration ? 'Watch again' : 'Play'}
          </button>
          <div className="segmented replay-speed" role="group" aria-label="Replay speed">
            {SPEEDS.map((s) => (
              <button
                key={s.rate}
                type="button"
                title={s.title}
                className={rate === s.rate ? 'is-active' : undefined}
                aria-pressed={rate === s.rate}
                onClick={() => setRate(s.rate)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!previous}
            onClick={() => previous && seek(previous.time)}
            title={previous ? momentText(previous) : undefined}
          >
            ◀ Previous moment
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && seek(next.time)}
            title={next ? momentText(next) : undefined}
          >
            Next moment ▶{next ? `: ${momentText(next)}` : ''}
          </button>
          <label className="replay-follow">
            <span>Follow</span>
            <select value={follow} onChange={(e) => setFollow(Number(e.target.value))}>
              {race.order.map((driver) => (
                <option key={driver} value={driver}>
                  {DRIVERS[driver].name}
                </option>
              ))}
            </select>
          </label>
          <label className="check replay-ride">
            <input type="checkbox" checked={riding} onChange={(e) => setRiding(e.target.checked)} />
            <span>Camera rides along</span>
          </label>
          <button type="button" className="replay-close" onClick={onClose}>
            Close the replay
          </button>
        </div>

        <div className="replay-scrub">
          <svg viewBox="0 0 1000 16" preserveAspectRatio="none" aria-hidden="true">
            {periods.map((p) => (
              <rect
                key={p.from}
                x={x(lapTime(p.from - 1))}
                y={0}
                width={Math.max(2, x(lapTime(p.to)) - x(lapTime(p.from - 1)))}
                height={16}
                className="replay-sc"
              />
            ))}
            {moments.map((m, i) => (
              <rect
                key={i}
                x={x(m.time) - 1.5}
                y={m.type === 'overtake' || m.type === 'passed' ? 4 : 0}
                width={3}
                height={m.type === 'overtake' || m.type === 'passed' ? 12 : 16}
                className={`replay-tick is-${m.type}`}
              >
                <title>{`Lap ${m.lap}: ${momentText(m)}`}</title>
              </rect>
            ))}
          </svg>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(replay.duration))}
            step={1}
            value={Math.round(shown)}
            aria-label="Position in the race"
            aria-valuetext={`Lap ${lap} of ${replay.laps}`}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </div>
        <ul className="chart-key replay-key">
          <li>
            <span className="key-swatch replay-key-pass" /> {DRIVERS[follow].code} makes a pass
          </li>
          <li>
            <span className="key-swatch replay-key-passed" /> {DRIVERS[follow].code} is passed
          </li>
          <li>
            <span className="key-swatch replay-key-pit" /> Pit stop
          </li>
          <li>
            <span className="key-swatch key-sc" /> Safety car
          </li>
          <li>
            <span className="key-swatch replay-key-rain" /> Weather changes
          </li>
        </ul>
      </div>
    </div>
  )
}
