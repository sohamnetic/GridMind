import { createRng, deriveSeed, nextFloat, nextGaussian } from '../math/rng'
import { COMPOUNDS, REFERENCE_LAP } from '../race/tyres'
import { currentRound, qualifyingPaces, roundProfile } from './season'
import type { QualiNote, QualiSegment, QualiTime, Qualifying, Risk, Season } from './types'

/**
 * Qualifying: three knockout parts. All twenty cars run in the first and
 * the slowest five drop out; fifteen run in the second and five more go;
 * the last ten fight for pole. Every car gets two runs in each part.
 *
 * The player decides how hard the driver goes on each run. Going to the
 * limit is quicker when it works, and ruins the lap, or the car, more often.
 */

export interface RiskInfo {
  id: Risk
  label: string
  /** Lap-time fraction against a normal push lap: negative is quicker. */
  pace: number
  /** Chance the lap goes wrong. */
  mistake: number
  /** Share of those mistakes that end in the barriers. */
  crash: number
}

export const RISKS: Record<Risk, RiskInfo> = {
  safe: {
    id: 'safe',
    label: 'Banker lap',
    pace: 0.0018,
    mistake: 0.03,
    crash: 0,
  },
  push: { id: 'push', label: 'Push', pace: 0, mistake: 0.09, crash: 0.1 },
  limit: {
    id: 'limit',
    label: 'On the limit',
    pace: -0.0016,
    mistake: 0.22,
    crash: 0.25,
  },
}

/** The other cars push, and get it wrong a little less often than a player who always pushes would. */
const RIVAL: RiskInfo = {
  id: 'push',
  label: 'Push',
  pace: 0,
  mistake: 0.07,
  crash: 0.1,
}

/** Cars that go through from each part. */
export const THROUGH = [15, 10, 0] as const
export const QUALI_PARTS = THROUGH.length

/** Lap-time fraction the track gains with every run as rubber goes down. */
const EVOLUTION = 0.0005
/** Lap-to-lap variation of a clean lap, as a fraction of the lap. */
const SPREAD = 0.0011
const WET_LAP = 1.13
const WET_SPREAD = 1.8
const WET_MISTAKES = 1.7

/** Starts the session: nobody has run yet. Whether it is wet is drawn from the round's chance of rain. */
export function startQualifying(season: Season): Qualifying {
  const round = currentRound(season)
  const wet = nextFloat(createRng(deriveSeed(round.seed, 301))) < round.rainChance * 0.6
  return {
    wet,
    segments: [],
    remaining: qualifyingPaces(season).map((_, i) => i),
    settled: [],
    crashed: [],
    grid: null,
  }
}

/** Whether the player still has a lap to drive: in the session, and with a car in one piece. */
export function playerRunning(season: Season, quali: Qualifying): boolean {
  return quali.grid === null && quali.remaining.includes(season.driver) && !quali.crashed.includes(season.driver)
}

/** Chance of a ruined lap at each level of risk in this session's conditions. */
export function mistakeChance(risk: Risk, wet: boolean): number {
  return Math.min(0.9, RISKS[risk].mistake * (wet ? WET_MISTAKES : 1))
}

/**
 * Runs the next part of qualifying.
 *
 * @param risks the player's instructions for the two runs; ignored if the player's car is not running
 */
export function runSegment(season: Season, quali: Qualifying, risks: [Risk, Risk] = ['push', 'push']): Qualifying {
  if (quali.grid !== null) return quali
  const part = quali.segments.length
  const round = currentRound(season)
  const profile = roundProfile(round)
  const paces = qualifyingPaces(season)
  const base = profile.baseLapTime * (quali.wet ? WET_LAP : 1)
  const tyre = quali.wet ? 0 : (profile.baseLapTime / REFERENCE_LAP) * COMPOUNDS.soft.pace
  const spread = base * SPREAD * (quali.wet ? WET_SPREAD : 1)
  const playing = playerRunning(season, quali)
  const crashed = quali.crashed.slice()

  const times: QualiTime[] = quali.remaining.map((driver) => {
    // Each car has its own luck for the part, drawn in a fixed order, so one car's choices never change another's lap.
    const rng = createRng(deriveSeed(deriveSeed(round.seed, 310 + part), driver))
    const runs: [number, number] = [Infinity, Infinity]
    const notes: [QualiNote, QualiNote] = ['none', 'none']
    let inBarrier = crashed.includes(driver)
    for (let r = 0; r < 2; r++) {
      const noise = nextGaussian(rng, 0, spread)
      const mistakeRoll = nextFloat(rng)
      const crashRoll = nextFloat(rng)
      const lost = nextFloat(rng)
      if (inBarrier) continue
      const info = driver === season.driver && playing ? RISKS[risks[r]] : RIVAL
      const mistake = mistakeRoll < Math.min(0.9, info.mistake * (quali.wet ? WET_MISTAKES : 1))
      if (mistake && crashRoll < info.crash) {
        notes[r] = 'crash'
        inBarrier = true
        crashed.push(driver)
        continue
      }
      const grip = EVOLUTION * (part * 2 + r)
      let lap = base * (1 + paces[driver] + info.pace - grip) + tyre + noise
      if (mistake) lap += base * (0.012 + 0.02 * lost)
      runs[r] = lap
      notes[r] = mistake ? 'mistake' : 'clean'
    }
    return { driver, runs, best: Math.min(runs[0], runs[1]), notes }
  })
  times.sort((a, b) => a.best - b.best || a.driver - b.driver)

  const through = times.slice(0, THROUGH[part]).map((t) => t.driver)
  const out = times.slice(THROUGH[part]).map((t) => t.driver)
  const segment: QualiSegment = {
    number: part + 1,
    times,
    through,
    risks: playing ? [risks[0], risks[1]] : null,
  }
  const settled = [...out, ...quali.settled]
  const last = part + 1 >= QUALI_PARTS
  return {
    wet: quali.wet,
    segments: [...quali.segments, segment],
    remaining: through,
    settled: last ? [] : settled,
    crashed,
    grid: last ? settled : null,
  }
}

/** Runs whatever is left of the session without the player: used once the player's car is out. */
export function completeQualifying(season: Season, quali: Qualifying): Qualifying {
  let q = quali
  while (q.grid === null) q = runSegment(season, q)
  return q
}

/** Grid position of a driver (1 = pole), or 0 if the grid is not settled for that car yet. */
export function gridPosition(quali: Qualifying, driver: number): number {
  if (quali.grid) return quali.grid.indexOf(driver) + 1
  const index = quali.settled.indexOf(driver)
  return index < 0 ? 0 : quali.remaining.length + index + 1
}

/** Enters a part of qualifying in the season; after the last part the weekend moves on to the race. */
export function qualify(season: Season, risks?: [Risk, Risk]): Season {
  if (season.stage !== 'qualifying') return season
  const before = season.qualifying ?? startQualifying(season)
  const after = runSegment(season, before, risks)
  return {
    ...season,
    qualifying: after,
    stage: after.grid ? 'race' : 'qualifying',
  }
}

/** Runs the rest of qualifying in one go. */
export function finishQualifying(season: Season): Season {
  if (season.stage !== 'qualifying') return season
  const done = completeQualifying(season, season.qualifying ?? startQualifying(season))
  return { ...season, qualifying: done, stage: 'race' }
}
