import type { CallReview, EngineRun } from '../core/pitwall/debrief'
import type { CallValue } from '../core/pitwall/rollout'
import type { LapOrders } from '../core/pitwall/session'
import type { CarOrder, RaceSetup } from '../core/race/engine'
import type { DriveMode } from '../core/race/tyres'

/**
 * Messages to a pit-wall worker. A race is rebuilt inside the worker from
 * its setup and the orders given so far, so nothing heavy crosses over.
 *
 * `orders` belong to the car being advised or judged, the first of the
 * setup's manual cars; `others` are the orders of the player's other cars,
 * lap by lap.
 */
export type PitWallRequest =
  /** What is each call for the coming lap worth? */
  | {
      type: 'advise'
      id: number
      setup: RaceSetup
      orders: CarOrder[]
      others: LapOrders[]
      /** What the other cars are told for the coming lap. */
      coming: LapOrders
      mode: DriveMode
      samples: number
    }
  /** Review the calls made on these laps. */
  | { type: 'review'; id: number; setup: RaceSetup; orders: CarOrder[]; others: LapOrders[]; laps: number[]; samples: number }
  /** Run the same race with the strategy engine making every call. */
  | { type: 'engine'; id: number; setup: RaceSetup; others: LapOrders[]; samples: number }

export type PitWallReply =
  | { type: 'advice'; id: number; lap: number; values: CallValue[]; best: string }
  /** One more lap reviewed or raced. */
  | { type: 'progress'; id: number }
  | { type: 'reviews'; id: number; reviews: CallReview[] }
  | { type: 'engine'; id: number; run: EngineRun }
