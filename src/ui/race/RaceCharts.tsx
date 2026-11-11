import { useMemo } from 'react'
import type { CarRace, RaceState } from '../../core/race/engine'
import { DRIVERS, TEAMS } from '../../core/race/grid'
import { COMPOUNDS } from '../../core/race/tyres'

const W = 1000
const PAD_L = 46
const PAD_R = 46
const PLOT_W = W - PAD_L - PAD_R

interface ChartProps {
  race: RaceState
  viewLap: number
  selected: number | null
  onSelect: (driver: number | null) => void
}

interface Period {
  type: 'sc' | 'vsc'
  /** First and last lap run under it (1-based, inclusive). */
  from: number
  to: number
}

/** Laps run behind the safety car or under the virtual one, from the race log. */
export function safetyPeriods(race: RaceState): Period[] {
  const periods: Period[] = []
  let open: Period | null = null
  for (const entry of race.log) {
    if (entry.type === 'sc' || entry.type === 'vsc') {
      open = { type: entry.type, from: entry.lap + 1, to: race.totalLaps }
      periods.push(open)
    } else if (entry.type === 'green' && open) {
      open.to = entry.lap
      open = null
    }
  }
  return periods
}

const lapX = (lap: number, total: number) => PAD_L + (lap / total) * PLOT_W
const teamColor = (driver: number) => TEAMS[DRIVERS[driver].team].color
/** The second car of each team is drawn dashed so team-mates can be told apart. */
const dashOf = (driver: number) => (driver % 2 === 1 ? '6 4' : undefined)

/** Shading for safety-car laps and rain, lap ticks, and the marker for the lap being viewed. */
function Backdrop({ race, viewLap, top, height }: { race: RaceState; viewLap: number; top: number; height: number }) {
  const total = race.totalLaps
  const periods = useMemo(() => safetyPeriods(race), [race])
  const tickEvery = total > 40 ? 10 : 5
  const ticks: number[] = []
  for (let lap = 0; lap <= total; lap += tickEvery) ticks.push(lap)
  return (
    <g>
      {race.weather.plan.map((rain, i) =>
        rain > 0 ? (
          <rect
            key={`rain-${i}`}
            x={lapX(i, total)}
            y={top}
            width={PLOT_W / total}
            height={height}
            className="chart-rain"
            opacity={0.12 + 0.3 * rain}
          />
        ) : null,
      )}
      {periods.map((p) => (
        <rect
          key={`${p.type}-${p.from}`}
          x={lapX(p.from - 1, total)}
          y={top}
          width={((p.to - p.from + 1) / total) * PLOT_W}
          height={height}
          className={p.type === 'sc' ? 'chart-sc' : 'chart-vsc'}
        />
      ))}
      {ticks.map((lap) => (
        <g key={lap}>
          <line x1={lapX(lap, total)} x2={lapX(lap, total)} y1={top} y2={top + height} className="chart-grid" />
          <text x={lapX(lap, total)} y={top + height + 14} className="chart-tick" textAnchor="middle">
            {lap}
          </text>
        </g>
      ))}
      <line x1={lapX(viewLap, total)} x2={lapX(viewLap, total)} y1={top} y2={top + height} className="chart-cursor" />
    </g>
  )
}

function lineClass(driver: number, selected: number | null): string {
  if (selected === null) return 'chart-line'
  return driver === selected ? 'chart-line is-selected' : 'chart-line is-dimmed'
}

/** Position of every car on every lap: crossing lines are changes of place. */
export function PositionChart({ race, viewLap, selected, onSelect }: ChartProps) {
  const total = race.totalLaps
  const count = race.cars.length
  const top = 12
  const row = 15
  const height = (count - 1) * row
  const y = (position: number) => top + (position - 1) * row
  const final = race.order

  return (
    <svg
      className="race-chart"
      viewBox={`0 0 ${W} ${top + height + 30}`}
      role="img"
      aria-label="Lap chart: the position of every car on every lap"
    >
      <Backdrop race={race} viewLap={viewLap} top={top - 6} height={height + 12} />
      {race.cars.map((car) => (
        <polyline
          key={car.driver}
          points={car.positions.map((p, lap) => `${lapX(lap, total).toFixed(1)},${y(p)}`).join(' ')}
          className={lineClass(car.driver, selected)}
          stroke={teamColor(car.driver)}
          strokeDasharray={dashOf(car.driver)}
        />
      ))}
      {race.cars.map((car) => (
        <text
          key={`g-${car.driver}`}
          x={PAD_L - 6}
          y={y(car.grid) + 3.5}
          textAnchor="end"
          className={car.driver === selected ? 'chart-code is-selected' : 'chart-code'}
          fill={teamColor(car.driver)}
          onClick={() => onSelect(car.driver === selected ? null : car.driver)}
        >
          {DRIVERS[car.driver].code}
        </text>
      ))}
      {final.map((driver, p) => (
        <text
          key={`f-${driver}`}
          x={W - PAD_R + 6}
          y={y(p + 1) + 3.5}
          className={driver === selected ? 'chart-code is-selected' : 'chart-code'}
          fill={race.cars[driver].running ? teamColor(driver) : 'var(--text-faint)'}
          onClick={() => onSelect(driver === selected ? null : driver)}
        >
          {DRIVERS[driver].code}
        </text>
      ))}
    </svg>
  )
}

