import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_MODULE, isModuleId, type ModuleId } from './modules'

/**
 * Hash-based routing (`#/studio`, `#/pitwall`, ...).
 *
 * GitHub Pages serves static files only, so path-based routes would 404 on
 * refresh. The hash never reaches the server, which keeps deep links working.
 */
export function parseRoute(hash: string): ModuleId {
  const segment = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? ''
  return isModuleId(segment) ? segment : DEFAULT_MODULE
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getSnapshot(): string {
  return window.location.hash
}

export function useHashRoute(): [ModuleId, (id: ModuleId) => void] {
  const hash = useSyncExternalStore(subscribe, getSnapshot)
  const navigate = useCallback((id: ModuleId) => {
    window.location.hash = `/${id}`
  }, [])
  return [parseRoute(hash), navigate]
}
