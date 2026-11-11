import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { Strategy } from '../../core/race/strategy'
import { COMPOUNDS } from '../../core/race/tyres'
import type { HeatCell, HeatMap } from '../../core/strategy/optimiser'
import type { StrategyStats } from '../../core/strategy/stats'

const W = 1000

/** "P7.3": an average finishing position. */
export const formatPosition = (value: number) => `P${value.toFixed(1)}`
/** "42 %"; shares under half a percent that are not zero show as "<1 %". */
export function formatShare(value: number): string {
  if (value > 0 && value < 0.005) return '<1 %'
  return `${Math.round(value * 100)} %`
}

// ---------- Hover tooltip shared by the charts ----------

interface Tip {
  x: number
  y: number
  text: string
}

/** A chart with a tooltip that follows the pointer over its marks. */
function useTip() {
  const frame = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const show = (e: MouseEvent, text: string) => {
    const box = frame.current?.getBoundingClientRect()
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text })
  }
  const hide = () => setTip(null)
  return { frame, tip, show, hide }
}

function ChartFrame({
  frame,
  tip,
  children,
}: {
  frame: React.RefObject<HTMLDivElement | null>
  tip: Tip | null
  children: ReactNode
}) {
  return (
    <div className="opt-chart" ref={frame}>
      {children}
      {tip && (
        <div className="opt-tip" style={{ left: tip.x, top: tip.y }} role="status">
          {tip.text}
        </div>
      )}
    </div>
  )
}

// ---------- Small marks used in the ranking table ----------

/** A strategy as a bar across the race distance, one block per stint in the tyre's colour. */
export function StintBar({ strategy, laps }: { strategy: Strategy; laps: number }) {
  const width = 200
  const stints: { compound: Strategy['start']; from: number; to: number }[] = []
  let from = 0
  let compound = strategy.start
  for (const stop of strategy.stops) {
    stints.push({ compound, from, to: stop.lap })
    from = stop.lap
    compound = stop.compound
  }
  stints.push({ compound, from, to: laps })
  return (
    <svg className="opt-stints" viewBox={`0 0 ${width} 12`} preserveAspectRatio="none" aria-hidden="true">
      {stints.map((s) => {
        const x = (s.from / laps) * width
        const w = ((s.to - s.from) / laps) * width
        return <rect key={s.from} x={x + 1} y={1} width={Math.max(1, w - 2)} height={10} rx={2} fill={COMPOUNDS[s.compound].color} />
      })}
    </svg>
  )
}

/** Where the car finishes in the middle 80 % of races, with the median marked. */
export function SpreadBar({ stats, cars }: { stats: StrategyStats; cars: number }) {
  const width = 120
  const x = (position: number) => 4 + ((position - 1) / (cars - 1)) * (width - 8)
  return (
    <svg
      className="opt-spread"
      viewBox={`0 0 ${width} 12`}
      role="img"
      aria-label={`Middle 80 % of races: P${stats.p10} to P${stats.p90}, median P${stats.p50}`}
    >
      <title>{`Middle 80 % of races: P${stats.p10} to P${stats.p90}, median P${stats.p50}`}</title>
      <line x1={4} x2={width - 4} y1={6} y2={6} className="opt-spread-axis" />
      <line x1={x(stats.p10)} x2={x(stats.p90)} y1={6} y2={6} className="opt-spread-range" />
      <circle cx={x(stats.p50)} cy={6} r={3.5} className="opt-spread-median" />
    </svg>
  )
}

// ---------- Finishing-position histogram ----------

interface HistogramProps {
  stats: StrategyStats
  /** The top plan, drawn as markers for comparison when another plan is selected. */
  reference: StrategyStats | null
  cars: number
}

