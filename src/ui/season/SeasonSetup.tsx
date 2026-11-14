import { useEffect, useMemo, useState } from 'react'
import { carPace } from '../../core/race/engine'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import type { Distance } from '../../core/season/season'
import { isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { createPresets } from '../../core/track/presets'
import { useSeasonStore } from '../../state/seasonStore'
import { useStudioStore } from '../../state/studioStore'
import { ordinal } from './format'

/** What running each team is like, from where it starts in the order. */
function standing(team: number): { tag: string; text: string } {
  if (team < 3)
    return {
      tag: 'Front-runner',
      text: 'Wins are expected. Anything less is a bad day.',
    }
  if (team < 7)
    return {
      tag: 'Midfield',
      text: 'Points most weekends, a podium when the race falls your way.',
    }
  return {
    tag: 'Backmarker',
    text: 'A point is a result. Development aid helps you catch up.',
  }
}

const LENGTHS = [
  { rounds: 5, label: '5 rounds', text: 'Each circuit once' },
  { rounds: 10, label: '10 rounds', text: 'Each circuit twice' },
] as const

const DISTANCES: readonly { id: Distance; label: string; text: string }[] = [
  { id: 'sprint', label: 'Sprint', text: 'About 90 km: 15 to 45 laps' },
  { id: 'full', label: 'Full', text: 'About 150 km: 20 to 70 laps' },
]

/** The start of a career: pick a team and a car, and the shape of the season. */
export function SeasonSetup() {
  const busy = useSeasonStore((s) => s.busy)
  const error = useSeasonStore((s) => s.error)
  const begin = useSeasonStore((s) => s.begin)
  const saved = useStudioStore((s) => s.saved)
  const hydrateLibrary = useStudioStore((s) => s.hydrateLibrary)

  const [team, setTeam] = useState(4)
  const [seat, setSeat] = useState(0)
  const [bothCars, setBothCars] = useState(false)
  const [rounds, setRounds] = useState<number>(5)
  const [distance, setDistance] = useState<Distance>('sprint')
  const [extra, setExtra] = useState<string[]>([])
  const [seed, setSeed] = useState(() => 1 + Math.floor(Math.random() * 99999))

  useEffect(() => {
    void hydrateLibrary()
  }, [hydrateLibrary])

  // The player's own circuits that can be raced on.
  const own = useMemo(
    () =>
      saved.filter((def) => {
        const track = buildTrack(def)
        return track !== null && isDrivable(validateTrack(track))
      }),
    [saved],
  )
  const chosen = own.filter((def) => extra.includes(def.id))
  const circuits = createPresets().length + chosen.length
  const drivers = [team * 2, team * 2 + 1]
  const quicker = carPace(drivers[0]) <= carPace(drivers[1]) ? 0 : 1
  const info = standing(team)

  return (
    <div className="season season-setup">
      <header className="season-title">
        <p className="season-eyebrow">Championship</p>
        <h1>Run a team through a season</h1>
        <p>
          Every round is a race weekend: practice to set the car up, a three-part qualifying for your grid slot, then
          the race from the pit wall. Points go into the drivers’ and teams’ tables, and prize money into developing the
          car between rounds.
        </p>
      </header>

      <section className="season-card" aria-labelledby="team-title">
        <h2 id="team-title">1. Your team</h2>
        <div className="team-grid" role="radiogroup" aria-label="Team">
          {TEAMS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={team === i}
              className={team === i ? 'team-card is-chosen' : 'team-card'}
              style={{ '--team': t.color } as React.CSSProperties}
              onClick={() => setTeam(i)}
            >
              <span className="team-name">{t.name}</span>
              <span className="team-pace">{i + 1 === 1 ? 'Quickest car' : `${ordinal(i + 1)} quickest car`}</span>
              <span className="team-tag">{standing(i).tag}</span>
            </button>
          ))}
        </div>
        <p className="season-note">
          <strong>{info.tag}.</strong> {info.text}
        </p>
      </section>

      <section className="season-card" aria-labelledby="seat-title">
        <h2 id="seat-title">2. Your car</h2>
        <p className="season-note">
          This is the car you qualify, and the one whose championship position is yours. Both cars share the same
          development.
        </p>
        <div className="seat-row" role="radiogroup" aria-label="Driver">
          {drivers.map((d, i) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={seat === i}
              className={seat === i ? 'seat is-chosen' : 'seat'}
              onClick={() => setSeat(i)}
            >
              <span className="seat-number" style={{ color: TEAMS[team].color }}>
                {DRIVERS[d].number}
              </span>
              <span className="seat-name">{DRIVERS[d].name}</span>
              <span className="seat-note">
                {i === quicker ? 'The quicker of the two' : 'A little slower: a harder season'}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="season-card" aria-labelledby="cars-title">
        <h2 id="cars-title">3. On race day</h2>
        <div className="choice-row" role="radiogroup" aria-label="How many cars you run in the races">
          <button
            type="button"
            role="radio"
            aria-checked={!bothCars}
            className={!bothCars ? 'choice is-chosen' : 'choice'}
            onClick={() => setBothCars(false)}
          >
            <strong>One car</strong>
            <span>You call the race for {DRIVERS[drivers[seat]].name}. The engineer runs the other car.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={bothCars}
            className={bothCars ? 'choice is-chosen' : 'choice'}
            onClick={() => setBothCars(true)}
          >
            <strong>Both cars</strong>
            <span>You call the race for both. Stop them on the same lap and the second one queues for the box.</span>
          </button>
        </div>
      </section>

      <section className="season-card" aria-labelledby="shape-title">
        <h2 id="shape-title">4. The season</h2>
        <div className="shape-grid">
          <div>
            <h3>Rounds</h3>
            <div className="choice-row" role="radiogroup" aria-label="Season length">
              {LENGTHS.map((l) => (
                <button
                  key={l.rounds}
                  type="button"
                  role="radio"
                  aria-checked={rounds === l.rounds}
                  className={rounds === l.rounds ? 'choice is-chosen' : 'choice'}
                  onClick={() => setRounds(l.rounds)}
                >
                  <strong>{l.label}</strong>
                  <span>{l.text}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>Race distance</h3>
            <div className="choice-row" role="radiogroup" aria-label="Race distance">
              {DISTANCES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={distance === d.id}
                  className={distance === d.id ? 'choice is-chosen' : 'choice'}
                  onClick={() => setDistance(d.id)}
                >
                  <strong>{d.label}</strong>
                  <span>{d.text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <h3>Circuits</h3>
        <p className="season-note">
          The five preset circuits are on every calendar.
          {own.length > 0
            ? ' Add your own saved circuits to race on them too:'
            : ' Save a circuit of your own in the Track Studio and it can join the calendar.'}
        </p>
        {own.length > 0 && (
          <div className="own-circuits">
            {own.map((def) => (
              <label key={def.id} className="own-circuit">
                <input
                  type="checkbox"
                  checked={extra.includes(def.id)}
                  onChange={(e) =>
                    setExtra(e.target.checked ? [...extra, def.id] : extra.filter((id) => id !== def.id))
                  }
                />
                <span>{def.name}</span>
              </label>
            ))}
          </div>
        )}

        <label className="seed-field">
          <span>Season number</span>
          <input
            type="number"
            min={1}
            max={999999}
            value={seed}
            onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
          />
          <small>The same number gives the same weather, luck and rivals.</small>
        </label>
      </section>

      {error && <p className="season-error">{error}</p>}
      <div className="season-go">
        <button
          type="button"
          className="cta"
          data-coach="season-start"
          disabled={busy}
          onClick={() => void begin({ team, seat, bothCars, rounds, distance, seed, extra: chosen })}
        >
          {busy ? 'Setting up…' : 'Start the season'} <span aria-hidden="true">→</span>
        </button>
        <span className="season-note">
          {TEAMS[team].name}, {DRIVERS[drivers[seat]].name}
          {bothCars ? ' and both cars on race day' : ''}: {rounds} rounds on {circuits} circuits.
        </span>
      </div>
    </div>
  )
}
