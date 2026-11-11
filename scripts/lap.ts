/**
 * Headless lap-level race: strategy ranking, one race in detail, and
 * averages over many seeds.
 *
 *   npm run sim:lap -- [preset index] [laps] [rain chance] [seed] [races]
 */
import { createRace, runRace, stepLap, type RaceSetup } from '../src/core/race/engine'
import { DRIVERS } from '../src/core/race/grid'
import { rankStrategies, raceParams, strategyLabel } from '../src/core/race/strategy'
import { COMPOUNDS, lapsToCliff } from '../src/core/race/tyres'
import { estimateProfile } from '../src/core/profile/trackProfile'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { buildPitLane } from '../src/core/track/pit'
import { createPresets } from '../src/core/track/presets'

const [presetArg = '4', lapsArg = '50', rainArg = '0', seedArg = '1', racesArg = '300'] = process.argv.slice(2)
const def = createPresets()[Number(presetArg)]
const track = buildTrack(def)!
const profile = estimateProfile(track, analyseTrack(track), buildPitLane(track)?.length ?? 0)
const laps = Number(lapsArg)
const params = raceParams(profile, laps)
const ranked = rankStrategies(params)

console.log(
  `${def.name}: ${laps} laps, base ${profile.baseLapTime.toFixed(1)} s, pit ${(params.pitLoss + params.stationary).toFixed(1)} s,` +
    ` tyre stress ${profile.tyreStress.toFixed(2)}, overtaking ${profile.overtakingDifficulty.toFixed(2)},` +
    ` fuel ${params.fuelStart.toFixed(0)} kg; laps to cliff S ${lapsToCliff('soft', profile.tyreStress)}` +
    ` M ${lapsToCliff('medium', profile.tyreStress)} H ${lapsToCliff('hard', profile.tyreStress)}`,
)
console.log('clean-air ranking:')
for (const r of ranked.slice(0, 8)) {
  console.log(
    `  ${r.label.padEnd(9)} stops at ${r.strategy.stops.map((s) => s.lap).join(', ').padEnd(12)}` +
      ` +${(r.time - ranked[0].time).toFixed(1).padStart(5)} s`,
  )
}

const setup: RaceSetup = {
  profile,
  laps,
  seed: Number(seedArg),
  rainChance: Number(rainArg),
  cars: 20,
  plans: ranked.map((r) => r.strategy),
}

// One race in detail.
const race = createRace(setup)
while (!race.finished) stepLap(race, setup)
const count = (type: string) => race.log.filter((e) => e.type === type).length
console.log(
  `\nrace seed ${setup.seed}: overtakes ${count('overtake')}, pit stops ${count('pit')}, SC ${count('sc')}, VSC ${count('vsc')},` +
    ` retirements ${count('out')}, rain laps ${race.weather.plan.filter((r) => r > 0).length}`,
)
const leader = race.cars[race.order[0]]
for (const i of race.order.slice(0, 10)) {
  const car = race.cars[i]
  const stints = car.stints.map((s) => `${COMPOUNDS[s.compound].short}${s.to - s.from + 1}`).join(' ')
  console.log(
    `  P${String(car.position).padStart(2)} ${DRIVERS[i].code} grid ${String(car.grid).padStart(2)}  ` +
      (car.running ? `+${(car.time - leader.time).toFixed(1).padStart(6)} s` : `out lap ${car.outLap}`.padStart(9)) +
      `  ${stints}`,
  )
}

// Many races.
const races = Number(racesArg)
const started = performance.now()
let overtakes = 0
let stops = 0
let sc = 0
let out = 0
let wetRaces = 0
const winners = new Map<string, number>()
const winnerGrid: number[] = []
for (let k = 0; k < races; k++) {
  const r = runRace({ ...setup, seed: 1000 + k, record: true })
  overtakes += r.log.filter((e) => e.type === 'overtake').length
  stops += r.log.filter((e) => e.type === 'pit').length
  sc += r.log.filter((e) => e.type === 'sc' || e.type === 'vsc').length
  out += r.log.filter((e) => e.type === 'out').length
  if (r.weather.plan.some((x) => x > 0)) wetRaces++
  const w = r.cars[r.order[0]]
  const label = w.stints.map((s) => COMPOUNDS[s.compound].short).join('-')
  winners.set(label, (winners.get(label) ?? 0) + 1)
  winnerGrid.push(w.grid)
}
const wall = performance.now() - started
console.log(
  `\n${races} races in ${wall.toFixed(0)} ms (${(wall / races).toFixed(2)} ms each): per race overtakes ${(overtakes / races).toFixed(1)},` +
    ` stops per car ${(stops / races / 20).toFixed(2)}, safety cars ${(sc / races).toFixed(2)}, retirements ${(out / races).toFixed(2)},` +
    ` wet races ${wetRaces}, winner from pole ${(winnerGrid.filter((g) => g === 1).length / races * 100).toFixed(0)} %,` +
    ` mean winner grid ${(winnerGrid.reduce((a, b) => a + b, 0) / races).toFixed(1)}`,
)
console.log(
  'winning strategies: ' +
    [...winners.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
)
void strategyLabel