/** Share of races finished in each position, with retirements in their own bar. */
export function PositionHistogram({ stats, reference, cars }: HistogramProps) {
  const { frame, tip, show, hide } = useTip()
  const top = 12
  const height = 190
  const left = 46
  const plot = W - left - 16
  const slot = plot / (cars + 1.5) // every position, a gap, then retirements
  const bar = slot * 0.62
  const peak = Math.max(
    0.05,
    ...stats.histogram,
    stats.retired,
    ...(reference ? [...reference.histogram, reference.retired] : []),
  )
  const yMax = Math.ceil(peak * 20) / 20
  const y = (share: number) => top + height - (share / yMax) * height
  const xOf = (i: number) => left + (i < cars ? i : cars + 0.5) * slot + (slot - bar) / 2

  const columns = [
    ...stats.histogram.map((share, i) => ({ label: `P${i + 1}`, tick: String(i + 1), share, ref: reference?.histogram[i] })),
    { label: 'Retired', tick: 'Out', share: stats.retired, ref: reference?.retired },
  ]

  return (
    <ChartFrame frame={frame} tip={tip}>
      <svg
        className="race-chart"
        viewBox={`0 0 ${W} ${top + height + 30}`}
        role="img"
        aria-label="Share of races finished in each position"
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W - 16} y1={y(f * yMax)} y2={y(f * yMax)} className="chart-grid" />
            <text x={left - 6} y={y(f * yMax) + 3.5} textAnchor="end" className="chart-tick">
              {Math.round(f * yMax * 100)} %
            </text>
          </g>
        ))}
        {columns.map((c, i) => {
          const x = xOf(i)
          const h = Math.max(0, top + height - y(c.share))
          const text =
            `${c.label}: ${formatShare(c.share)} of races` + (c.ref !== undefined ? ` (top plan ${formatShare(c.ref)})` : '')
          return (
            <g key={c.label} onMouseMove={(e) => show(e, text)} onMouseLeave={hide}>
              {/* The whole column is the hover target, not just the bar. */}
              <rect x={x - (slot - bar) / 2} y={top} width={slot} height={height + 18} fill="transparent" />
              {h > 0 && (
                <rect
                  x={x}
                  y={y(c.share)}
                  width={bar}
                  height={h}
                  rx={Math.min(4, h / 2)}
                  className={i === cars ? 'opt-bar is-out' : 'opt-bar'}
                />
              )}
              {c.ref !== undefined && (
                <line x1={x - 3} x2={x + bar + 3} y1={y(c.ref)} y2={y(c.ref)} className="opt-ref" />
              )}
              <text x={x + bar / 2} y={top + height + 14} textAnchor="middle" className="chart-tick">
                {c.tick}
              </text>
            </g>
          )
        })}
      </svg>
    </ChartFrame>
  )
}

// ---------- Pit-window heat map ----------

/** One hue, dark to light: the brighter the cell, the better the average finish. */
const RAMP: readonly [number, number, number][] = [
  [22, 30, 48],
  [38, 84, 150],
  [96, 170, 240],
  [176, 222, 255],
]

