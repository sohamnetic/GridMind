import { useEffect, useMemo, useState } from 'react'
import { analyseTrack, isDrivable, validateTrack } from '../../core/track/analysis'
import { buildTrack } from '../../core/track/build'
import { buildTrackPaths } from '../../render/trackRenderer'
import { useStudioStore } from '../../state/studioStore'
import { AnalysisPanel } from './AnalysisPanel'
import { LibraryPanel } from './LibraryPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { StudioCanvas } from './StudioCanvas'
import { ToolPanel } from './ToolPanel'
import './studio.css'

export function TrackStudio() {
  const def = useStudioStore((s) => s.def)
  const loadCount = useStudioStore((s) => s.loadCount)
  const hydrateLibrary = useStudioStore((s) => s.hydrateLibrary)
  const [fitRequests, setFitRequests] = useState(0)

  // Everything derived from the definition is rebuilt on each edit; a 5 km
  // track takes a couple of milliseconds, well inside a drag frame.
  const scene = useMemo(() => {
    const track = buildTrack(def)
    const issues = track ? validateTrack(track) : []
    return {
      track,
      paths: track ? buildTrackPaths(track) : null,
      analysis: track ? analyseTrack(track) : null,
      issues,
      drivable: track !== null && isDrivable(issues),
    }
  }, [def])

  useEffect(() => {
    void hydrateLibrary()
  }, [hydrateLibrary])

  return (
    <div className="studio">
      <aside className="studio-side" aria-label="Tools and track properties">
        <ToolPanel drivable={scene.drivable} onFit={() => setFitRequests((n) => n + 1)} />
        <PropertiesPanel track={scene.track} paths={scene.paths} />
      </aside>
      <StudioCanvas scene={scene} fitKey={loadCount * 1000 + fitRequests} />
      <aside className="studio-side" aria-label="Analysis and library">
        <AnalysisPanel track={scene.track} analysis={scene.analysis} issues={scene.issues} />
        <LibraryPanel />
      </aside>
    </div>
  )
}
