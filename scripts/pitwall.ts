/**
 * Headless Live Pit Wall: plays a race with a simple-minded strategist who
 * follows the pre-race plan whatever happens, prints the team radio, then
 * runs the debrief and the strategy engine's own run of the same race.
 *
 *   npm run sim:pitwall -- [preset index] [laps] [rain chance] [driver] [seed] [samples]
 */
import { enginePlay, reviewableLaps, reviewLaps } from '../src/core/pitwall/debrief'
import { radioFor } from '../src/core/pitwall/radio'
import { decisionPoints, pulseOf, sessionSetup, workingPlan } from '../src/core/pitwall/session'
import { estimateProfile } from '../src/core/profile/trackProfile'
import { cloneRace, createRace, stepLap, type CarOrder } from '../src/core/race/engine'
import { DRIVERS } from '../src/core/race/grid'
import { raceParams, rankStrategies } from '../src/core/race/strategy'
import { COMPOUNDS } from '../src/core/race/tyres'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { buildPitLane } from '../src/core/track/pit'
import { createPresets } from '../src/core/track/presets'

const [presetArg = '4', lapsArg = '50', rainArg = '0.3', driverArg = '8', seedArg = '1', samplesArg = '60'] =
  process.argv.slice(2)
const def = createPresets()[Number(presetArg)]
const track = buildTrack(def)!
const profile = estimateProfile(track, analyseTrack(track), buildPitLane(track)?.length ?? 0)
const laps = Number(lapsArg)
const driver = Number(driverArg)
const params = raceParams(profile, laps)
const strategy = rankStrategies(params)[0].strategy
const setup = sessionSetup({ profile, laps, seed: Number(seedArg), rainChance: Number(rainArg), driver, strategy })

console.log(
  `${def.name}: ${laps} laps, rain ${rainArg}, ${DRIVERS[driver].code}; plan ${strategy.start} then ` +
    strategy.stops.map((s) => `${s.compound} at lap ${s.lap}`).join(', '),
)

// --- The race, following the plan blindly ---
const race = createRace(setup)
const orders: CarOrder[] = []
let pulse = pulseOf(race, driver, null)
let windowWasOpen = false
while (!race.finished) {
  const lapNo = race.lap + 1
  const me = race.cars[driver]
  const plan = workingPlan(race, driver, params)
  for (const d of me.running ? decisionPoints(pulse, race, driver, params, plan) : []) {
    console.log(`  [pause before lap ${lapNo}] ${d.text}`)
  }
  const stop = strategy.stops.find((s) => s.lap === lapNo)
  const order: CarOrder = stop ? { pit: stop.compound } : {}
  orders.push(order)
  pulse = pulseOf(race, driver, plan)
  const before = cloneRace(race)
  stepLap(race, setup, { [driver]: order })
  const after = workingPlan(race, driver, params)
  for (const m of radioFor(before, race, driver, params, after, windowWasOpen)) {
    console.log(`  L${String(m.lap).padStart(2)} ${m.voice.padEnd(8)} ${m.text}`)
  }
  windowWasOpen = after?.window != null && race.lap + 1 >= after.window.from && race.lap + 1 <= after.window.to
}
const me = race.cars[driver]
const stints = (list: typeof me.stints) => list.map((s) => `${COMPOUNDS[s.compound].short}${s.to - s.from + 1}`).join(' ')
console.log(`\nresult: P${me.position} from grid ${me.grid}, ${me.running ? `${me.time.toFixed(1)} s` : 'retired'}, ${stints(me.stints)}`)

// --- Debrief ---
const samples = Number(samplesArg)
let started = performance.now()
const reviews = reviewLaps(setup, orders, reviewableLaps(laps), samples)
const reviewMs = performance.now() - started
const total = reviews.reduce((sum, r) => sum + r.loss, 0)
console.log(`\ndebrief: ${reviews.length} calls reviewed in ${(reviewMs / 1000).toFixed(1)} s; places lost to calls ${total.toFixed(1)}`)
for (const r of reviews.filter((x) => x.verdict !== 'good' || x.chosen !== 'stay' || x.reasons.length > 0)) {
  console.log(
    `  lap ${String(r.lap).padStart(2)} P${String(r.position).padEnd(2)} ${r.chosen.padEnd(10)} engine ${r.best.padEnd(10)}` +
      ` cost ${r.loss.toFixed(1).padStart(4)} places ${r.seconds.toFixed(1).padStart(6)} s  ${r.verdict.padEnd(6)} ${r.reasons.join(',')}${r.safetyCar !== 'none' ? ` [${r.safetyCar}]` : ''}` +
      `${r.wetness > 0.05 ? ` wet ${r.wetness.toFixed(2)}` : ''}`,
  )
}

started = performance.now()
const engine = enginePlay(setup, samples)
console.log(
  `\nengine, same race: P${engine.position}, ${engine.retired ? 'retired' : `${engine.time.toFixed(1)} s`},` +
    ` ${stints(engine.stints)}; ${((performance.now() - started) / 1000).toFixed(1)} s`,
)
