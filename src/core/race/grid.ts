/**
 * The GridMind championship: ten invented teams and twenty invented drivers.
 * None of these names, colours or numbers refer to a real series, team or person.
 */
export interface Team {
  id: string
  name: string
  color: string
  /** Engine strength relative to the best car (1 = quickest). */
  pace: number
}

export interface Driver {
  /** Three-letter timing-screen code. */
  code: string
  name: string
  number: number
  /** Index into TEAMS. */
  team: number
}

export const TEAMS: readonly Team[] = [
  { id: 'aurora', name: 'Aurora GP', color: '#ff5a36', pace: 1 },
  { id: 'vanta', name: 'Vanta Racing', color: '#4aa8ff', pace: 0.992 },
  { id: 'helix', name: 'Helix Motorsport', color: '#3ddc97', pace: 0.984 },
  { id: 'cobalt', name: 'Cobalt Works', color: '#7b6cff', pace: 0.976 },
  { id: 'solstice', name: 'Solstice', color: '#ffc247', pace: 0.968 },
  { id: 'ironwood', name: 'Ironwood', color: '#c58bff', pace: 0.96 },
  { id: 'zephyr', name: 'Zephyr Racing', color: '#59d6e6', pace: 0.952 },
  { id: 'monarch', name: 'Monarch Tech', color: '#ff8fb1', pace: 0.944 },
  { id: 'pulse', name: 'Pulse Engineering', color: '#b7e04a', pace: 0.936 },
  { id: 'tidal', name: 'Tidal', color: '#e9edf5', pace: 0.928 },
]

const NAMES: readonly (readonly [string, string])[] = [
  ['OKA', 'M. Okafor'],
  ['VAR', 'L. Varga'],
  ['LIN', 'S. Lindqvist'],
  ['ARA', 'T. Arakawa'],
  ['DEL', 'R. Delacroix'],
  ['MBE', 'J. Mbeki'],
  ['NOV', 'A. Novak'],
  ['FER', 'C. Ferreira'],
  ['HAR', 'D. Hartmann'],
  ['ISH', 'K. Ishida'],
  ['ROM', 'P. Romano'],
  ['SAN', 'E. Sandoval'],
  ['PET', 'N. Petrov'],
  ['CAS', 'F. Castellan'],
  ['YIL', 'H. Yilmaz'],
  ['ASH', 'B. Ashworth'],
  ['JEN', 'O. Jensen'],
  ['MOR', 'V. Moreau'],
  ['TAN', 'G. Tanaka'],
  ['KOW', 'I. Kowalski'],
]

/** Two drivers per team, in team order: drivers 0 and 1 drive for team 0, and so on. */
export const DRIVERS: readonly Driver[] = NAMES.map(([code, name], i) => ({
  code,
  name,
  number: 2 + i * 3 + (i % 2),
  team: Math.floor(i / 2),
}))

export type GridOrder = 'pace' | 'reversed' | 'mixed'

/**
 * Starting order for the first `count` drivers: grid[slot] = driver index.
 *  - 'pace': quickest cars at the front, as after a normal qualifying session
 *  - 'reversed': quickest at the back, so they have to come through the field
 *  - 'mixed': shuffled by the given random function
 */
export function gridOrder(count: number, order: GridOrder, random: () => number): number[] {
  const grid = Array.from({ length: count }, (_, i) => i)
  if (order === 'reversed') grid.reverse()
  if (order === 'mixed') {
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const t = grid[i]
      grid[i] = grid[j]
      grid[j] = t
    }
  }
  return grid
}
