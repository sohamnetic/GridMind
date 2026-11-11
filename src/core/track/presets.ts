import { createTrack } from './serialize'
import type { ControlPoint, TrackDef } from './types'

/**
 * Built-in circuits. All names and layouts are invented for GridMind.
 * They cover the range the simulation has to cope with: flat-out oval, tight
 * street corners, fast sweepers and a mixed layout with a long straight.
 */

type Vertex = readonly [number, number]

/**
 * Control points for a circuit made of straight edges joined by rounded
 * corners: each corner vertex is replaced by a point `inset` metres before and
 * after it, and long edges get a midpoint so they stay straight.
 */
export function roundedPolygon(vertices: readonly Vertex[], inset: number): ControlPoint[] {
  const points: ControlPoint[] = []
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const [ax, ay] = vertices[i]
    const [bx, by] = vertices[(i + 1) % n]
    const len = Math.hypot(bx - ax, by - ay)
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    // Distances along the edge at which to place points. The pair nearest each
    // corner shapes the bend; a second anchor one inset further along pins the
    // spline tangent to the edge so the straight does not bow outwards.
    const offsets = [inset]
    if (len >= 5 * inset) {
      const from = 2 * inset
      const to = len - 2 * inset
      const spans = Math.max(1, Math.ceil((to - from) / 350))
      for (let k = 0; k <= spans; k++) offsets.push(from + ((to - from) * k) / spans)
    }
    offsets.push(len - inset)
    for (const d of offsets) points.push({ x: ax + ux * d, y: ay + uy * d })
  }
  return points
}

function pts(coords: readonly Vertex[]): ControlPoint[] {
  return coords.map(([x, y]) => ({ x, y }))
}

function copperlineOval(): TrackDef {
  // Two 700 m straights joined by 150 m radius semicircles.
  const d = 150 * Math.SQRT1_2
  const track = createTrack(
    'Copperline Oval',
    pts([
      [-350, -150],
      [0, -150],
      [350, -150],
      [350 + d, -d],
      [500, 0],
      [350 + d, d],
      [350, 150],
      [0, 150],
      [-350, 150],
      [-350 - d, d],
      [-500, 0],
      [-350 - d, -d],
    ]),
    'preset-oval',
  )
  track.width = 14
  track.startFraction = 0.15
  track.sectors = [0.45, 0.8]
  track.drsZones = [{ start: 0.53, end: 0.78 }]
  track.pit = { entry: 0.03, exit: 0.27, side: 'right' }
  return track
}

function pinewoodShort(): TrackDef {
  const track = createTrack(
    'Pinewood Short',
    pts([
      [-260, -110],
      [-40, -130],
      [170, -120],
      [290, -70],
      [320, 20],
      [260, 100],
      [140, 120],
      [40, 80],
      [-50, 90],
      [-120, 150],
      [-230, 160],
      [-310, 90],
      [-330, -20],
    ]),
    'preset-pinewood',
  )
  track.startFraction = 0.07
  track.sectors = [0.4, 0.72]
  track.drsZones = [{ start: 0.02, end: 0.2 }]
  track.pit = { entry: 0.01, exit: 0.2, side: 'right' }
  return track
}

function harbourStreets(): TrackDef {
  const track = createTrack(
    'Harbour Streets',
    roundedPolygon(
      [
        [-300, -180],
        [300, -180],
        [300, -40],
        [120, -40],
        [120, 100],
        [320, 100],
        [320, 200],
        [-150, 200],
        [-150, 60],
        [-300, 60],
      ],
      28,
    ),
    'preset-harbour',
  )
  track.width = 10
  track.runoffWidth = 6
  track.startFraction = 0.1
  track.sectors = [0.38, 0.7]
  track.drsZones = [
    { start: 0.03, end: 0.2 },
    { start: 0.62, end: 0.78 },
  ]
  track.pit = { entry: 0.02, exit: 0.21, side: 'right' }
  return track
}

function ventoRing(): TrackDef {
  // A star-shaped loop: every point is at a different angle from the centre,
  // so the layout can never cross itself. Large radii give fast sweepers.
  const count = 20
  const points: ControlPoint[] = []
  for (let k = 0; k < count; k++) {
    const a = (2 * Math.PI * k) / count
    const r = 430 * (1 + 0.2 * Math.cos(2 * a) + 0.22 * Math.sin(3 * a) + 0.08 * Math.cos(5 * a))
    // `+ 0` turns a rounded -0 into 0 so the points survive a JSON round trip unchanged.
    points.push({
      x: Math.round(1.35 * r * Math.cos(a)) + 0,
      y: Math.round(0.8 * r * Math.sin(a)) + 0,
    })
  }
  const track = createTrack('Vento Ring', points, 'preset-vento')
  track.width = 13
  track.runoffWidth = 20
  track.startFraction = 0.02
  track.sectors = [0.36, 0.69]
  track.drsZones = [{ start: 0.93, end: 0.08 }]
  track.pit = { entry: 0.95, exit: 0.1, side: 'right' }
  return track
}

function kestrelPark(): TrackDef {
  const track = createTrack(
    'Kestrel Park',
    pts([
      [-600, -250],
      [-200, -250],
      [200, -250],
      [500, -250],
      [590, -225],
      [630, -160],
      [600, -90],
      [520, -60],
      [440, -20],
      [430, 60],
      [480, 130],
      [560, 170],
      [610, 230],
      [590, 300],
      [510, 330],
      [350, 320],
      [200, 280],
      [60, 300],
      [-80, 340],
      [-220, 310],
      [-330, 230],
      [-480, 220],
      [-640, 200],
      [-740, 120],
      [-760, 0],
      [-700, -80],
      [-720, -170],
      [-690, -230],
    ]),
    'preset-kestrel',
  )
  track.startFraction = 0.08
  track.sectors = [0.4, 0.7]
  track.drsZones = [{ start: 0.1, end: 0.25 }]
  track.pit = { entry: 0.01, exit: 0.2, side: 'right' }
  return track
}

export function createPresets(): TrackDef[] {
  return [pinewoodShort(), copperlineOval(), harbourStreets(), ventoRing(), kestrelPark()]
}

export function isPresetId(id: string): boolean {
  return id.startsWith('preset-')
}
