/**
 * Headless strategy optimiser: ranks strategies for one car and checks that
 * a second, independent study agrees.
 *
 *   npm run sim:optimise -- [preset index] [laps] [rain chance] [driver] [final runs] [seed]
 */
import { DRIVERS } from '../src/core/race/grid'
import { estimateProfile } from '../src/core/profile/trackProfile'
import { localEvaluate, optimise, type OptimiserResult } from '../src/core/strategy/optimiser'
import type { StudySetup } from '../src/core/strategy/monteCarlo'
import { spearman } from '../src/core/strategy/stats'
import { analyseTrack } from '../src/core/track/analysis'
import { buildTrack } from '../src/core/track/build'
import { buildPitLane } from '../src/core/track/pit'
import { createPresets } from '../src/core/track/presets'

const [presetArg = '4', lapsArg = '50', rainArg = '0.2', driverArg = '8', runsArg = '600', seedArg = '1'] =
  process.argv.slice(2)
const def = createPresets()[Number(presetArg)]
const track = buildTrack(def)!
const profile = estimateProfile(track, analyseTrack(track), buildPitLane(track)?.length ?? 0)

async function study(seed: number): Promise<{ result: OptimiserResult; ms: number }> {
  const setup: StudySetup = {
    profile,
    laps: Number(lapsArg),
    rainChance: Number(rainArg),
    cars: 20,
    driver: Number(driverArg),
    seed,
  }
  const started = performance.now()
  const result = await optimise(setup, { finalRuns: Number(runsArg) }, localEvaluate(setup))
  return { result, ms: performance.now() - started }
}

const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)} %`

function print(result: OptimiserResult): void {
  const best = result.ranked[0].stats
  for (const { candidate, stats } of result.ranked) {
    console.log(
      `  ${candidate.label.padEnd(8)} stops ${candidate.strategy.stops.map((s) => s.lap).join(', ').padEnd(11)}` +
        ` pos ${stats.meanPosition.toFixed(2).padStart(5)}  win ${pct(stats.win)}  podium ${pct(stats.podium)}` +
        `  points ${pct(stats.points)}  P${stats.p10}-P${stats.p90}  time +${(stats.meanTime - best.meanTime).toFixed(1).padStart(5)} s` +
        `  SC ${stats.safety.meanPosition.toFixed(1)} / none ${stats.green.meanPosition.toFixed(1)}` +
        `  rain ${stats.rain.runs > 0 ? stats.rain.meanPosition.toFixed(1) : '–'} / dry ${stats.dry.meanPosition.toFixed(1)}`,
    )
  }
}

const a = await study(Number(seedArg))
const { result } = a
console.log(
  `${def.name}: ${lapsArg} laps, rain ${rainArg}, car ${DRIVERS[Number(driverArg)].code};` +
    ` ${result.candidates} candidates x ${result.coarseRuns} races, ${result.ranked.length} finalists x ${result.finalRuns};` +
    ` ${result.races} races in ${(a.ms / 1000).toFixed(1)} s (${(a.ms / result.races).toFixed(2)} ms each)`,
)
print(result)

console.log('\none-stop window (average position by stop lap):')
console.log(`        ${result.oneStop.laps.map((l) => String(l).padStart(5)).join('')}`)
result.oneStop.rows.forEach((row, r) => {
  console.log(
    `  ${row.padEnd(6)}${result.oneStop.cells[r].map((c) => (c ? c.meanPosition.toFixed(1) : '–').padStart(5)).join('')}`,
  )
})
if (result.twoStop) {
  console.log(`\ntwo-stop window for ${result.twoStop.label} (rows: second stop, columns: first stop):`)
  console.log(`        ${result.twoStop.laps.map((l) => String(l).padStart(5)).join('')}`)
  result.twoStop.rows.forEach((row, r) => {
    console.log(
      `  ${row.padEnd(6)}${result.twoStop!.cells[r].map((c) => (c ? c.meanPosition.toFixed(1) : '').padStart(5)).join('')}`,
    )
  })
}

// A second study on different races should put the same plans at the top.
const b = await study(Number(seedArg) + 7777)
const keys = result.ranked.map((r) => r.candidate.key)
const other = new Map(b.result.ranked.map((r) => [r.candidate.key, r.stats.meanPosition]))
const shared = keys.filter((k) => other.has(k))
console.log(
  `\nsecond study: top three ${b.result.ranked
    .slice(0, 3)
    .map((r) => r.candidate.key)
    .join(', ')} (first: ${keys.slice(0, 3).join(', ')});` +
    ` ${shared.length} finalists in common, rank correlation ${spearman(
      shared.map((k) => result.ranked.find((r) => r.candidate.key === k)!.stats.meanPosition),
      shared.map((k) => other.get(k)!),
    ).toFixed(2)}`,
)
