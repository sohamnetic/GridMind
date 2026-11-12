import { flowSteps, nextStep, type FlowStatus } from './flow'
import type { ModuleId } from './modules'

/**
 * The coach: one short instruction for whatever screen is open, worked out
 * from what has been done so far. Where the instruction is "press this", it
 * names the control, so the screen can point at it.
 */

/** Controls the coach can point at. Each is marked `data-coach="<id>"` where it is drawn. */
export type CoachTarget =
  | 'presets'
  | 'start-training'
  | 'continue-training'
  | 'run-race'
  | 'run-optimiser'
  | 'go-grid'
  | 'lights-out'
  | 'decision'
  | 'pit-call'
  | 'new-race'

export interface CoachState {
  route: ModuleId
  status: FlowStatus
  trackName: string
  /** Control points on the circuit: fewer than three is a blank page. */
  points: number
  training: { running: boolean; generation: number; recordLap: number | null }
  /** The drivers came with a preset rather than from training here. */
  bundledDrivers: boolean
  bestLap: number | null
  optimiserRunning: boolean
  pitwall: {
    phase: 'setup' | 'race' | 'finished'
    playing: boolean
    lap: number
    deciding: boolean
    retired: boolean
    debriefDone: boolean
  }
}

export interface CoachTip {
  /** 1 to 5: where this screen sits in the five steps. */
  step: number
  title: string
  text: string
  /** The control to press now, if there is one. */
  target?: CoachTarget
  /** Where to go next, once this screen's job is done. */
  next?: { label: string; to: ModuleId }
  /** The screen's job is done. */
  done: boolean
}

function lapText(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = (seconds - minutes * 60).toFixed(3)
  return minutes > 0 ? `${minutes}:${rest.padStart(6, '0')}` : rest
}

/** The step after this one that still needs doing, as a button. */
function onward(state: CoachState): CoachTip['next'] {
  const step = nextStep(state.status)
  if (step.id === state.route) {
    // Everything up to here is done: carry on down the line.
    const steps = flowSteps(state.status)
    const after = steps[steps.findIndex((s) => s.id === state.route) + 1]
    return after ? { label: `Next: ${after.title.toLowerCase()}`, to: after.id } : undefined
  }
  return { label: `Next: ${step.title.toLowerCase()}`, to: step.id }
}

