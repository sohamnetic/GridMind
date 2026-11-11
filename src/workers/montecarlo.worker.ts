/// <reference lib="webworker" />
import type { Strategy } from '../core/race/strategy'
import { rivalPlans, simulate, type StudySetup } from '../core/strategy/monteCarlo'
import type { MonteCarloReply, MonteCarloRequest } from './monteCarloProtocol'

/**
 * One of a pool of workers that race strategies for the optimiser. It keeps
 * the study's setup and answers each request with the raw results, handing
 * the arrays over rather than copying them.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope

let setup: StudySetup | null = null
let plans: Strategy[] = []

scope.onmessage = (e: MessageEvent<MonteCarloRequest>) => {
  const message = e.data
  if (message.type === 'setup') {
    setup = message.setup
    plans = rivalPlans(setup)
    return
  }
  if (!setup) return
  const outcomes = simulate(setup, plans, message.strategy, message.from, message.count)
  const reply: MonteCarloReply = { type: 'done', id: message.id, outcomes }
  scope.postMessage(reply, [outcomes.positions.buffer, outcomes.times.buffer, outcomes.flags.buffer, outcomes.stops.buffer])
}
