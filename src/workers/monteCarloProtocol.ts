import type { Strategy } from '../core/race/strategy'
import type { Outcomes, StudySetup } from '../core/strategy/monteCarlo'

/** Messages from the page to a Monte Carlo worker. */
export type MonteCarloRequest =
  | { type: 'setup'; setup: StudySetup }
  /** Race `strategy` `count` times, starting at race number `from`. */
  | { type: 'run'; id: number; strategy: Strategy; from: number; count: number }

/** Messages from a Monte Carlo worker to the page. */
export interface MonteCarloReply {
  type: 'done'
  id: number
  outcomes: Outcomes
}
