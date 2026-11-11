/**
 * Headless racecraft run: solo training (cached), then traffic training,
 * with a benchmark race before and after.
 *
 *   npm run sim:race -- [preset index] [solo generations] [traffic generations] [seed]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { CarStatus } from '../src/core/evolution/episode'
import { RACE_LAYOUT, RaceSim } from '../src/core/evolution/raceSim'
import { DEFAULT_TRAINER, DRIVER_LAYOUT, Trainer } from '../src/core/evolution/trainer'
import {
  DEFAULT_TRAFFIC,
  handicappedCar,
  qualify,
  TrafficTrainer,
  widenPopulation,
} from '../src/core/evolution/trafficTrainer'
import { formatLapTime } from '../src/core/physics/lapTimer'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'
import type { BuiltTrack } from '../src/core/track/types'

const [presetArg = '0', soloArg = '60', trafficArg = '30', seedArg = '1'] = process.argv.slice(2)
const def = createPresets()[Number(presetArg)]
const track = buildTrack(def)!
const seed = Number(seedArg)

function soloPopulation(): Float32Array {
  const dir = 'scripts/.cache'
  const file = `${dir}/solo-${def.id}-${soloArg}-${seed}.bin`
  if (existsSync(file)) {
    const buf = readFileSync(file)
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice()
  }
  const trainer = new Trainer(track, { ...DEFAULT_TRAINER, seed })
  for (let g = 0; g < Number(soloArg); g++) trainer.runGeneration()
  console.log(`solo: ${soloArg} generations, record ${formatLapTime(trainer.recordLap)}`)
  // Champion first, then the population (its elites lead the array).
  const len = DRIVER_LAYOUT.weightCount
  const pop = trainer.population.slice()
  if (trainer.recordGenome) pop.set(trainer.recordGenome, 0)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, Buffer.from(pop.buffer))
  void len
  return pop
}

function benchmarkRace(label: string, t: BuiltTrack, ranked: Float32Array, cars = 12, laps = 4): void {
  const len = RACE_LAYOUT.weightCount
  const genomes = new Float32Array(cars * len)
  for (let i = 0; i < cars; i++) genomes.set(ranked.subarray(i * len, i * len + len), i * len)
  // Slowest car on pole so the quick ones have to come through the field.
  const params = Array.from({ length: cars }, (_, i) => handicappedCar(0.9 + (0.1 * i) / (cars - 1)))
  const race = new RaceSim(t, RACE_LAYOUT, cars)
  race.reset(genomes, params, laps, (laps * t.length) / 20 + 30, undefined, 90)
  while (!race.step()) {
    // run to the flag
  }
  let overtakes = 0
  let hits = 0
  let out = 0
  let finished = 0
  let contactTime = 0
  for (let i = 0; i < cars; i++) {
    overtakes += race.overtakes[i]
    hits += race.traffic.hits[i]
    contactTime += race.traffic.contactTime[i]
    if (race.status[i] === CarStatus.Finished) finished++
    if (race.status[i] === CarStatus.Crashed || race.status[i] === CarStatus.Stalled) out++
  }
  for (let i = 0; i < cars; i++) {
    const st = race.status[i]
    if (st === CarStatus.Crashed || st === CarStatus.Stalled || st === CarStatus.Reversed) {
      const c = race.cars[i]
      console.log(
        `    car ${i} (grid ${race.gridSlot[i] + 1}) ${['run', 'crashed', 'stalled', 'reversed'][st]} at ${c.time.toFixed(1)} s,` +
          ` ${(race.raceDist[i] / t.length).toFixed(2)} laps, hits ${race.traffic.hits[i]}, gravel ${race.gravelTime[i].toFixed(1)} s`,
      )
    }
  }
  console.log(
    `${label}: ${cars} cars x ${laps} laps -> finished ${finished}, retired ${out}, overtakes ${overtakes},` +
      ` contacts ${hits / 2} (${(contactTime / 2).toFixed(1)} s), fastest ${formatLapTime(race.fastestLap)},` +
      ` order ${Array.from(race.order).join(' ')}`,
  )
}

const solo = widenPopulation(DRIVER_LAYOUT, soloPopulation())
console.log(`${def.name}: ${solo.length / RACE_LAYOUT.weightCount} solo drivers widened to ${RACE_LAYOUT.sizes[0]} inputs`)
benchmarkRace('before', track, solo)

const trainer = new TrafficTrainer(track, solo, { ...DEFAULT_TRAFFIC, seed })
const started = performance.now()
for (let g = 0; g < Number(trafficArg); g++) {
  const s = trainer.runGeneration()
  if (s.generation % 5 === 0 || s.generation === 1) {
    console.log(
      `  gen ${String(s.generation).padStart(3)}  fit ${s.bestFitness.toFixed(0).padStart(6)} / ${s.meanFitness.toFixed(0).padStart(6)}` +
        `  overtakes ${String(s.overtakes).padStart(3)}  contacts ${String(s.contacts).padStart(4)}` +
        `  crashed ${String(s.crashed).padStart(3)}  finished ${String(s.finished).padStart(3)}/${s.entries}` +
        `  lap ${formatLapTime(s.bestLap)}  sigma ${s.sigma.toFixed(2)}`,
    )
  }
}
console.log(`traffic: ${trafficArg} generations in ${((performance.now() - started) / 1000).toFixed(1)} s`)
benchmarkRace('after (raw ranking)', track, trainer.ranked)
const q0 = performance.now()
const field = qualify(track, trainer.ranked, 12)
console.log(`qualifying: ${((performance.now() - q0) / 1000).toFixed(1)} s, retirements per driver ${field.retirements.join(' ')}`)
benchmarkRace('after (qualified)', track, field.genomes)
benchmarkRace('after (qualified, 20 cars x 6 laps)', track, qualify(track, trainer.ranked, 20).genomes, 20, 6)
