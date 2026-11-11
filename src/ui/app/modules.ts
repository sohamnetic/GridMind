/** The five pipeline modules from the project definition, in data-flow order. */
export type ModuleId = 'studio' | 'evolution' | 'race' | 'optimiser' | 'pitwall'

export interface ModuleInfo {
  id: ModuleId
  /** Position in the pipeline, shown in the nav. */
  step: number
  name: string
  role: string
  output: string
  /** Build phase (from the development plan) that delivers this module. */
  phase: number
}

export const MODULES: readonly ModuleInfo[] = [
  {
    id: 'studio',
    step: 1,
    name: 'Track Studio',
    role: 'Draw and edit the circuit; define pit lane, DRS zones and sectors.',
    output: 'Track geometry file',
    phase: 1,
  },
  {
    id: 'evolution',
    step: 2,
    name: 'Driver Evolution',
    role: 'Train AI drivers on the circuit with a genetic algorithm.',
    output: 'Trained driver networks, best lap time, racing line',
    phase: 2,
  },
  {
    id: 'race',
    step: 3,
    name: 'Race Engine',
    role: 'Simulate a full race with multiple cars, tyres, fuel and incidents.',
    output: 'Lap-by-lap race state',
    phase: 3,
  },
  {
    id: 'optimiser',
    step: 4,
    name: 'Strategy Optimiser',
    role: 'Run thousands of races to evaluate candidate strategies.',
    output: 'Ranked strategies with win and podium probabilities',
    phase: 5,
  },
  {
    id: 'pitwall',
    step: 5,
    name: 'Live Pit Wall',
    role: 'Play strategist during a race, then review every call in the debrief.',
    output: 'Race result and decision analysis',
    phase: 6,
  },
]

export const DEFAULT_MODULE: ModuleId = 'studio'

export function isModuleId(value: string): value is ModuleId {
  return MODULES.some((m) => m.id === value)
}
