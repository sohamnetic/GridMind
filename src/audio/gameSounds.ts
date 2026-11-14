import { playerRunning } from '../core/season/qualifying'
import { usePitWallStore } from '../state/pitwallStore'
import { useSeasonStore } from '../state/seasonStore'
import { rateLimiter } from './notes'
import { sound } from './sound'

/**
 * Sounds for what happens in the game, played by watching the stores: the
 * screens themselves know nothing about sound. Importing this file is what
 * switches them on.
 */

/** At eight laps a second of real time, a beep for every radio message would be a drum roll. */
const radioGap = rateLimiter(1.1)
const clock = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0)

usePitWallStore.subscribe((state, before) => {
  if (!sound.enabled) return
  const { race } = state

  // Lights out.
  if (state.phase === 'race' && state.playing && !before.playing && race?.lap === 0) sound.lights()

  // The flag: the tune is for the car the pit wall started with.
  if (state.phase === 'finished' && before.phase !== 'finished' && race) {
    const car = race.cars[state.cars[0] ?? state.driver]
    sound.flag(car?.running ? car.position : 20)
    return
  }

  // A lap has been run.
  if (race && before.race && race.lap > before.race.lap && state.phase === 'race') {
    const lap = race.log.filter((e) => e.lap === race.lap)
    if (lap.some((e) => e.type === 'pit' && e.car !== undefined && state.cars.includes(e.car))) {
      sound.pitStop()
    } else if (race.safetyCar !== 'none' && before.race.safetyCar === 'none') {
      sound.safetyCar()
    } else if (state.decisions.length > 0 && before.decisions.length === 0) {
      sound.decision()
    } else {
      const fresh = state.radio.slice(before.radio.length)
      const loudest = fresh.find((m) => m.tone === 'warn') ?? fresh.find((m) => m.tone === 'good')
      if (loudest && radioGap(clock())) sound.radio(loudest.tone)
    }
    return
  }

  // The engineer has an answer.
  if (state.advice?.status === 'ready' && before.advice?.status === 'thinking') sound.radio('info')
})

useSeasonStore.subscribe((state, before) => {
  if (!sound.enabled) return
  const season = state.season
  const was = before.season
  if (!season || !was || season.seed !== was.seed) return

  // An upgrade bought.
  const levels = (s: typeof season) => s.levels.aero + s.levels.tyres + s.levels.pit + s.levels.reliability
  if (levels(season) > levels(was)) {
    sound.buy()
    return
  }

  // A part of qualifying run: through, or out.
  const parts = season.qualifying?.segments.length ?? 0
  const partsBefore = was.round === season.round ? (was.qualifying?.segments.length ?? 0) : 0
  if (season.qualifying && parts > partsBefore) {
    const wasRunning = was.qualifying ? playerRunning(was, was.qualifying) : true
    if (wasRunning) {
      const grid = season.qualifying.grid
      const through = grid ? grid.indexOf(season.driver) < 3 : playerRunning(season, season.qualifying)
      if (through) sound.through()
      else if (!grid || grid.indexOf(season.driver) >= 10) sound.knockedOut()
      else sound.done()
    }
    return
  }

  if (season.practice && !was.practice) sound.done()

  // A race the engineer ran: the pit wall plays the flag for the others.
  if (season.results.length > was.results.length) {
    const result = season.results[season.results.length - 1]
    if (result.simulated) {
      sound.flag(result.retired.includes(season.driver) ? 20 : result.order.indexOf(season.driver) + 1)
    }
  }
})
