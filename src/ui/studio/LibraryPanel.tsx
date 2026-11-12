import { useMemo, useRef, useState } from 'react'
import { encodeTrack, shareUrl } from '../../share/urlCodec'
import { createPresets } from '../../core/track/presets'
import { newTrackId, parseTrack, trackToJson } from '../../core/track/serialize'
import type { TrackDef } from '../../core/track/types'
import { useStudioStore } from '../../state/studioStore'
import { downloadText, trackFilename } from '../../state/trackLibrary'

export function LibraryPanel() {
  const def = useStudioStore((s) => s.def)
  const saved = useStudioStore((s) => s.saved)
  const hasEdits = useStudioStore((s) => s.past.length > 0)
  const driving = useStudioStore((s) => s.tool === 'drive')
  const loadTrack = useStudioStore((s) => s.loadTrack)
  const newTrack = useStudioStore((s) => s.newTrack)
  const saveCurrent = useStudioStore((s) => s.saveCurrent)
  const deleteSaved = useStudioStore((s) => s.deleteSaved)
  const presets = useMemo(() => createPresets(), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const status = useStudioStore((s) => s.notice)
  const setStatus = useStudioStore((s) => s.setNotice)
  /** The share link, shown for copying by hand when the clipboard is not available. */
  const [link, setLink] = useState<string | null>(null)

  const isSaved = saved.some((t) => t.id === def.id)

  /** Loading another track discards unsaved edits, so ask first. */
  const confirmDiscard = () =>
    !hasEdits || window.confirm('Discard the changes to the current track?')

  const open = (track: TrackDef) => {
    if (!confirmDiscard()) return
    loadTrack(track)
    setStatus(null)
  }

  const save = async () => {
    await saveCurrent()
    setStatus({ kind: 'ok', text: 'Saved in this browser.' })
  }

  const share = async () => {
    const url = shareUrl(window.location.href, await encodeTrack(def))
    try {
      await navigator.clipboard.writeText(url)
      setLink(null)
      setStatus({ kind: 'ok', text: 'Link copied. Whoever opens it gets their own copy of this circuit.' })
    } catch {
      setLink(url)
      setStatus({ kind: 'ok', text: 'Copy this link. Whoever opens it gets their own copy of this circuit.' })
    }
  }

  const importFile = async (file: File) => {
    try {
      const track = parseTrack(await file.text())
      if (!confirmDiscard()) return
      // An imported file must not overwrite a preset or an existing saved track.
      loadTrack({ ...track, id: newTrackId() })
      setStatus({ kind: 'ok', text: `Imported “${track.name}”.` })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Could not read that file.' })
    }
  }

  return (
    <section className="panel">
      <h2>Library</h2>
      <fieldset disabled={driving} className="fields">
        <div className="button-row">
          <button type="button" onClick={() => void save()}>
            {isSaved ? 'Save' : 'Save copy'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmDiscard()) newTrack()
            }}
          >
            New
          </button>
          <button type="button" onClick={() => downloadText(trackFilename(def.name), trackToJson(def))}>
            Export
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Import
          </button>
        </div>
        <div className="button-row">
          <button
            type="button"
            disabled={def.points.length < 3}
            title="Copies a link that contains this circuit. Nothing is uploaded: the circuit is in the link itself."
            onClick={() => void share()}
          >
            Copy share link
          </button>
        </div>
        {link && (
          <input
            className="share-link"
            type="text"
            readOnly
            value={link}
            aria-label="Share link"
            onFocus={(e) => e.target.select()}
          />
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
        {status && (
          <p className={status.kind === 'error' ? 'status status-error' : 'status'} role="status">
            {status.text}
          </p>
        )}

        <h3>Preset circuits</h3>
        <ul className="track-list" data-coach="presets">
          {presets.map((track) => (
            <li key={track.id}>
              <button
                type="button"
                className={track.id === def.id ? 'track-item is-current' : 'track-item'}
                onClick={() => open(track)}
              >
                {track.name}
              </button>
            </li>
          ))}
        </ul>

        <h3>Your circuits</h3>
        {saved.length === 0 ? (
          <p className="muted">Nothing saved yet. Saved circuits stay in this browser.</p>
        ) : (
          <ul className="track-list">
            {saved.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  className={track.id === def.id ? 'track-item is-current' : 'track-item'}
                  onClick={() => open(track)}
                >
                  {track.name}
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Delete ${track.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete “${track.name}”? This cannot be undone.`)) {
                      void deleteSaved(track.id)
                    }
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </section>
  )
}
