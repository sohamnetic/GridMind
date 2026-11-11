import { useEffect, useRef, useState } from 'react'
import { formatLapTime } from '../../core/physics/lapTimer'
import { useStudioStore, type StudioTool } from '../../state/studioStore'
import { StudioController, type HudState, type StudioScene } from './studioController'

const HINTS: Record<StudioTool, string> = {
  edit: 'Drag points to reshape · click the track to add one · Delete removes · scroll to zoom',
  draw: 'Drag to sketch a whole circuit freehand, or click to place points one by one',
  start: 'Click the track to place the start/finish line',
  sector1: 'Click the track where sector 1 ends',
  sector2: 'Click the track where sector 2 ends',
  drs: 'Click where the DRS zone starts, then where it ends',
  pit: 'Click the pit entry, then the pit exit — on the side of the track the lane should run',
  drive: 'Arrow keys or WASD to drive · Space brakes · R restarts · Esc ends the drive',
}

interface Props {
  scene: StudioScene
  /** Changes whenever the view should re-centre on the track. */
  fitKey: number
}

export function StudioCanvas({ scene, fitKey }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<StudioController | null>(null)
  const [hud, setHud] = useState<HudState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const tool = useStudioStore((s) => s.tool)
  const selected = useStudioStore((s) => s.selected)

  // Create the controller once and keep the canvas sized to its container.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const controller = new StudioController(canvas, { onHud: setHud, onMessage: setMessage })
    controllerRef.current = controller
    const observer = new ResizeObserver(() => {
      controller.resize(wrap.clientWidth, wrap.clientHeight, window.devicePixelRatio || 1)
    })
    observer.observe(wrap)
    controller.resize(wrap.clientWidth, wrap.clientHeight, window.devicePixelRatio || 1)
    return () => {
      observer.disconnect()
      controller.destroy()
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    controllerRef.current?.setScene(scene)
  }, [scene])

  useEffect(() => {
    controllerRef.current?.setTool(tool)
  }, [tool])

  useEffect(() => {
    controllerRef.current?.requestDraw()
  }, [selected])

  useEffect(() => {
    controllerRef.current?.requestFit()
  }, [fitKey])

  // Transient messages fade on their own.
  useEffect(() => {
    if (!message) return
    const id = setTimeout(() => setMessage(null), 3500)
    return () => clearTimeout(id)
  }, [message])

  return (
    <div className="studio-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="Track editor canvas" />
      <p className="canvas-hint">{HINTS[tool]}</p>
      {message && (
        <p className="canvas-toast" role="status">
          {message}
        </p>
      )}
      {hud && <DriveHud hud={hud} />}
    </div>
  )
}

function DriveHud({ hud }: { hud: HudState }) {
  return (
    <div className="drive-hud" aria-live="off">
      <div className="hud-speed">
        <span className="hud-speed-value">{Math.round(hud.speedKmh)}</span>
        <span className="hud-unit">km/h</span>
      </div>
      <dl className="hud-times">
        <div>
          <dt>Lap {hud.laps + 1}</dt>
          <dd>{hud.lapTime === null ? 'Out lap' : formatLapTime(hud.lapTime)}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd>{formatLapTime(hud.lastLap)}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd className="hud-best">{formatLapTime(hud.bestLap)}</dd>
        </div>
      </dl>
      <div className="hud-sectors">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i === hud.sector && hud.lapTime !== null ? 'is-live' : undefined}>
            S{i + 1} {hud.currentSectors[i] !== undefined ? hud.currentSectors[i].toFixed(3) : '–'}
          </span>
        ))}
      </div>
      <div className={hud.crashed ? 'hud-surface is-crashed' : 'hud-surface'}>
        {hud.crashed ? 'Crashed — resetting' : hud.surface}
      </div>
    </div>
  )
}
