import type { RaceEvent } from '../core/evolution/raceSim'
import type { TrafficStats } from '../core/evolution/trafficTrainer'
import type { GridOrder } from '../core/race/grid'
import type { TrackDef } from '../core/track/types'
import type { TrainingSpeed } from './trainingProtocol'

/** Trained race drivers, as stored and resumed. */
export interface TrafficSnapshot {
  population: Float32Array
  /** The last completed generation, best first. */
  ranked: Float32Array
  generation: number
}

export type RaceRequest =
  | {
      type: 'train'
      def: TrackDef
      /** Solo-trained networks (driver layout), best first. */
      solo: Float32Array
      seed: number
      resume?: TrafficSnapshot
    }
  | {
      type: 'race'
      def: TrackDef
      /** Race-layout networks, best first. */
      drivers: Float32Array
      cars: number
      laps: number
      grid: GridOrder
      seed: number
    }
  | { type: 'run'; speed: TrainingSpeed }
  | { type: 'pause' }
  | { type: 'frames'; enabled: boolean }
  | { type: 'snapshot' }

/** One line of the timing tower. */
export interface TimingRow {
  /** Driver index (into DRIVERS). */
  car: number
  laps: number
  /** Seconds behind the leader, or null for the leader and for lapped or retired cars. */
  gap: number | null
  /** Whole laps behind the leader. */
  lapsDown: number
  status: number
  lastLap: number | null
  bestLap: number | null
  overtakes: number
  grid: number
  drs: boolean
}

export interface RaceTiming {
  time: number
  /** Lap the leader is on (1-based), capped at the race distance. */
  lap: number
  totalLaps: number
  /** Running order, leader first. */
  rows: TimingRow[]
  /** Events since the previous timing message. */
  events: RaceEvent[]
  finished: boolean
  /** Totals so far. */
  overtakes: number
  contacts: number
  fastestLap: number | null
  fastestCar: number
}

export type RaceMessage =
  | { type: 'ready'; mode: 'train' | 'race' }
  | {
      type: 'frame'
      mode: 'train' | 'race'
      generation: number
      time: number
      running: number
      leader: number
      /** x, y, heading, status per car. */
      cars: Float32Array
    }
  | { type: 'generation'; stats: TrafficStats }
  | { type: 'snapshot'; snapshot: TrafficSnapshot }
  | { type: 'timing'; timing: RaceTiming }
  | { type: 'error'; message: string }
