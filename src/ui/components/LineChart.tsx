import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import './charts.css'

export interface ChartSeries {
  label: string
  color: string
  values: (number | null)[]
  dash?: number[]
}

interface Props {
  x: number[]
  series: ChartSeries[]
  height?: number
  /** Formats y values on the axis and in the legend. Must be a stable function. */
  formatY: (value: number) => string
}

const AXIS_COLOR = '#9aa6bd'
const GRID_COLOR = 'rgba(233, 237, 245, 0.07)'
const FONT = '11px system-ui, sans-serif'

/** Thin React wrapper around uPlot for generation-by-generation line charts. */
export function LineChart({ x, series, height = 150, formatY }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  // The plot is rebuilt only when the set of lines changes, not on every data point.
  const signature = series.map((s) => `${s.label}:${s.color}`).join('|')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const lines = signature.split('|').map((entry) => {
      const cut = entry.lastIndexOf(':')
      return { label: entry.slice(0, cut), color: entry.slice(cut + 1) }
    })
    const axis = { stroke: AXIS_COLOR, font: FONT, grid: { stroke: GRID_COLOR, width: 1 }, ticks: { stroke: GRID_COLOR, width: 1 } }
    const plot = new uPlot(
      {
        width: Math.max(120, host.clientWidth),
        height,
        scales: { x: { time: false } },
        cursor: { points: { size: 6 } },
        legend: { live: true },
        series: [
          { label: 'Generation' },
          ...lines.map((line) => ({
            label: line.label,
            stroke: line.color,
            width: 1.5,
            spanGaps: true,
            points: { show: false },
            value: (_: uPlot, v: number | null) => (v === null || v === undefined ? '–' : formatY(v)),
          })),
        ],
        axes: [
          { ...axis, size: 26 },
          { ...axis, size: 54, values: (_: uPlot, ticks: number[]) => ticks.map(formatY) },
        ],
      },
      [[]],
      host,
    )
    plotRef.current = plot
    const observer = new ResizeObserver(() => {
      plot.setSize({ width: Math.max(120, host.clientWidth), height })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [signature, height, formatY])

  useEffect(() => {
    plotRef.current?.setData([x, ...series.map((s) => s.values)])
  }, [x, series, signature, height, formatY])

  return <div className="chart" ref={hostRef} />
}
