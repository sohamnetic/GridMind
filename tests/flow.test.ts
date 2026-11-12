import { describe, expect, it } from 'vitest'
import { flowSteps, nextStep, type FlowStatus } from '../src/ui/app/flow'

const none: FlowStatus = { drivable: false, drivers: false, raced: false, studied: false, debriefed: false }

describe('guided flow', () => {
  it('lists the five modules in order', () => {
    expect(flowSteps(none).map((s) => s.id)).toEqual(['studio', 'evolution', 'race', 'optimiser', 'pitwall'])
    expect(flowSteps(none).every((s) => !s.done)).toBe(true)
  })

  it('points at the first step not yet done', () => {
    expect(nextStep(none).id).toBe('studio')
    expect(nextStep({ ...none, drivable: true }).id).toBe('evolution')
    expect(nextStep({ ...none, drivable: true, drivers: true }).id).toBe('race')
    expect(nextStep({ ...none, drivable: true, drivers: true, raced: true }).id).toBe('optimiser')
    expect(nextStep({ ...none, drivable: true, drivers: true, raced: true, studied: true }).id).toBe('pitwall')
    expect(nextStep({ drivable: true, drivers: true, raced: true, studied: true, debriefed: true }).id).toBe('pitwall')
  })

  it('skips a step done out of order, and goes back to the studio for a broken circuit', () => {
    expect(nextStep({ ...none, drivable: true, drivers: true, studied: true }).id).toBe('race')
    expect(nextStep({ drivable: false, drivers: true, raced: true, studied: true, debriefed: true }).id).toBe('studio')
  })
})
