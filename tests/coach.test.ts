import { describe, expect, it } from 'vitest'
import { coachTip, type CoachState } from '../src/ui/app/coachTips'
import type { FlowStatus } from '../src/ui/app/flow'

const none: FlowStatus = { drivable: false, drivers: false, raced: false, studied: false, debriefed: false }
const all: FlowStatus = { drivable: true, drivers: true, raced: true, studied: true, debriefed: true }

function state(overrides: Partial<CoachState> = {}): CoachState {
  return {
    route: 'studio',
    status: none,
    trackName: 'Test Ring',
    points: 12,
    training: { running: false, generation: 0, recordLap: null },
    bundledDrivers: false,
    bestLap: null,
    optimiserRunning: false,
    pitwall: { phase: 'setup', playing: false, lap: 0, deciding: false, retired: false, debriefDone: false },
    ...overrides,
  }
}

describe('coach', () => {
  it('numbers the screens one to five', () => {
    const routes = ['studio', 'evolution', 'race', 'optimiser', 'pitwall'] as const
    expect(routes.map((route) => coachTip(state({ route })).step)).toEqual([1, 2, 3, 4, 5])
  })

  it('always has something to say, and never an empty instruction', () => {
    for (const route of ['studio', 'evolution', 'race', 'optimiser', 'pitwall'] as const) {
      for (const status of [none, { ...none, drivable: true }, all]) {
        const tip = coachTip(state({ route, status }))
        expect(tip.title.length).toBeGreaterThan(3)
        expect(tip.text.length).toBeGreaterThan(20)
      }
    }
  })

  it('sends a blank page to the presets and a broken circuit to the analysis', () => {
    const blank = coachTip(state({ points: 0 }))
    expect(blank.target).toBe('presets')
    expect(blank.text).toMatch(/preset/i)
    expect(blank.done).toBe(false)
    expect(coachTip(state({ points: 9 })).text).toMatch(/Analysis/)
  })

  it('names the circuit once it is ready and offers the next step that is not done', () => {
    const fresh = coachTip(state({ status: { ...none, drivable: true } }))
    expect(fresh.title).toBe('Test Ring is ready')
    expect(fresh.done).toBe(true)
    expect(fresh.next).toEqual({ label: 'Next: train drivers', to: 'evolution' })
    // A preset already has drivers: the next thing is a race.
    const preset = coachTip(state({ status: { ...none, drivable: true, drivers: true } }))
    expect(preset.next?.to).toBe('race')
  })

  it('follows a training run from the first press to the first lap', () => {
    const drivable = { ...none, drivable: true }
    const start = coachTip(state({ route: 'evolution', status: drivable }))
    expect(start.target).toBe('start-training')
    expect(start.next).toBeUndefined()

    const learning = coachTip(
      state({ route: 'evolution', status: drivable, training: { running: true, generation: 7, recordLap: null } }),
    )
    expect(learning.title).toMatch(/generation 7/)
    expect(learning.done).toBe(false)

    const lapped = coachTip(
      state({
        route: 'evolution',
        status: { ...drivable, drivers: true },
        training: { running: true, generation: 31, recordLap: 72.345 },
      }),
    )
    expect(lapped.title).toMatch(/1:12\.345/)
    expect(lapped.next?.to).toBe('race')
  })

  it('says a preset comes with drivers and shows their lap', () => {
    const tip = coachTip(
      state({ route: 'evolution', status: { ...none, drivable: true, drivers: true }, bundledDrivers: true, bestLap: 22.683 }),
    )
    expect(tip.title).toMatch(/comes with trained drivers/)
    expect(tip.text).toMatch(/22\.683/)
    expect(tip.target).toBe('continue-training')
  })

  it('will not train on a broken circuit', () => {
    const tip = coachTip(state({ route: 'evolution' }))
    expect(tip.target).toBeUndefined()
    expect(tip.next?.to).toBe('studio')
  })

  it('points at the button that starts each of the later screens', () => {
    const ready = { ...none, drivable: true, drivers: true }
    expect(coachTip(state({ route: 'race', status: ready })).target).toBe('run-race')
    expect(coachTip(state({ route: 'optimiser', status: ready })).target).toBe('run-optimiser')
    expect(coachTip(state({ route: 'pitwall', status: ready })).target).toBe('go-grid')
    expect(coachTip(state({ route: 'race', status: { ...ready, raced: true } })).next?.to).toBe('optimiser')
    expect(coachTip(state({ route: 'optimiser', status: { ...ready, raced: true, studied: true } })).next?.to).toBe('pitwall')
    expect(coachTip(state({ route: 'optimiser', status: ready, optimiserRunning: true })).target).toBeUndefined()
  })

  it('talks a race through from the grid to the debrief', () => {
    const pit = (pitwall: Partial<CoachState['pitwall']>) =>
      coachTip(state({ route: 'pitwall', status: all, pitwall: { ...state().pitwall, phase: 'race', ...pitwall } }))
    expect(pit({}).target).toBe('lights-out')
    expect(pit({}).title).toBe('On the grid')
    expect(pit({ lap: 6 }).title).toBe('Clock stopped')
    expect(pit({ playing: true, lap: 6 }).target).toBe('pit-call')
    expect(pit({ playing: true, lap: 6 }).title).toMatch(/lap 7/)
    expect(pit({ deciding: true, lap: 6 }).target).toBe('decision')
    expect(pit({ retired: true, lap: 6 }).title).toMatch(/retired/i)
    expect(pit({ phase: 'finished' }).done).toBe(false)
    const debrief = pit({ phase: 'finished', debriefDone: true })
    expect(debrief.done).toBe(true)
    expect(debrief.target).toBe('new-race')
  })
})