export function coachTip(state: CoachState): CoachTip {
  const { status } = state
  switch (state.route) {
    case 'studio': {
      if (!status.drivable) {
        return {
          step: 1,
          title: 'Make a circuit you can race',
          text:
            state.points < 3
              ? 'Pick one of the preset circuits in the Library on the right, or choose Draw on the left and sketch a closed loop.'
              : 'This circuit cannot be raced yet. The Analysis panel on the right says what is wrong; fix that, or pick a preset from the Library.',
          target: 'presets',
          done: false,
        }
      }
      return {
        step: 1,
        title: `${state.trackName} is ready`,
        text: 'Drag the points to reshape it, or press Test drive and try it yourself with the arrow keys. When you are happy, move on.',
        next: onward(state),
        done: true,
      }
    }

    case 'evolution': {
      const { running, generation, recordLap } = state.training
      if (running && recordLap === null) {
        return {
          step: 2,
          title: `Drivers are learning: generation ${generation}`,
          text: 'Nobody has finished a lap yet. That usually takes 10 to 40 generations; the Turbo speed gets there quickest.',
          done: false,
        }
      }
      if (running && recordLap !== null) {
        return {
          step: 2,
          title: `Best lap ${lapText(recordLap)}, generation ${generation}`,
          text: 'They can lap it now. Let them run until the lap time stops falling, then pause. Their progress is saved as they go.',
          next: onward(state),
          done: true,
        }
      }
      if (status.drivers) {
        return {
          step: 2,
          title: state.bundledDrivers ? 'This circuit comes with trained drivers' : 'Your drivers are trained',
          text:
            (state.bestLap !== null ? `Their best lap is ${lapText(state.bestLap)}. ` : '') +
            'Press Continue to watch them train further, or go straight on to a race.',
          target: 'continue-training',
          next: onward(state),
          done: true,
        }
      }
      return {
        step: 2,
        title: 'Teach AI drivers this circuit',
        text: status.drivable
          ? 'Press Start training. A crowd of drivers tries the circuit, the best ones breed, and each generation gets a little further.'
          : 'The circuit has problems, so nobody can be trained on it yet. Fix it in the Track Studio first.',
        target: status.drivable ? 'start-training' : undefined,
        next: status.drivable ? undefined : { label: 'Back to the Track Studio', to: 'studio' },
        done: false,
      }
    }

    case 'race': {
      if (!status.raced) {
        return {
          step: 3,
          title: 'Run a full race',
          text: 'Press Run race. Twenty cars go the whole distance with tyre wear, pit stops, safety cars and weather, in about a millisecond.',
          target: 'run-race',
          done: false,
        }
      }
      return {
        step: 3,
        title: 'Race run',
        text: 'Drag the Lap slider to replay it and click a driver to follow them. Next seed runs the same race with different luck.',
        next: onward(state),
        done: true,
      }
    }

    case 'optimiser': {
      if (state.optimiserRunning) {
        return {
          step: 4,
          title: 'Racing every plan',
          text: 'Each sensible pit strategy is being raced hundreds of times against the same grids, weather and safety cars.',
          done: false,
        }
      }
      if (!status.studied) {
        return {
          step: 4,
          title: 'Find the best strategy for your car',
          text: 'Choose your car on the right, then press Find the best strategy. It takes a few seconds.',
          target: 'run-optimiser',
          done: false,
        }
      }
      return {
        step: 4,
        title: 'Strategies ranked',
        text: 'The top row is the plan to start with. Click any row to see how it fares, then try to do better yourself on the pit wall.',
        next: onward(state),
        done: true,
      }
    }

    case 'pitwall': {
      const { phase, playing, lap, deciding, retired, debriefDone } = state.pitwall
      if (phase === 'setup') {
        return {
          step: 5,
          title: 'Take a seat on the pit wall',
          text: 'Choose your car and press Go to the grid. If you ran the optimiser for the same car and distance, its top plan is offered as your starting plan.',
          target: 'go-grid',
          done: false,
        }
      }
      if (phase === 'finished') {
        return {
          step: 5,
          title: debriefDone ? 'Debrief ready' : 'Replaying your calls',
          text: debriefDone
            ? 'Every call is rated against the strategy engine. The costly ones are where the places went. Press New race to try again.'
            : 'The strategy engine is playing the race out from every lap, once for each option you had.',
          target: debriefDone ? 'new-race' : undefined,
          done: debriefDone,
        }
      }
      if (retired) {
        return { step: 5, title: 'Car retired', text: 'Bad luck. The race runs on to the flag without you.', done: false }
      }
      if (deciding) {
        return {
          step: 5,
          title: 'Your call',
          text: 'Choose Box or Stay out on the banner. Not sure? Press Ask the engineer in the panel on the right before you decide.',
          target: 'decision',
          done: false,
        }
      }
      if (!playing) {
        return {
          step: 5,
          title: lap === 0 ? 'On the grid' : 'Clock stopped',
          text:
            lap === 0
              ? 'Press Lights out. The clock stops by itself whenever there is a decision to make.'
              : 'Press Resume to carry on, or Next lap to move one lap at a time.',
          target: 'lights-out',
          done: false,
        }
      }
      return {
        step: 5,
        title: `Racing: lap ${lap + 1}`,
        text: 'To stop for tyres, pick a compound under Pit call: the car comes in at the end of the lap. Watch tyre wear and the weather radar.',
        target: 'pit-call',
        done: false,
      }
    }
  }
}
