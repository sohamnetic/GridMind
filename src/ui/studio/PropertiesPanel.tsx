import { useRef } from 'react'
import { zoneLength } from '../../core/track/build'
import { TRACK_LIMITS, type BuiltTrack, type TrackDef } from '../../core/track/types'
import type { TrackPaths } from '../../render/trackRenderer'
import { useStudioStore } from '../../state/studioStore'
import { deleteSelectedPoint } from './studioController'

interface Props {
  track: BuiltTrack | null
  paths: TrackPaths | null
}

export function PropertiesPanel({ track, paths }: Props) {
  const def = useStudioStore((s) => s.def)
  const selected = useStudioStore((s) => s.selected)
  const update = useStudioStore((s) => s.update)
  const driving = useStudioStore((s) => s.tool === 'drive')
  const point = selected !== null ? def.points[selected] : undefined

  const patch = (changes: Partial<TrackDef>, history: 'push' | 'none') =>
    update({ ...def, ...changes }, history)

  const setPointWidth = (width: number | undefined, history: 'push' | 'none') => {
    if (selected === null || !point) return
    const points = def.points.slice()
    const next = { x: point.x, y: point.y, ...(width === undefined ? {} : { width }) }
    points[selected] = next
    update({ ...def, points }, history)
  }

  return (
    <section className="panel">
      <h2>Track</h2>
      <fieldset disabled={driving} className="fields">
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={def.name}
            maxLength={60}
            onChange={(e) => patch({ name: e.target.value }, 'none')}
          />
        </label>
        <Slider
          label="Width"
          unit="m"
          value={def.width}
          {...TRACK_LIMITS.width}
          step={0.5}
          onChange={(width, history) => patch({ width }, history)}
        />
        <Slider
          label="Kerbs"
          unit="m"
          value={def.kerbWidth}
          {...TRACK_LIMITS.kerbWidth}
          step={0.1}
          onChange={(kerbWidth, history) => patch({ kerbWidth }, history)}
        />
        <Slider
          label="Run-off"
          unit="m"
          value={def.runoffWidth}
          {...TRACK_LIMITS.runoffWidth}
          step={1}
          onChange={(runoffWidth, history) => patch({ runoffWidth }, history)}
        />
      </fieldset>

      {point && selected !== null && (
        <>
          <h2>Point {selected + 1}</h2>
          <fieldset disabled={driving} className="fields">
            <label className="check">
              <input
                type="checkbox"
                checked={point.width !== undefined}
                onChange={(e) => setPointWidth(e.target.checked ? def.width : undefined, 'push')}
              />
              <span>Custom width here</span>
            </label>
            {point.width !== undefined && (
              <Slider
                label="Width"
                unit="m"
                value={point.width}
                {...TRACK_LIMITS.width}
                step={0.5}
                onChange={setPointWidth}
              />
            )}
            <button type="button" onClick={() => deleteSelectedPoint(() => {})}>
              Delete point
            </button>
          </fieldset>
        </>
      )}

      {track && (def.drsZones.length > 0 || def.pit) && (
        <>
          <h2>Zones</h2>
          <ul className="zone-list">
            {def.drsZones.map((zone, i) => (
              <li key={`${zone.start}-${zone.end}`}>
                <span className="swatch swatch-drs" />
                <span>DRS {i + 1}</span>
                <span className="num">{Math.round(zoneLength(track, zone.start, zone.end))} m</span>
                <button
                  type="button"
                  className="icon"
                  disabled={driving}
                  aria-label={`Remove DRS zone ${i + 1}`}
                  onClick={() => patch({ drsZones: def.drsZones.filter((_, j) => j !== i) }, 'push')}
                >
                  ×
                </button>
              </li>
            ))}
            {def.pit && (
              <li>
                <span className="swatch swatch-pit" />
                <span>Pit lane ({def.pit.side})</span>
                <span className="num">{Math.round(paths?.pitLength ?? 0)} m</span>
                <button
                  type="button"
                  className="icon"
                  disabled={driving}
                  aria-label="Remove pit lane"
                  onClick={() => patch({ pit: null }, 'push')}
                >
                  ×
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  )
}

interface SliderProps {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number, history: 'push' | 'none') => void
}

/** Range input that records one undo step per drag rather than one per tick. */
function Slider({ label, unit, value, min, max, step, onChange }: SliderProps) {
  const recorded = useRef(false)
  const release = () => {
    recorded.current = false
  }
  return (
    <label className="field">
      <span>
        {label}
        <output>
          {value.toFixed(step < 1 ? 1 : 0)} {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value), recorded.current ? 'none' : 'push')
          recorded.current = true
        }}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
      />
    </label>
  )
}