/** Gap of every car to the leader, lap by lap. */
export function GapChart({ race, viewLap, selected, baseLap }: ChartProps & { baseLap: number }) {
  const total = race.totalLaps
  const top = 10
  const height = 230
  // Scale to the biggest gap among finishers, but never more than about a lap.
  const yMax = useMemo(() => {
    let max = 10
    for (const car of race.cars) {
      if (car.running) max = Math.max(max, car.gaps[car.gaps.length - 1] ?? 0)
    }
    return Math.min(max * 1.05, baseLap * 1.2)
  }, [race, baseLap])
  const y = (gap: number) => top + (Math.min(gap, yMax) / yMax) * height

  return (
    <svg
      className="race-chart"
      viewBox={`0 0 ${W} ${top + height + 30}`}
      role="img"
      aria-label="Gap chart: seconds behind the leader for every car on every lap"
    >
      <Backdrop race={race} viewLap={viewLap} top={top} height={height} />
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={PAD_L - 6} y={top + f * height + 3.5} textAnchor="end" className="chart-tick">
          {f === 0 ? 'Leader' : `+${Math.round(f * yMax)} s`}
        </text>
      ))}
      {race.cars.map((car) => (
        <polyline
          key={car.driver}
          points={car.gaps.map((g, lap) => `${lapX(lap, total).toFixed(1)},${y(g).toFixed(1)}`).join(' ')}
          className={lineClass(car.driver, selected)}
          stroke={teamColor(car.driver)}
          strokeDasharray={dashOf(car.driver)}
        />
      ))}
    </svg>
  )
}

/** Tyre stints of every car, in finishing order. */
export function StintChart({ race, viewLap, selected, onSelect }: ChartProps) {
  const total = race.totalLaps
  const top = 8
  const row = 16
  const height = race.cars.length * row
  const cars: CarRace[] = race.order.map((i) => race.cars[i])

  return (
    <svg
      className="race-chart"
      viewBox={`0 0 ${W} ${top + height + 30}`}
      role="img"
      aria-label="Tyre stints: which compound every car ran on each lap, in finishing order"
    >
      {cars.map((car, r) => (
        <g
          key={car.driver}
          className={selected !== null && car.driver !== selected ? 'stint-row is-dimmed' : 'stint-row'}
          onClick={() => onSelect(car.driver === selected ? null : car.driver)}
        >
          <text
            x={PAD_L - 6}
            y={top + r * row + 11.5}
            textAnchor="end"
            className="chart-code"
            fill={teamColor(car.driver)}
          >
            {DRIVERS[car.driver].code}
          </text>
          {car.stints
            .filter((s) => s.to >= s.from)
            .map((s) => {
              const x = lapX(s.from - 1, total)
              const width = ((s.to - s.from + 1) / total) * PLOT_W
              return (
                <g key={s.from}>
                  <rect
                    x={x + 0.75}
                    y={top + r * row + 2}
                    width={Math.max(1, width - 1.5)}
                    height={row - 4}
                    rx={2}
                    fill={COMPOUNDS[s.compound].color}
                  />
                  {width > 22 && (
                    <text x={x + width / 2} y={top + r * row + 11.5} textAnchor="middle" className="stint-label">
                      {COMPOUNDS[s.compound].short} {s.to - s.from + 1}
                    </text>
                  )}
                </g>
              )
            })}
          {!car.running && (
            <text x={lapX(car.outLap - 1, total) + 6} y={top + r * row + 11.5} className="chart-tick">
              out
            </text>
          )}
        </g>
      ))}
      {/* Drawn last so the shading shows which stops happened under the safety car. */}
      <g className="backdrop-over">
        <Backdrop race={race} viewLap={viewLap} top={top} height={height} />
      </g>
    </svg>
  )
}
