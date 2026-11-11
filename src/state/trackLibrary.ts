import { get, set } from 'idb-keyval'
import { parseTrack } from '../core/track/serialize'
import type { TrackDef } from '../core/track/types'

/**
 * Browser-side persistence. Saved tracks live in IndexedDB; the track being
 * edited is mirrored to localStorage so a reload never loses work.
 * Every call is wrapped: private windows and blocked storage must not break the app.
 */
const LIBRARY_KEY = 'gridmind:tracks'
const WORKING_KEY = 'gridmind:working-track'

export async function loadSavedTracks(): Promise<TrackDef[]> {
  try {
    const stored = await get<unknown>(LIBRARY_KEY)
    if (!Array.isArray(stored)) return []
    return stored.flatMap((raw) => {
      try {
        return [parseTrack(raw)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export async function storeSavedTracks(tracks: TrackDef[]): Promise<boolean> {
  try {
    await set(LIBRARY_KEY, tracks)
    return true
  } catch {
    return false
  }
}

export function loadWorkingTrack(): TrackDef | null {
  try {
    const text = localStorage.getItem(WORKING_KEY)
    return text ? parseTrack(text) : null
  } catch {
    return null
  }
}

export function storeWorkingTrack(def: TrackDef): void {
  try {
    localStorage.setItem(WORKING_KEY, JSON.stringify(def))
  } catch {
    // Storage full or unavailable: the session still works, it just will not survive a reload.
  }
}

/** Offers a file to the user as a download, with no server involved. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function trackFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'circuit'}.gridmind.json`
}
