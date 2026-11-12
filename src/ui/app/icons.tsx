import type { ModuleId } from './modules'

/** Small line icons, one per module, drawn on a 24 px grid. */
const PATHS: Record<ModuleId, string[]> = {
  // A circuit outline with a pen nib.
  studio: ['M5 15c-2-4 0-9 5-9s8 3 7 6-4 2-5 4-4 3-7-1z', 'M15 19l5-5 1.5 1.5-5 5L15 21z'],
  // Three generations branching.
  evolution: ['M12 4v5', 'M12 9c0 3-6 2-6 6', 'M12 9c0 3 6 2 6 6', 'M6 15v4', 'M18 15v4', 'M12 9v10'],
  // A flag on a pole.
  race: ['M6 21V4', 'M6 5h11l-2 3.5 2 3.5H6'],
  // Bars of different heights with a trend line.
  optimiser: ['M5 20v-6', 'M10 20v-10', 'M15 20v-7', 'M20 20V6', 'M4 9l5-4 5 3 6-5'],
  // A headset.
  pitwall: ['M5 14v-2a7 7 0 0 1 14 0v2', 'M5 13h2.5v5H6a1 1 0 0 1-1-1z', 'M19 13h-2.5v5H18a1 1 0 0 0 1-1z', 'M17 18c0 2-2 3-5 3'],
}

export function ModuleIcon({ id, size = 18 }: { id: ModuleId; size?: number }) {
  return (
    <svg
      className="icon-line"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[id].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        d="M9 21c-3-5 0-12 7-12s10 6 7 10-6 1-8 3-4 2-6-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="12" r="2.4" className="brand-dot" />
    </svg>
  )
}
