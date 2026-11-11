import { useEffect, useRef } from 'react'
import type { BuiltTrack } from '../../core/track/types'
import type { TrackPaths } from '../../render/trackRenderer'
import { EvolutionView, type CarStyle, type FrameSource } from '../evolution/evolutionView'

interface Props {
  track: BuiltTrack | null
  paths: TrackPaths | null
  /** Racing line to draw under the cars (x, y, speed triplets). */
  ghost?: Float32Array | null
  /** Where car positions come from; defaults to the training frame. Must be a stable object. */
  source?: FrameSource
  /** Per-car colours and labels. Must be a stable object. */
  style?: CarStyle
  label: string
}

/** Canvas showing a track with a live field of cars on it. Drag to pan, scroll to zoom, double-click to fit. */
export function PopulationCanvas({ track, paths, ghost = null, source, style, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<EvolutionView | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const view = new EvolutionView(canvas, source, style ?? null)
    viewRef.current = view
    const resize = () => view.resize(wrap.clientWidth, wrap.clientHeight, window.devicePixelRatio || 1)
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    return () => {
      observer.disconnect()
      view.destroy()
      viewRef.current = null
    }
  }, [source, style])

  useEffect(() => {
    viewRef.current?.setTrack(track, paths)
  }, [track, paths, source, style])

  useEffect(() => {
    viewRef.current?.setGhost(ghost)
  }, [ghost, source, style])

  return (
    <div className="evolution-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label={label} />
    </div>
  )
}
