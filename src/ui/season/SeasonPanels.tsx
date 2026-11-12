import { DRIVERS, TEAMS } from '../../core/race/grid'
import {
  AREAS,
  canBuy,
  driverRank,
  MAX_LEVEL,
  paceOrder,
  teamMate,
  teamRank,
  upgradeCost,
  type Standings,
} from '../../core/season/season'
import type { RoundResult, Season } from '../../core/season/types'
import { useSeasonStore } from '../../state/seasonStore'
import { money, ordinal } from './format'

function TeamBar({ team }: { team: number }) {
  return <span className="team-bar" style={{ background: TEAMS[team].color }} aria-hidden="true" />
}

/** Where a driver finished a round: "P4", or "DNF". */
function placeOf(result: RoundResult, driver: number): string {
  if (result.retired.includes(driver)) return 'DNF'
  return `P${result.order.indexOf(driver) + 1}`
}

// ---------- Calendar ----------

export function Calendar({ season }: { season: Season }) {
  return (
    <ol className="calendar" aria-label="Season calendar">
      {season.rounds.map((round, i) => {
        const result = season.results[i]
        const current = i === season.round && season.stage !== 'finished'
        return (
          <li
            key={i}
            className={['calendar-round', result ? 'is-done' : '', current ? 'is-current' : ''].join(' ').trim()}
            aria-current={current ? 'step' : undefined}
          >
            <span className="calendar-number">R{i + 1}</span>
            <span className="calendar-name">{round.name}</span>
            <span className="calendar-result">
              {result ? placeOf(result, season.driver) : current ? 'This weekend' : `${round.laps} laps`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ---------- Development ----------

export function Development({ season }: { season: Season }) {
  const buy = useSeasonStore((s) => s.buy)
  const order = paceOrder(season)
  const place = order.indexOf(season.team) + 1
  return (
    <section className="season-card side-card" aria-labelledby="dev-title">
      <h2 id="dev-title">Development</h2>
      <p className="budget">
        <span>Budget</span>
        <strong>{money(season.budget)}</strong>
      </p>
      <p className="season-note">
        Your car is the <strong>{ordinal(place)} quickest</strong> of ten. The other teams find a little pace every
        round too.
      </p>
      <ul className="areas">
        {AREAS.map((area) => {
          const level = season.levels[area.id]
          const maxed = level >= MAX_LEVEL
          return (
            <li key={area.id} className="area">
              <div className="area-head">
                <strong>{area.label}</strong>
                <span className="pips" role="img" aria-label={`Level ${level} of ${MAX_LEVEL}`}>
                  {Array.from({ length: MAX_LEVEL }, (_, i) => (
                    <i key={i} className={i < level ? 'is-on' : undefined} />
                  ))}
                </span>
              </div>
              <p>{area.effect}</p>
              <button type="button" disabled={!canBuy(season, area.id)} onClick={() => buy(area.id)}>
                {maxed ? 'Fully developed' : `Buy level ${level + 1} · ${money(upgradeCost(level))}`}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------- Standings ----------

export function StandingsCard({ season, table }: { season: Season; table: Standings }) {
  const mate = teamMate(season)
  const top = table.drivers.slice(0, 10)
  // The player's two cars are always in view, even outside the top ten.
  const extra = table.drivers.filter((row, i) => i >= 10 && (row.driver === season.driver || row.driver === mate))
  return (
    <section className="season-card side-card" aria-labelledby="standings-title">
      <h2 id="standings-title">Championship</h2>
      <h3>Drivers</h3>
      <table className="season-table standings">
        <tbody>
          {[...top, ...extra].map((row) => {
            const d = DRIVERS[row.driver]
            return (
              <tr
                key={row.driver}
                className={row.driver === season.driver ? 'is-me' : row.driver === mate ? 'is-mate' : undefined}
              >
                <td className="num">{driverRank(table, row.driver)}</td>
                <th scope="row">
                  <TeamBar team={d.team} />
                  {d.name}
                </th>
                <td className="num">{row.wins > 0 ? `${row.wins} win${row.wins === 1 ? '' : 's'}` : ''}</td>
                <td className="num points">{row.points}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <h3>Teams</h3>
      <table className="season-table standings">
        <tbody>
          {table.teams.map((row, i) => (
            <tr key={row.team} className={row.team === season.team ? 'is-me' : undefined}>
              <td className="num">{i + 1}</td>
              <th scope="row">
                <TeamBar team={row.team} />
                {TEAMS[row.team].name}
              </th>
              <td className="num points">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ---------- A round's result ----------

export function RoundResults({ season, result }: { season: Season; result: RoundResult }) {
  const me = season.driver
  const mate = teamMate(season)
  const round = season.rounds[season.results.indexOf(result)]
  const grid = (driver: number) => result.grid.indexOf(driver) + 1
  const finish = result.order.indexOf(me) + 1
  const retired = result.retired.includes(me)
  const moved = grid(me) - finish
  const headline = retired ? `${DRIVERS[me].name} did not finish` : `${DRIVERS[me].name} finished ${ordinal(finish)}`
  return (
    <section className="season-card stage-card is-open">
      <p className="season-eyebrow">{round?.name}: race result</p>
      <h2 className="result-headline">{headline}</h2>
      <p className="season-note">
        {retired
          ? `Started ${ordinal(grid(me))}.`
          : `Started ${ordinal(grid(me))}: ${moved > 0 ? `${moved} place${moved === 1 ? '' : 's'} gained` : moved < 0 ? `${-moved} place${moved === -1 ? '' : 's'} lost` : 'held position'}.`}{' '}
        {DRIVERS[mate].name} in the other car: {placeOf(result, mate)}. The team scored{' '}
        <strong>{(result.points[me] ?? 0) + (result.points[mate] ?? 0)} points</strong> and earned{' '}
        <strong>{money(result.income)}</strong> in prize money.
        {result.simulated ? ' The engineer ran this race.' : ''}
      </p>
      <div className="season-scroll">
        <table className="season-table result-table">
          <thead>
            <tr>
              <th scope="col" className="num">
                Pos
              </th>
              <th scope="col">Driver</th>
              <th scope="col">Team</th>
              <th scope="col" className="num">
                Grid
              </th>
              <th scope="col" className="num">
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {result.order.map((driver, i) => {
              const d = DRIVERS[driver]
              const out = result.retired.includes(driver)
              return (
                <tr key={driver} className={driver === me ? 'is-me' : driver === mate ? 'is-mate' : undefined}>
                  <td className="num">{out ? 'DNF' : i + 1}</td>
                  <th scope="row">
                    <TeamBar team={d.team} />
                    {d.name}
                    {result.fastest === driver && <small> fastest lap</small>}
                  </th>
                  <td>{TEAMS[d.team].name}</td>
                  <td className="num">{grid(driver)}</td>
                  <td className="num points">{result.points[driver] || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------- The end of the season ----------

export function SeasonFinal({ season, table }: { season: Season; table: Standings }) {
  const champion = table.drivers[0]
  const topTeam = table.teams[0]
  const mine = driverRank(table, season.driver)
  const team = teamRank(table, season.team)
  const row = table.drivers.find((r) => r.driver === season.driver)
  const title =
    mine === 1
      ? `${DRIVERS[season.driver].name} is champion`
      : `${DRIVERS[season.driver].name} finished ${ordinal(mine)} in the championship`
  return (
    <section className="season-card stage-card is-open season-final">
      <p className="season-eyebrow">Season over</p>
      <h2 className="result-headline">{title}</h2>
      <p className="season-note">
        {row
          ? `${row.points} points, ${row.wins} win${row.wins === 1 ? '' : 's'}, ${row.podiums} podium${row.podiums === 1 ? '' : 's'}. `
          : ''}
        {TEAMS[season.team].name} finished <strong>{ordinal(team)}</strong> of ten teams, having started the season with
        the {ordinal(season.team + 1)} quickest car.
      </p>
      <dl className="fact-row">
        <div>
          <dt>Drivers’ champion</dt>
          <dd>
            {DRIVERS[champion.driver].name}, {champion.points} points
          </dd>
        </div>
        <div>
          <dt>Teams’ champion</dt>
          <dd>
            {TEAMS[topTeam.team].name}, {topTeam.points} points
          </dd>
        </div>
      </dl>
      <h3>Your season, round by round</h3>
      <ol className="round-list">
        {season.results.map((result, i) => (
          <li key={i}>
            <span>R{i + 1}</span>
            <span>{season.rounds[i].name}</span>
            <span>
              from P{result.grid.indexOf(season.driver) + 1} to {placeOf(result, season.driver)}
            </span>
            <strong>{result.points[season.driver] || 0} pts</strong>
          </li>
        ))}
      </ol>
    </section>
  )
}
