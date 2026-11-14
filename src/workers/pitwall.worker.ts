/// <reference lib="webworker" />
import { deriveSeed } from '../core/math/rng'
import { enginePlay, reviewLaps } from '../core/pitwall/debrief'
import { callOptions, chooseCall, evaluateCall } from '../core/pitwall/rollout'
import { playerOf, replay } from '../core/pitwall/session'
import type { PitWallReply, PitWallRequest } from './pitwallProtocol'

/**
 * Worker for the pit wall's heavy thinking: the engineer's advice during a
 * race, and the debrief afterwards. Each is thousands of races played out
 * from a snapshot, which would freeze the page if run there.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope

const post = (reply: PitWallReply) => scope.postMessage(reply)

scope.onmessage = (e: MessageEvent<PitWallRequest>) => {
  const message = e.data
  const { id, setup } = message
  if (message.type === 'advise') {
    const driver = playerOf(setup)
    const race = replay(setup, message.orders, message.others)
    const values = evaluateCall(
      race,
      setup,
      driver,
      message.mode,
      callOptions(race, driver),
      message.samples,
      deriveSeed(setup.seed ^ 0xad71ce, race.lap),
      message.coming,
    )
    post({ type: 'advice', id, lap: race.lap + 1, values, best: chooseCall(values).id })
  } else if (message.type === 'review') {
    const reviews = reviewLaps(
      setup,
      message.orders,
      message.laps,
      message.samples,
      () => post({ type: 'progress', id }),
      message.others,
    )
    post({ type: 'reviews', id, reviews })
  } else {
    const run = enginePlay(setup, message.samples, () => post({ type: 'progress', id }), message.others)
    post({ type: 'engine', id, run })
  }
}
