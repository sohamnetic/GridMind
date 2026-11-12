/**
 * Headless championship: plays whole seasons with a fixed, simple-minded
 * player and prints how they went. For checking the balance of the season
 * rules: how far a team can climb, what practice and risk are worth.
 *
 *   npm run sim:season -- [team] [rounds] [sprint|full] [seed] [seasons] [risk] [quali blocks]
 */
import { existsSync, readFileSync } from 'node:fs'
import { decodeFloats, isDriverFile } from '../src/core/evolution/driverFile'
import { DRIVERS, TEAMS } from '../src/core/race/grid'
import { rankStrategies } from '../src/core/race/strategy'
import { circuitSpec } from '../src/core/season/circuits'
import { finishPractice, playerParams } from '../src/core/season/practice'
import { gridPosition, playerRunning, qualify } from '../src/core/season/qualifying'
import {
  AREAS,
  buyUpgrade,
  canBuy,
  createSeason,
  currentRound,
  driverRank,
  nextRound,
  paceOrder,
  recordRace,
  simulateRace,
  standings,
  teamRank,
  type Distance,
} from '../src/core/season/season'
import type { CircuitSpec, Risk } from '../src/core/season/types'
import { createPresets } from '../src/core/track/presets'

const [
  teamArg = '4',
  roundsArg = '10',
  distanceArg = 'sprint',
  seedArg = '1',
  seasonsArg = '1',
  riskArg = 'push',
  qualiArg = '2',
] = process.argv.slice(2)
const team = Number(teamArg)
const rounds = Number(roundsArg)
const distance = distanceArg as Distance
const seasons = Number(seasonsArg)
const risk = riskArg as Risk
const qualiBlocks = Number(qualiArg)

const circuits: CircuitSpec[] = createPresets().flatMap((def) => {
  const path = `public/drivers/${def.id}.json`
  const file: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  const lap =
    isDriverFile(file) && file.ghost && file.recordLap !== null
      ? { ghost: decodeFloats(file.ghost), recordLap: file.recordLap }
      : null
  const spec = circuitSpec(def, lap)
  return spec ? [spec] : []
})

const verbose = seasons === 1
let driverRanks = 0
let teamRanks = 0
let points = 0
let gridSum = 0
let finishSum = 0
let races = 0

for (let s = 0; s < seasons; s++) {
  let season = createSeason({
    seed: Number(seedArg) + s,
    team,
    seat: 0,
    circuits,
    rounds,
    distance,
  })
  if (verbose) {
    console.log(`${TEAMS[team].name}, ${DRIVERS[season.driver].name}: ${rounds} rounds, ${distance}`)
    console.log(
      `Pace order at the start: ${paceOrder(season)
        .map((t) => TEAMS[t].id)
        .join(' ')}`,
    )
  }
  while (season.stage !== 'finished') {
    const round = currentRound(season)
    season = finishPractice(season, {
      quali: qualiBlocks,
      race: 5 - qualiBlocks,
      pit: 1,
    })
    while (season.stage === 'qualifying') {
      const running = season.qualifying ? playerRunning(season, season.qualifying) : true
      season = qualify(season, running ? [risk === 'limit' ? 'push' : risk, risk] : undefined)
    }
    const grid = gridPosition(season.qualifying!, season.driver)
    const strategy = rankStrategies(playerParams(season))[0].strategy
    const race = simulateRace(season, strategy)
    season = recordRace(season, race, true)
    const result = season.results[season.results.length - 1]
    const me = race.cars[season.driver]
    gridSum += grid
    finishSum += me.position
    races++
    // Spend: aerodynamics first, then whatever else can be afforded.
    for (const area of AREAS) while (canBuy(season, area.id)) season = buyUpgrade(season, area.id)
    if (verbose) {
      const table = standings(season)
      console.log(
        `R${String(season.round + 1).padStart(2)} ${round.name.padEnd(16)} ${String(round.laps).padStart(2)} laps ` +
          `${String(round.temperature).padStart(2)}°C rain ${round.rainChance.toFixed(2)}${season.qualifying!.wet ? ' (wet quali)' : ''}` +
          `  grid P${String(grid).padStart(2)} -> ${me.running ? `P${String(me.position).padStart(2)}` : 'DNF'}` +
          `  +${result.points[season.driver]} pts  income ${result.income}  budget ${season.budget}` +
          `  levels ${AREAS.map((a) => season.levels[a.id]).join('/')}` +
          `  championship P${driverRank(table, season.driver)}, team P${teamRank(table, team)}` +
          `  winner ${DRIVERS[result.order[0]].code}`,
      )
    }
    season = nextRound(season)
  }
  const table = standings(season)
  driverRanks += driverRank(table, season.driver)
  teamRanks += teamRank(table, team)
  points += table.drivers.find((d) => d.driver === season.driver)?.points ?? 0
  if (verbose) {
    console.log('\nDrivers')
    table.drivers.slice(0, 10).forEach((d, i) => {
      console.log(
        `  ${String(i + 1).padStart(2)} ${DRIVERS[d.driver].name.padEnd(14)} ${String(d.points).padStart(4)}  wins ${d.wins}`,
      )
    })
    console.log('Teams')
    table.teams.forEach((t, i) =>
      console.log(`  ${String(i + 1).padStart(2)} ${TEAMS[t.team].name.padEnd(18)} ${String(t.points).padStart(4)}`),
    )
    console.log(
      `Pace order at the end: ${paceOrder(season)
        .map((t) => TEAMS[t].id)
        .join(' ')}`,
    )
  }
}

console.log(
  `\n${seasons} season${seasons === 1 ? '' : 's'} as ${TEAMS[team].name} (risk ${risk}, ${qualiBlocks} qualifying blocks): ` +
    `driver P${(driverRanks / seasons).toFixed(1)}, team P${(teamRanks / seasons).toFixed(1)}, ` +
    `${(points / seasons).toFixed(0)} points, average grid ${(gridSum / races).toFixed(1)}, average finish ${(finishSum / races).toFixed(1)}`,
)