export function rampColor(t: number): string {
  const u = Math.min(1, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(u))
  const f = u - i
  const mix = (k: number) => Math.round(RAMP[i][k] + (RAMP[i + 1][k] - RAMP[i][k]) * f)
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`
}

interface HeatMapProps {
  map: HeatMap
  /** Words for a cell, e.g. "S-H, stop on lap 15". */
  describe: (row: number, column: number) => string
  rowTitle: string
  columnTitle: string
  /** strategyKey of the plan to ring, if it is on the map. */
  selected: string | null
  /** Called with the plan's key when a cell is clicked. */
  onPick?: (key: string) => void
  /** Keys of plans that can be picked (the finalists). */
  pickable?: ReadonlySet<string>
}

export function PitWindowMap({ map, describe, rowTitle, columnTitle, selected, onPick, pickable }: HeatMapProps) {
  const { frame, tip, show, hide } = useTip()
  const left = 74
  const top = 8
  const rowH = map.rows.length > 8 ? 24 : 30
  const colW = (W - left - 12) / map.laps.length
  const height = map.rows.length * rowH

  let min = Infinity
  let max = -Infinity
  let best: HeatCell | null = null
  for (const row of map.cells) {
    for (const cell of row) {
      if (!cell) continue
      if (cell.meanPosition < min) {
        min = cell.meanPosition
        best = cell
      }
      max = Math.max(max, cell.meanPosition)
    }
  }
  const span = Math.max(0.5, max - min)

  return (
    <>
      <ChartFrame frame={frame} tip={tip}>
        <svg
          className="race-chart"
          viewBox={`0 0 ${W} ${top + height + 40}`}
          role="img"
          aria-label={`Average finishing position by ${columnTitle.toLowerCase()} and ${rowTitle.toLowerCase()}`}
        >
          {map.rows.map((row, r) => (
            <text key={row} x={left - 8} y={top + r * rowH + rowH / 2 + 3.5} textAnchor="end" className="opt-axis-label">
              {row}
            </text>
          ))}
          {map.laps.map((lap, c) => (
            <text key={lap} x={left + c * colW + colW / 2} y={top + height + 14} textAnchor="middle" className="chart-tick">
              {lap}
            </text>
          ))}
          <text x={left + (W - left - 12) / 2} y={top + height + 32} textAnchor="middle" className="opt-axis-title">
            {columnTitle}
          </text>
          <text
            x={12}
            y={top + height / 2}
            textAnchor="middle"
            className="opt-axis-title"
            transform={`rotate(-90 12 ${top + height / 2})`}
          >
            {rowTitle}
          </text>
          {map.cells.map((row, r) =>
            row.map((cell, c) => {
              if (!cell) return null
              const t = (max - cell.meanPosition) / span
              const x = left + c * colW
              const y = top + r * rowH
              const canPick = onPick !== undefined && pickable?.has(cell.key) === true
              const text =
                `${describe(r, c)}: average finish ${formatPosition(cell.meanPosition)}, points in ${formatShare(cell.points)} of races` +
                (cell.overrun ? '. A stint outlasts its tyres, so this needs an extra stop' : '')
              return (
                <g
                  key={cell.key}
                  onMouseMove={(e) => show(e, canPick ? `${text}. Click for details.` : text)}
                  onMouseLeave={hide}
                  onClick={canPick ? () => onPick(cell.key) : undefined}
                  className={canPick ? 'opt-cell is-pickable' : 'opt-cell'}
                >
                  <rect x={x + 1} y={y + 1} width={colW - 2} height={rowH - 2} rx={3} fill={rampColor(t)} />
                  {cell.overrun && (
                    <line x1={x + 6} y1={y + rowH - 6} x2={x + colW - 6} y2={y + 6} className="opt-cell-overrun" />
                  )}
                  {cell.key === selected && (
                    <rect x={x + 2} y={y + 2} width={colW - 4} height={rowH - 4} rx={3} className="opt-cell-ring" />
                  )}
                  {cell === best && (
                    <text x={x + colW / 2} y={y + rowH / 2 + 3.5} textAnchor="middle" className="opt-cell-label">
                      {formatPosition(cell.meanPosition)}
                    </text>
                  )}
                </g>
              )
            }),
          )}
        </svg>
      </ChartFrame>
      {Number.isFinite(min) && (
        <div className="opt-scale" aria-hidden="true">
          <span>Best, {formatPosition(min)}</span>
          <span
            className="opt-scale-ramp"
            style={{ background: `linear-gradient(to right, ${[1, 0.66, 0.33, 0].map(rampColor).join(', ')})` }}
          />
          <span>Worst, {formatPosition(max)}</span>
          {map.cells.some((row) => row.some((cell) => cell?.overrun)) && (
            <span className="opt-scale-overrun">
              <svg viewBox="0 0 22 12" aria-hidden="true">
                <rect x={0.5} y={0.5} width={21} height={11} rx={3} fill={rampColor(0.2)} />
                <line x1={4} y1={9} x2={18} y2={3} className="opt-cell-overrun" />
              </svg>
              A stint outlasts its tyres: needs an extra stop
            </span>
          )}
        </div>
      )}
    </>
  )
}
