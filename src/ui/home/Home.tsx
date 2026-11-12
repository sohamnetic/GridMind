import { useMemo } from 'react'
import { TEAMS } from '../../core/race/grid'
import { analyseTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { createPresets } from '../../core/track/presets'
import type { BuiltTrack, TrackDef } from '../../core/track/types'
import { useStudioStore } from '../../state/studioStore'
import { flowSteps, nextStep, type FlowStatus } from '../app/flow'
import { ModuleIcon } from '../app/icons'
import type { Route } from '../app/useHashRoute'
import './home.css'

/** What each preset is like to race on, in a few words. */
const CHARACTER: Record<string, string> = {
  'preset-pinewood': 'Short and busy. Many laps, tyres wear quickly, two stops.',
  'preset-oval': 'Flat out. Easy to pass on, long pit lane.',
  'preset-harbour': 'Tight street circuit. Hard on drivers, easy on tyres.',
  'preset-vento': 'Fast and flowing. A short race with one stop.',
  'preset-kestrel': 'The all-rounder. A long lap with an expensive pit stop.',
}

/** The centreline as an SVG path in the track's own metres. */
function outline(track: BuiltTrack, every = 2): string {
  let d = ''
  for (let i = 0; i < track.n; i += every) d += `${i === 0 ? 'M' : 'L'}${track.x[i].toFixed(1)} ${track.y[i].toFixed(1)}`
  return `${d}Z`
}

function viewBox(track: BuiltTrack, pad: number): string {
  const { minX, minY, maxX, maxY } = track.bounds
  return `${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(maxX - minX + 2 * pad).toFixed(0)} ${(maxY - minY + 2 * pad).toFixed(0)}`
}

function Thumbnail({ track }: { track: BuiltTrack }) {
  const d = outline(track, 3)
  return (
    <svg className="thumb" viewBox={viewBox(track, track.length * 0.03)} aria-hidden="true">
      <path d={d} className="thumb-road" />
      <path d={d} className="thumb-line" />
    </svg>
  )
}

/** A circuit with cars circulating: drawn once, moved by the browser's own SVG animation. */
function HeroCircuit({ track }: { track: BuiltTrack }) {
  const d = outline(track)
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const size = track.length * 0.012
  const cars = [0, 2, 4, 6, 9, 11, 13, 16]
  return (
    <svg className="hero-circuit" viewBox={viewBox(track, track.length * 0.035)} aria-hidden="true">
      <path d={d} className="hero-glow" />
      <path d={d} className="hero-road" />
      <path d={d} className="hero-line" id="hero-line" />
      {cars.map((team, i) => (
        <circle key={team} r={size} fill={TEAMS[team % TEAMS.length].color} className="hero-car">
          {still ? (
            <animateMotion dur="1s" begin="0s" fill="freeze" keyPoints={`${i / cars.length};${i / cars.length}`} keyTimes="0;1">
              <mpath href="#hero-line" />
            </animateMotion>
          ) : (
            <animateMotion dur={`${22 + i * 0.35}s`} begin={`${-(i * 2.6 + (i % 3) * 0.5).toFixed(1)}s`} repeatCount="indefinite">
              <mpath href="#hero-line" />
            </animateMotion>
          )}
        </circle>
      ))}
    </svg>
  )
}

interface Props {
  status: FlowStatus
  navigate: (route: Route) => void
}

/** The front page: what GridMind is, a circuit to start with, and the five steps. */
export function Home({ status, navigate }: Props) {
  const def = useStudioStore((s) => s.def)
  const hasEdits = useStudioStore((s) => s.past.length > 0)
  const loadTrack = useStudioStore((s) => s.loadTrack)
  const newTrack = useStudioStore((s) => s.newTrack)

  const presets = useMemo(
    () =>
      createPresets().flatMap((preset) => {
        const track = buildTrack(preset)
        return track ? [{ def: preset, track, corners: analyseTrack(track).corners.length }] : []
      }),
    [],
  )
  const hero = presets.find((p) => p.def.id === 'preset-kestrel') ?? presets[0]
  const steps = flowSteps(status)
  const next = nextStep(status)
  const own = !def.id.startsWith('preset-') && def.points.length >= 3

  const confirmDiscard = () => !hasEdits || window.confirm('Discard the changes to the circuit you are working on?')

  const open = (track: TrackDef) => {
    if (track.id !== def.id) {
      if (!confirmDiscard()) return
      loadTrack(track)
    }
    navigate('studio')
  }

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <p className="hero-eyebrow">AI circuit lab · pit wall strategy simulator</p>
          <h1>
            Build a circuit. Teach AI to race it. <em>Then out-think it from the pit wall.</em>
          </h1>
          <p className="hero-lede">
            Everything runs in this browser tab: drivers that learn by evolution, a twenty-car race engine, a strategy
            optimiser that plays thousands of races, and a pit wall where the calls are yours.
          </p>
          <div className="hero-actions">
            <button type="button" className="cta" onClick={() => (own ? navigate(next.id) : open(hero.def))}>
              {own ? `Carry on with ${def.name}` : `Quick start on ${hero.def.name}`} <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className="cta cta-ghost"
              onClick={() => {
                if (!confirmDiscard()) return
                newTrack()
                navigate('studio')
              }}
            >
              Draw my own circuit
            </button>
          </div>
          <p className="hero-note">Free, no account, nothing uploaded. A coach strip on every screen says what to do next.</p>
        </div>
        <div className="hero-art">{hero && <HeroCircuit track={hero.track} />}</div>
      </section>

      <section className="home-section" aria-labelledby="pick-title">
        <header>
          <h2 id="pick-title">Pick a circuit</h2>
          <p>Each one comes with drivers already trained, so you can race it straight away.</p>
        </header>
        <div className="circuits">
          {presets.map(({ def: preset, track, corners }) => (
            <button
              key={preset.id}
              type="button"
              className={preset.id === def.id ? 'circuit is-open' : 'circuit'}
              onClick={() => open(preset)}
            >
              <Thumbnail track={track} />
              <span className="circuit-name">{preset.name}</span>
              <span className="circuit-facts">
                {(track.length / 1000).toFixed(2)} km · {corners} corners
              </span>
              <span className="circuit-blurb">{CHARACTER[preset.id] ?? ''}</span>
              <span className="circuit-tag">{preset.id === def.id ? 'Open now' : 'Drivers included'}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="steps-title">
        <header>
          <h2 id="steps-title">Five steps, each feeding the next</h2>
          <p>
            Ticks show what is done for <strong>{def.name}</strong>, the circuit open now.
          </p>
        </header>
        <ol className="home-steps">
          {steps.map((step, i) => (
            <li key={step.id}>
              <button
                type="button"
                className={['home-step', step.done ? 'is-done' : '', step.id === next.id ? 'is-next' : ''].join(' ').trim()}
                onClick={() => navigate(step.id)}
              >
                <span className="home-step-top">
                  <span className="home-step-icon">
                    <ModuleIcon id={step.id} size={22} />
                  </span>
                  <span className="home-step-num">{step.done ? 'Done' : step.id === next.id ? 'Next' : `Step ${i + 1}`}</span>
                </span>
                <strong>{step.title}</strong>
                <span>{step.hint}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
