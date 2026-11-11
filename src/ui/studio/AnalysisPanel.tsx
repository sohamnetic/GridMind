import { useMemo } from 'react'
import { wrapIndex } from '../../core/math/util'
import type { TrackAnalysis, TrackIssue } from '../../core/track/analysis'
import { sectorBoundaries } from '../../core/physics/lapTimer'
import type { BuiltTrack } from '../../core/track/types'

interface Props {
  track: BuiltTrack | null
  analysis: TrackAnalysis | null
  issues: TrackIssue[]
}

export function AnalysisPanel({ track, analysis, issues }: Props) {
  if (!track || !analysis) {
    return (
      <section className="panel">
        <h2>Analysis</h2>
        <p className="muted">Place at least three points to form a circuit.</p>
      </section>
    )
  }

  const tightest = analysis.corners.reduce<number>((min, c) => Math.min(min, c.minRadius), Infinity)

  return (
    <section className="panel">
      <h2>Analysis</h2>
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue) => (
            <li key={issue.message} className={`issue issue-${issue.level}`}>
              <strong>{issue.level === 'error' ? 'Problem' : 'Note'}</strong> {issue.message}
            </li>
          ))}
        </ul>
      )}
      <dl className="stats">
        <Stat label="Length" value={`${(analysis.length / 1000).toFixed(3)} km`} />
        <Stat label="Corners" value={String(analysis.corners.length)} />
        <Stat label="Longest straight" value={`${Math.round(analysis.longestStraight)} m`} />
        <Stat label="Tightest corner" value={Number.isFinite(tightest) ? `${Math.round(tightest)} m` : '–'} />
        <Stat label="In corners" value={`${Math.round(analysis.cornerFraction * 100)} %`} />
        <Stat label="Avg width" value={`${analysis.averageWidth.toFixed(1)} m`} />
      </dl>

      <h3>Curvature over the lap</h3>
      <CurvatureProfile track={track} analysis={analysis} />

      {analysis.corners.length > 0 && (
        <>
          <h3>Corner by corner</h3>
          <div className="table-scroll">
            <table className="corner-table">
              <thead>
                <tr>
                  <th scope="col">Turn</th>
                  <th scope="col">Dir</th>
                  <th scope="col" className="num">
                    Radius
                  </th>
                  <th scope="col" className="num">
                    Angle
                  </th>
                  <th scope="col" className="num">
                    At
                  </th>
                </tr>
              </thead>
              <tbody>
                {analysis.corners.map((c) => (
                  <tr key={c.number}>
                    <th scope="row">T{c.number}</th>
                    <td>{c.direction === 'L' ? 'Left' : 'Right'}</td>
                    <td className="num">{Math.round(c.minRadius)} m</td>
                    <td className="num">{Math.round(c.angle)}°</td>
                    <td className="num">{Math.round(c.apex)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

const VIEW_W = 280
const VIEW_H = 76

/** Signed curvature from the start line round the lap: right turns up, left turns down. */
function CurvatureProfile({ track, analysis }: { track: BuiltTrack; analysis: TrackAnalysis }) {
  const { path, sectors, labels } = useMemo(() => {
    const { n, curvature, startIndex } = track
    let peak = 1 / 150
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(curvature[i]))
    const mid = VIEW_H / 2
    const amp = mid - 12
    const count = Math.min(n, 400)
    let d = `M0 ${mid}`
    for (let k = 0; k <= count; k++) {
      const c = curvature[wrapIndex(startIndex + Math.round((k / count) * n), n)]
      d += ` L${((k / count) * VIEW_W).toFixed(1)} ${(mid - (c / peak) * amp).toFixed(1)}`
    }
    d += ` L${VIEW_W} ${mid} Z`
    return {
      path: d,
      sectors: sectorBoundaries(track).map((f) => f * VIEW_W),
      // Corner numbers, skipping any that would collide with the previous one.
      labels: analysis.corners
        .map((c) => ({
          number: c.number,
          x: (c.apex / track.length) * VIEW_W,
          up: c.direction === 'R',
        }))
        .filter((label, i, all) => i === 0 || label.x - all[i - 1].x >= 12),
    }
  }, [track, analysis])

  return (
    <svg
      className="profile"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Curvature profile of the lap, right-hand corners above the line and left-hand corners below"
    >
      <line x1="0" x2={VIEW_W} y1={VIEW_H / 2} y2={VIEW_H / 2} className="profile-axis" />
      {sectors.map((x) => (
        <line key={x} x1={x} x2={x} y1="0" y2={VIEW_H} className="profile-sector" />
      ))}
      <path d={path} className="profile-area" />
      {labels.map((l) => (
        <text key={l.number} x={l.x} y={l.up ? 8 : VIEW_H - 2} className="profile-label">
          {l.number}
        </text>
      ))}
    </svg>
  )
}
