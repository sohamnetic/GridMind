import { reverseTrack } from '../../core/track/serialize'
import { useStudioStore, type StudioTool } from '../../state/studioStore'

const TOOLS: { id: StudioTool; label: string; group: 'shape' | 'markers' }[] = [
  { id: 'edit', label: 'Edit points', group: 'shape' },
  { id: 'draw', label: 'Draw', group: 'shape' },
  { id: 'start', label: 'Start line', group: 'markers' },
  { id: 'sector1', label: 'Sector 1', group: 'markers' },
  { id: 'sector2', label: 'Sector 2', group: 'markers' },
  { id: 'drs', label: 'DRS zone', group: 'markers' },
  { id: 'pit', label: 'Pit lane', group: 'markers' },
]

interface Props {
  drivable: boolean
  onFit: () => void
}

export function ToolPanel({ drivable, onFit }: Props) {
  const tool = useStudioStore((s) => s.tool)
  const setTool = useStudioStore((s) => s.setTool)
  const canUndo = useStudioStore((s) => s.past.length > 0)
  const canRedo = useStudioStore((s) => s.future.length > 0)
  const undo = useStudioStore((s) => s.undo)
  const redo = useStudioStore((s) => s.redo)
  const def = useStudioStore((s) => s.def)
  const update = useStudioStore((s) => s.update)
  const driving = tool === 'drive'

  const toolButton = ({ id, label }: (typeof TOOLS)[number]) => (
    <button
      key={id}
      type="button"
      className={tool === id ? 'tool is-active' : 'tool'}
      aria-pressed={tool === id}
      disabled={driving}
      onClick={() => setTool(id)}
    >
      {label}
    </button>
  )

  return (
    <section className="panel">
      <h2>Shape</h2>
      <div className="tool-grid">{TOOLS.filter((t) => t.group === 'shape').map(toolButton)}</div>

      <h2>Markers</h2>
      <div className="tool-grid">{TOOLS.filter((t) => t.group === 'markers').map(toolButton)}</div>

      <div className="button-row">
        <button type="button" onClick={undo} disabled={!canUndo || driving} title="Ctrl+Z">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo || driving} title="Ctrl+Shift+Z">
          Redo
        </button>
        <button type="button" onClick={onFit} disabled={driving}>
          Fit view
        </button>
        <button
          type="button"
          disabled={driving || def.points.length < 3}
          onClick={() => update(reverseTrack(def), 'push')}
          title="Reverse the driving direction"
        >
          Reverse
        </button>
      </div>

      <button
        type="button"
        className={driving ? 'primary is-stop' : 'primary'}
        disabled={!driving && !drivable}
        onClick={() => setTool(driving ? 'edit' : 'drive')}
      >
        {driving ? 'End test drive' : 'Test drive'}
      </button>
    </section>
  )
}
