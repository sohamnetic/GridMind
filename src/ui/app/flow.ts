import type { ModuleId } from './modules'

/** What has been done so far with the circuit that is open. */
export interface FlowStatus {
  /** The circuit can be driven: closed, wide enough, no errors. */
  drivable: boolean
  /** Drivers that can lap it exist: trained here, or shipped with a preset. */
  drivers: boolean
  /** A full race has been run on it. */
  raced: boolean
  /** The optimiser has ranked strategies for it. */
  studied: boolean
  /** A pit-wall race on it has reached the debrief. */
  debriefed: boolean
}

export interface FlowStep {
  id: ModuleId
  done: boolean
  /** What to do, as an instruction: "Train drivers". */
  title: string
  hint: string
}

/** The five steps from a blank page to a debrief, in order, with what is done. */
export function flowSteps(status: FlowStatus): FlowStep[] {
  return [
    {
      id: 'studio',
      done: status.drivable,
      title: 'Draw a circuit',
      hint: 'Pick a preset or draw your own, and clear any errors the analysis panel shows.',
    },
    {
      id: 'evolution',
      done: status.drivers,
      title: 'Train drivers',
      hint: 'AI drivers learn the circuit by trial and error. Preset circuits come with drivers already trained.',
    },
    {
      id: 'race',
      done: status.raced,
      title: 'Run a race',
      hint: 'Twenty cars over a full distance: tyres, pit stops, safety cars and weather, lap by lap.',
    },
    {
      id: 'optimiser',
      done: status.studied,
      title: 'Find the best strategy',
      hint: 'Thousands of simulated races rank the pit strategies for your car.',
    },
    {
      id: 'pitwall',
      done: status.debriefed,
      title: 'Run the pit wall',
      hint: 'Make the calls yourself during a race, then see how they compare in the debrief.',
    },
  ]
}

/**
 * The step to do next: the first one not done. A circuit that cannot be
 * driven sends everything back to the studio, whatever was done before it
 * was edited.
 */
export function nextStep(status: FlowStatus): FlowStep {
  const steps = flowSteps(status)
  if (!status.drivable) return steps[0]
  return steps.find((s) => !s.done) ?? steps[steps.length - 1]
}
