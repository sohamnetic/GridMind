import type { RaceState } from '../race/engine'
import { DRIVERS } from '../race/grid'
import type { RaceParams } from '../race/strategy'
import { bestForConditions, CLIFF_WEAR, COMPOUNDS, type Compound } from '../race/tyres'
import type { Plan } from './replan'
import { FADING_WEAR, pitCost } from './session'

/**
 * Team radio: short messages put together from what changed on the lap just
 * run. Every line comes from a template filled in from the race state, so the
 * same race always produces the same radio.
 */

export type RadioVoice = 'engineer' | 'driver' | 'control'

export interface RadioMessage {
  lap: number
  voice: RadioVoice
  text: string
  tone: 'info' | 'good' | 'warn'
  /** The car the message is about, when the pit wall runs more than one. */
  car?: number
}

/** Most messages for one lap: the rest are dropped, least important first. */
const MAX_PER_LAP = 4

const code = (driver: number) => DRIVERS[driver].code
const kindOf = (compound: Compound) => (COMPOUNDS[compound].dry ? 'dry' : compound === 'inter' ? 'inter' : 'wet')
const KIND_WORDS = { dry: 'slicks', inter: 'intermediates', wet: 'full wets' } as const

/**
 * Messages for the lap that took the race from `before` to `after`.
 *
 * @param plan the best plan from `after`, for the pit window
 * @param windowWasOpen whether the lap just run was already inside the window
 */
