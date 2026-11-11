/**
 * Headless training run: the same Trainer the browser uses, driven from Node.
 *
 *   npm run sim:train -- [preset index | all] [generations] [population] [seed]
 *
 * Prints progress per generation and compares the learned lap with the
 * hand-written reference driver.
 */
import { createCar, DEFAULT_CAR, stepCar, type CarInput } from '../src/core/physics/car'
import { createLapTimer, formatLapTime, updateLapTimer } from '../src/core/physics/lapTimer'
import { referenceDriver } from '../src/core/physics/referenceDriver'
import { SIM_DT } from '../src/core/evolution/episode'
import { DEFAULT_TRAINER, simulateDriver, Trainer } from '../src/core/evolution/trainer'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'
import type { BuiltTrack } from '../src/core/track/types'

function referenceLap(track: BuiltTrack): number | null {
  const car = createCar(track, track.def.startFraction * track.length - 15)
  const timer = createLapTimer(track, car.s)
  const input: CarInput = { steer: 0, throttle: 0, brake: 0 }
  while (timer.laps < 2 && car.time < 600 && !car.crashed) {
    referenceDriver(car, track, DEFAULT_CAR, input, 0.9)
    stepCar(car, input, track, DEFAULT_CAR, SIM_DT)
    updateLapTimer(timer, track, car.s, car.speed, car.time)
  }
  return timer.bestLap
}

const [which = 'all', gensArg = '60', popArg = '150', seedArg = '1'] = process.argv.slice(2)
const generations = Number(gensArg)
const presets = createPresets()
const selected = which === 'all' ? presets : [presets[Number(which)]]

for (const def of selected) {
  const track = buildTrack(def)!
  const trainer = new Trainer(track, {
    ...DEFAULT_TRAINER,
    populationSize: Number(popArg),
    seed: Number(seedArg),
  })
  const started = performance.now()
  let simTime = 0
  let firstLapGen = 0
  console.log(`\n${def.name} — ${(track.length / 1000).toFixed(2)} km, reference ${formatLapTime(referenceLap(track))}`)

  for (let g = 0; g < generations; g++) {
    const s = trainer.runGeneration()
    simTime += s.simTime
    if (!firstLapGen && s.recordLap !== null) firstLapGen = s.generation
    if (s.generation % 10 === 0 || s.generation === 1 || s.newRecord) {
      console.log(
        `  gen ${String(s.generation).padStart(3)}  progress ${(s.bestProgress * 100).toFixed(0).padStart(4)}%` +
          `  fit ${s.bestFitness.toFixed(0).padStart(7)} / ${s.meanFitness.toFixed(0).padStart(6)}` +
          `  laps ${String(s.finishers).padStart(3)}  crash ${String(s.crashed).padStart(3)}` +
          `  limit ${s.timeLimit.toFixed(0).padStart(3)}s  sigma ${s.sigma.toFixed(2)}` +
          `  lap ${formatLapTime(s.bestLap)}  record ${formatLapTime(s.recordLap)}${s.newRecord ? ' *' : ''}`,
      )
    }
  }

  const wall = (performance.now() - started) / 1000
  const champion = trainer.champion()
  const check = champion ? simulateDriver(track, champion) : null
  console.log(
    `  => record ${formatLapTime(trainer.recordLap)} (first lap in gen ${firstLapGen || '–'}),` +
      ` champion re-run ${formatLapTime(check?.bestLap ?? null)},` +
      ` ${wall.toFixed(1)} s wall for ${simTime.toFixed(0)} car-episode seconds`,
  )
}
