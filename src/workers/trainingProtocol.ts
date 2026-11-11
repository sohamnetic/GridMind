import type { GenerationStats } from '../core/evolution/trainer'
import type { TrackDef } from '../core/track/types'

/** Simulation speed: a multiple of real time, or as fast as the CPU allows. */
export type TrainingSpeed = number | 'turbo'

/** Everything needed to continue a training run later. */
export interface TrainingSnapshot {
  population: Float32Array
  generation: number
  recordLap: number | null
  recordGenome: Float32Array | null
  timeLimit: number
}

export type TrainingRequest =
  | {
      type: 'init'
      def: TrackDef
      populationSize: number
      seed: number
      resume?: TrainingSnapshot
    }
  | { type: 'run'; speed: TrainingSpeed }
  | { type: 'pause' }
  /** Turns live car frames on or off (off while nobody is watching). */
  | { type: 'frames'; enabled: boolean }
  | { type: 'snapshot' }

/** Floats per car in a frame: x, y, heading, status. */
export const FRAME_STRIDE = 4

export type TrainingEvent =
  | { type: 'ready' }
  | {
      type: 'frame'
      generation: number
      /** Simulated seconds into the current generation. */
      time: number
      running: number
      /** Index of the car that has covered the most ground. */
      leader: number
      cars: Float32Array
    }
  | {
      type: 'generation'
      stats: GenerationStats
      /** Racing line of the best driver so far (x, y, speed triplets), when it changed. */
      ghost?: Float32Array
    }
  | { type: 'snapshot'; snapshot: TrainingSnapshot }
  | { type: 'error'; message: string }
