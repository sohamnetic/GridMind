import { useCallback, useSyncExternalStore } from 'react'
import { isModuleId, type ModuleId } from './modules'

/** A screen of the app: the home page, one of the five modules, or the championship. */
export type Route = ModuleId | 'home' | 'season'

/**
 * Hash-based routing (`#/home`, `#/studio`, `#/pitwall`, ...).
 *
 * GitHub Pages serves static files only, so path-based routes would 404 on
 * refresh. The hash never reaches the server, which keeps deep links working.
 */
export function parseRoute(hash: string): Route {
  const segment = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? ''
  if (segment === 'season') return 'season'
  return isModuleId(segment) ? segment : 'home'
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getSnapshot(): string {
  return window.location.hash
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const hash = useSyncExternalStore(subscribe, getSnapshot)
  const navigate = useCallback((route: Route) => {
    window.location.hash = `/${route}`
  }, [])
  return [parseRoute(hash), navigate]
}