export function radioFor(
  before: RaceState,
  after: RaceState,
  driver: number,
  params: RaceParams,
  plan: Plan | null,
  windowWasOpen: boolean,
): RadioMessage[] {
  const lap = after.lap
  const me = after.cars[driver]
  const was = before.cars[driver]
  const out: RadioMessage[] = []
  const say = (voice: RadioVoice, tone: RadioMessage['tone'], text: string) => out.push({ lap, voice, tone, text })
  const pick = (options: readonly string[], salt = 0) => options[(lap * 7 + salt) % options.length]
  if (!was.running) return out

  if (!me.running) {
    say('engineer', 'warn', 'Stop the car, stop the car. Sorry, that is our race.')
    return out
  }

  const mine = after.log.filter((e) => e.lap === lap)
  const pit = mine.find((e) => e.type === 'pit' && e.car === driver)

  if (after.finished) {
    const gain = me.grid - me.position
    const verdict =
      me.position === 1
        ? 'We have won it!'
        : me.position <= 3
          ? 'That is a podium.'
          : gain > 0
            ? `Up ${gain} from the grid.`
            : gain < 0
              ? `Down ${-gain} from the grid.`
              : 'Where we started.'
    say('engineer', me.position <= 3 || gain > 0 ? 'good' : 'info', `Chequered flag. P${me.position}. ${verdict}`)
    if (me.penalty > 0) say('control', 'warn', `${code(driver)}: ${me.penalty} s penalty, only one dry compound used.`)
    return out
  }

  // --- Race control ---
  if (after.safetyCar !== 'none' && before.safetyCar === 'none') {
    say('control', 'warn', after.safetyCar === 'sc' ? 'Safety car deployed.' : 'Virtual safety car deployed.')
    const now = pitCost(after, params)
    const full = params.pitLoss + params.stationary
    say('engineer', 'info', `A stop costs about ${now.toFixed(0)} s now, ${full.toFixed(0)} under green.`)
  } else if (after.safetyCar === 'none' && before.safetyCar !== 'none') {
    say('control', 'good', before.safetyCar === 'sc' ? 'Safety car in this lap. Green flag.' : 'Virtual safety car ending. Green flag.')
  }

  // --- Our own stop ---
  if (pit) {
    const slow = mine.find((e) => e.type === 'slowstop' && e.car === driver)
    const label = COMPOUNDS[pit.compound ?? me.compound].label
    const tyres = label.toLowerCase()
    const queued = mine.find((e) => e.type === 'stack' && e.car === driver)
    if (queued) {
      say('engineer', 'warn', `Held ${(queued.value ?? 0).toFixed(1)} s behind the other car in the box. ${label} tyres on, P${me.position}.`)
    } else if (slow) {
      say('engineer', 'warn', `Slow stop, sorry: ${(slow.value ?? 0).toFixed(1)} s in the box. ${label} tyres on, P${me.position}.`)
    } else say('engineer', 'good', pick([`Good stop. ${label} tyres on, you are P${me.position}.`, `Clean stop. P${me.position} on the ${tyres} tyre.`]))
  }

  // --- Weather ---
  const { plan: sky, rain, wetness } = after.weather
  if (rain > 0 && before.weather.rain === 0) {
    say('engineer', 'warn', pick(['Rain starting to fall.', 'Drops of rain on the pit wall now.']))
  } else if (rain === 0 && before.weather.rain > 0) {
    say('engineer', 'info', 'Rain has stopped. The track will dry from here.')
  } else if (rain === 0 && (sky[lap + 3] ?? 0) > 0 && !(sky[lap] ?? 0) && !(sky[lap + 1] ?? 0) && !(sky[lap + 2] ?? 0)) {
    say('engineer', 'info', 'Radar shows rain in about four laps.')
  }
  const wanted = bestForConditions(wetness)
  if (wanted !== bestForConditions(before.weather.wetness) && !pit) {
    if (wanted === kindOf(me.compound)) say('engineer', 'good', 'Conditions are coming to us. These are the right tyres.')
    else say('engineer', 'warn', `Track is ready for ${KIND_WORDS[wanted]}.`)
  }

  // --- Tyres ---
  if (!pit) {
    const dead = CLIFF_WEAR + 0.05
    if (me.wear >= dead && was.wear < dead) {
      say('driver', 'warn', pick(['These tyres are finished!', 'I have no grip left. Tyres are gone.']))
    } else if (me.wear >= FADING_WEAR && was.wear < FADING_WEAR) {
      say('driver', 'info', pick(['Tyres are starting to go.', 'Rears are starting to slide.']))
    }
  }
  const inWindow = plan?.window != null && lap + 1 >= plan.window.from && lap + 1 <= plan.window.to
  if (plan?.window && inWindow && !windowWasOpen && !pit) {
    const tyres = COMPOUNDS[plan.stops[0].compound].label.toLowerCase()
    say(
      'engineer',
      'info',
      plan.window.to > lap + 1
        ? `We are in the pit window. Plan is ${tyres} tyres, any lap up to ${plan.window.to}.`
        : `Pit window: this lap, for ${tyres} tyres.`,
    )
  }
  if (lap === Math.round(after.totalLaps * 0.6)) {
    const dry = new Set(me.used.filter((c) => COMPOUNDS[c].dry))
    if (dry.size < 2 && dry.size === me.used.length) {
      say('engineer', 'warn', 'Reminder: we still have to run a second dry compound.')
    }
  }

  // --- The race around us ---
  if (lap === 1) {
    const gain = me.grid - me.position
    say(
      'engineer',
      gain > 0 ? 'good' : 'info',
      gain > 0
        ? `Good start. Up ${gain}, P${me.position}.`
        : gain < 0
          ? `Lost ${-gain} off the line. P${me.position}, head down.`
          : `Clean start. Holding P${me.position}.`,
    )
  } else if (!pit && after.safetyCar === 'none') {
    const made = mine.find((e) => e.type === 'overtake' && e.car === driver)
    const lost = mine.find((e) => e.type === 'overtake' && e.other === driver)
    if (made && made.other !== undefined && me.position < was.position) {
      say('engineer', 'good', pick([`Good move on ${code(made.other)}. P${me.position}.`, `Nicely done. ${code(made.other)} behind you, P${me.position}.`]))
    } else if (me.position - was.position > 1) {
      say('engineer', 'warn', `Lost ${me.position - was.position} places on that lap. P${me.position}.`)
    } else if (lost && lost.car !== undefined && me.position > was.position) {
      say('engineer', 'info', `${code(lost.car)} is through. P${me.position}.`)
    }
  }

  const place = before.order.indexOf(driver)
  const ahead = place > 0 ? before.order[place - 1] : -1
  const behind = place >= 0 && place + 1 < before.order.length ? before.order[place + 1] : -1
  for (const e of mine) {
    if (e.type !== 'pit' || e.car === driver) continue
    if (e.car === ahead) say('engineer', 'info', `${code(ahead)} ahead has pitted.`)
    else if (e.car === behind && before.cars[behind].running) say('engineer', 'info', `${code(behind)} behind has pitted. Watch the undercut.`)
  }

  if (after.fastestCar === driver && after.fastestLap < before.fastestLap && lap > 2) {
    say('engineer', 'good', 'That is the fastest lap of the race.')
  }

  if (after.safetyCar === 'none' && before.safetyCar === 'none' && !pit && lap > 1) {
    const now = after.order.indexOf(driver)
    const gapTo = (state: RaceState, other: number) => Math.abs(state.cars[other].time - state.cars[driver].time)
    const chaser = now + 1 < after.order.length ? after.order[now + 1] : -1
    const target = now > 0 ? after.order[now - 1] : -1
    if (chaser >= 0 && after.cars[chaser].running && gapTo(after, chaser) < 1 && gapTo(before, chaser) >= 1) {
      say('engineer', 'warn', `${code(chaser)} is ${gapTo(after, chaser).toFixed(1)} s behind and closing.`)
    } else if (target >= 0 && gapTo(after, target) < 1 && gapTo(before, target) >= 1) {
      say('engineer', 'info', `${code(target)} is ${gapTo(after, target).toFixed(1)} s up the road.`)
    }
  }

  if (lap === after.totalLaps - 1) say('engineer', 'info', 'Last lap. Bring it home.')

  return out.slice(0, MAX_PER_LAP)
}
