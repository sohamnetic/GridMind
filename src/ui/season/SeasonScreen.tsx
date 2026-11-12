import { useEffect, useMemo } from 'react'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import { driverRank, standings, teamRank } from '../../core/season/season'
import { useSeasonStore } from '../../state/seasonStore'
import type { Route } from '../app/useHashRoute'
import { money, ordinal } from './format'
import { Calendar, Development, RoundResults, SeasonFinal, StandingsCard } from './SeasonPanels'
import { SeasonSetup } from './SeasonSetup'
import { PracticeCard, QualifyingCard, RaceCard, WeekendHeader } from './Weekend'
import '../home/home.css'
import './season.css'

interface Props {
  navigate: (route: Route) => void
}

/** The championship: a career of race weekends for one team. */
export function SeasonScreen({ navigate }: Props) {
  const season = useSeasonStore((s) => s.season)
  const loaded = useSeasonStore((s) => s.loaded)
  const hydrate = useSeasonStore((s) => s.hydrate)
  const next = useSeasonStore((s) => s.next)
  const abandon = useSeasonStore((s) => s.abandon)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const table = useMemo(() => (season ? standings(season) : null), [season])

  if (!loaded) {
    return (
      <div className="season">
        <p className="season-note">Looking for a saved season…</p>
      </div>
    )
  }
  if (!season || !table) return <SeasonSetup />

  const team = TEAMS[season.team]
  const raced = season.results.length
  const lastResult = season.results[raced - 1]
  const lastRound = season.round + 1 >= season.rounds.length
  const upcoming = season.rounds[season.round + 1]

  const end = () => {
    const sure =
      season.stage === 'finished' ||
      window.confirm('End this season? The career and its results are deleted, and cannot be brought back.')
    if (sure) abandon()
  }

  return (
    <div className="season">
      <header className="season-head" style={{ '--team': team.color } as React.CSSProperties}>
        <div className="season-who">
          <p className="season-eyebrow">Championship · season {season.seed}</p>
          <h1>{team.name}</h1>
          <p>
            {DRIVERS[season.driver].name}, car {DRIVERS[season.driver].number}
          </p>
        </div>
        <dl className="season-stats">
          <div>
            <dt>Drivers’ table</dt>
            <dd>{raced > 0 ? ordinal(driverRank(table, season.driver)) : '–'}</dd>
          </div>
          <div>
            <dt>Teams’ table</dt>
            <dd>{raced > 0 ? ordinal(teamRank(table, season.team)) : '–'}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>{table.drivers.find((r) => r.driver === season.driver)?.points ?? 0}</dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd>{money(season.budget)}</dd>
          </div>
        </dl>
      </header>

      <Calendar season={season} />

      <div className="season-body">
        <div className="season-main">
          {season.stage === 'finished' ? (
            <>
              <SeasonFinal season={season} table={table} />
              <div className="stage-actions">
                <button type="button" className="cta" data-coach="season-next" onClick={end}>
                  Start a new season
                </button>
              </div>
            </>
          ) : season.stage === 'results' && lastResult ? (
            <>
              <RoundResults season={season} result={lastResult} />
              <div className="stage-actions">
                <button type="button" className="cta" data-coach="season-next" onClick={next}>
                  {lastRound ? 'See the final standings' : `Next round: ${upcoming?.name ?? ''}`}{' '}
                  <span aria-hidden="true">→</span>
                </button>
                <span className="season-note">
                  Spend the prize money under Development before you move on, or save it.
                </span>
              </div>
            </>
          ) : (
            <>
              <WeekendHeader season={season} />
              <PracticeCard season={season} />
              <QualifyingCard season={season} />
              <RaceCard season={season} navigate={navigate} />
            </>
          )}
        </div>

        <aside className="season-side" aria-label="Development and championship tables">
          {season.stage !== 'finished' && <Development season={season} />}
          <StandingsCard season={season} table={table} />
          {season.stage !== 'finished' && (
            <button type="button" className="season-end" onClick={end}>
              End this season
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}
