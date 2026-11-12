/**
 * Trains drivers for the preset circuits and writes them to public/drivers,
 * so a preset can be raced and its racing line seen without training first.
 *
 *   npm run sim:pretrain -- [preset index | all] [generations] [population] [seed] [kept]
 *
 * `kept` is how many drivers go in the file: the record holder, then the
 * quickest of the final population. The files are served as static assets and fetched
 * only when a preset is opened that has no drivers saved in the browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { encodeFloats, type DriverFile } from '../src/core/evolution/driverFile'
import { DEFAULT_TRAINER, DRIVER_LAYOUT, simulateDriver, Trainer, type GenerationStats } from '../src/core/evolution/trainer'
import { formatLapTime } from '../src/core/physics/lapTimer'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'
import { trackKey } from '../src/core/track/serialize'

const [which = 'all', gensArg = '70', popArg = '120', seedArg = '1', keptArg = '60'] = process.argv.slice(2)
const generations = Number(gensArg)
const populationSize = Number(popArg)
const seed = Number(seedArg)
const kept = Math.min(Number(keptArg), populationSize)
const presets = createPresets()
const selected = which === 'all' ? presets : [presets[Number(which)]]
const weights = DRIVER_LAYOUT.weightCount

mkdirSync('public/drivers', { recursive: true })

for (const def of selected) {
  const track = buildTrack(def)!
  const trainer = new Trainer(track, { ...DEFAULT_TRAINER, populationSize, seed })
  const started = performance.now()
  const history: GenerationStats[] = []
  for (let g = 0; g < generations; g++) history.push(trainer.runGeneration())

  const champion = trainer.champion()
  if (!champion || trainer.recordLap === null) {
    console.log(`${def.name}: no driver completed a lap in ${generations} generations; nothing written`)
    continue
  }
  const run = simulateDriver(track, champion, { laps: DEFAULT_TRAINER.lapsPerEpisode, record: true })

  // Every driver of the final population runs a lap alone: the quickest first,
  // then those that did not get round, by how far they got.
  const solo: { genome: Float32Array; lap: number; progress: number }[] = []
  for (let i = 0; i < populationSize; i++) {
    const genome = trainer.population.subarray(i * weights, (i + 1) * weights)
    const result = simulateDriver(track, genome, { laps: 1 })
    solo.push({ genome, lap: result.bestLap ?? Infinity, progress: result.progress })
  }
  solo.sort((x, y) => x.lap - y.lap || y.progress - x.progress)
  const able = [champion, ...solo.filter((d) => Number.isFinite(d.lap)).map((d) => d.genome)]
  const rest = solo.filter((d) => !Number.isFinite(d.lap)).map((d) => d.genome)

  // The file leads with a full grid of drivers that can all get round, so a
  // race can be run at once. On a hard circuit few of the population can:
  // the grid is then made up with repeats of those that do. The rest of the
  // file is the best of the others, which keeps variety for further training.
  const GRID = 24
  const lappers = able.length
  const population = new Float32Array(kept * weights)
  let next = 0
  for (let k = 0; k < kept; k++) {
    let genome: Float32Array
    if (k < able.length) genome = able[k]
    else if (k < GRID) genome = able[k % able.length]
    else genome = rest[next++] ?? able[k % able.length]
    population.set(genome, k * weights)
  }

  const file: DriverFile = {
    version: 1,
    trackId: def.id,
    trackKey: trackKey(def),
    layout: [...DRIVER_LAYOUT.sizes],
    populationSize: kept,
    seed,
    generation: trainer.generation,
    recordLap: trainer.recordLap,
    timeLimit: trainer.timeLimit,
    population: encodeFloats(population),
    recordGenome: encodeFloats(champion),
    ghost: encodeFloats(run.bestLapPath),
    history,
  }
  const json = JSON.stringify(file)
  writeFileSync(`public/drivers/${def.id}.json`, json)
  console.log(
    `${def.name}: record ${formatLapTime(trainer.recordLap)}, champion re-run ${formatLapTime(run.bestLap)},` +
      ` ${Math.min(lappers, kept)} of the ${kept} kept drivers complete a lap alone (${lappers} of ${populationSize + 1} could), ${(json.length / 1024).toFixed(0)} kB,` +
      ` ${((performance.now() - started) / 1000).toFixed(0)} s`,
  )
}
