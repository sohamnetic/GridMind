import { describe, expect, it } from 'vitest'
import { analyseTrack, isDrivable, validateTrack } from '../src/core/track/analysis'
import {
  arcPosition,
  buildTrack,
  lateralOffset,
  locateGlobal,
  locateNear,
  poseAt,
  surfaceAt,
} from '../src/core/track/build'
import { createPresets, roundedPolygon } from '../src/core/track/presets'
import { createTrack, parseTrack, reverseTrack, trackToJson } from '../src/core/track/serialize'
import { strokeToControlPoints } from '../src/core/track/simplify'
import { Surface } from '../src/core/track/types'

function circleTrack(radius: number, count = 16) {
  const points = Array.from({ length: count }, (_, k) => {
    const a = (2 * Math.PI * k) / count
    return { x: radius * Math.cos(a), y: radius * Math.sin(a) }
  })
  return createTrack('Circle', points, 'circle')
}

describe('buildTrack', () => {
  it('returns null for fewer than three points', () => {
    expect(buildTrack(createTrack('Empty'))).toBeNull()
    expect(buildTrack(createTrack('Two', [{ x: 0, y: 0 }, { x: 100, y: 0 }]))).toBeNull()
  })

  it('samples a circle with the right length, spacing and curvature', () => {
    const track = buildTrack(circleTrack(200))!
    expect(track.length).toBeGreaterThan(2 * Math.PI * 200 * 0.99)
    expect(track.length).toBeLessThan(2 * Math.PI * 200 * 1.01)
    expect(track.step).toBeGreaterThan(1.9)
    expect(track.step).toBeLessThan(2.1)

    // Uniform spacing between consecutive samples.
    for (let i = 0; i < track.n; i++) {
      const j = (i + 1) % track.n
      const d = Math.hypot(track.x[j] - track.x[i], track.y[j] - track.y[i])
      expect(d).toBeGreaterThan(track.step * 0.97)
      expect(d).toBeLessThan(track.step * 1.03)
    }

    // Angle increases with index and y points down, so this is a right-hand circle.
    const mean = track.curvature.reduce((a, b) => a + b, 0) / track.n
    expect(mean).toBeCloseTo(1 / 200, 3)
  })

  it('applies per-point width overrides', () => {
    const def = circleTrack(200)
    def.points[0].width = 18
    const track = buildTrack(def)!
    expect(track.uniformWidth).toBe(false)
    expect(track.halfWidth[track.ctrlSample[0]]).toBeCloseTo(9, 0)
    expect(track.halfWidth[track.ctrlSample[8]]).toBeCloseTo(def.width / 2, 1)
  })

  it('locates positions and classifies surfaces', () => {
    const def = circleTrack(200)
    const track = buildTrack(def)!
    const s = 300
    const centre = poseAt(track, s)
    const i = locateGlobal(track, centre.x, centre.y)
    expect(locateNear(track, centre.x, centre.y, i + 5)).toBe(i)
    expect(arcPosition(track, i, centre.x, centre.y)).toBeCloseTo(s, 0)
    expect(lateralOffset(track, i, centre.x, centre.y)).toBeCloseTo(0, 1)

    const left = poseAt(track, s, 4)
    expect(lateralOffset(track, locateGlobal(track, left.x, left.y), left.x, left.y)).toBeCloseTo(4, 1)

    const hw = def.width / 2
    expect(surfaceAt(track, i, hw - 0.5)).toBe(Surface.Track)
    expect(surfaceAt(track, i, -(hw + 0.5))).toBe(Surface.Kerb)
    expect(surfaceAt(track, i, hw + def.kerbWidth + 1)).toBe(Surface.Gravel)
    expect(surfaceAt(track, i, hw + def.kerbWidth + def.runoffWidth + 1)).toBe(Surface.Wall)
  })

  it('places the left side on the outside of a right-hand circle', () => {
    const track = buildTrack(circleTrack(200))!
    const left = poseAt(track, 100, 5)
    const right = poseAt(track, 100, -5)
    expect(Math.hypot(left.x, left.y)).toBeGreaterThan(Math.hypot(right.x, right.y))
  })
})

describe('analyseTrack', () => {
  it('treats a constant-radius circle as one continuous corner', () => {
    const analysis = analyseTrack(buildTrack(circleTrack(120))!)
    expect(analysis.corners).toHaveLength(1)
    expect(analysis.corners[0].direction).toBe('R')
    expect(analysis.corners[0].angle).toBeGreaterThan(350)
    expect(analysis.minRadius).toBeGreaterThan(110)
    expect(analysis.minRadius).toBeLessThan(130)
  })

  it('finds no corners on a very large circle', () => {
    const analysis = analyseTrack(buildTrack(circleTrack(1200, 40))!)
    expect(analysis.corners).toHaveLength(0)
    expect(analysis.longestStraight).toBeCloseTo(analysis.length, 5)
  })

  it('counts the four corners and the straights of a rounded rectangle', () => {
    const def = createTrack(
      'Rectangle',
      roundedPolygon(
        [
          [-500, -200],
          [500, -200],
          [500, 200],
          [-500, 200],
        ],
        40,
      ),
    )
    const analysis = analyseTrack(buildTrack(def)!)
    expect(analysis.corners).toHaveLength(4)
    expect(analysis.corners.every((c) => c.direction === 'R')).toBe(true)
    for (const c of analysis.corners) {
      expect(c.angle).toBeGreaterThan(75)
      expect(c.angle).toBeLessThan(105)
    }
    expect(analysis.longestStraight).toBeGreaterThan(800)
    expect(analysis.longestStraight).toBeLessThan(1000)
    expect(analysis.corners.map((c) => c.number)).toEqual([1, 2, 3, 4])
  })

  it('keeps a straight that spans the start line in one piece', () => {
    const def = createTrack(
      'Rectangle',
      roundedPolygon(
        [
          [-500, -200],
          [500, -200],
          [500, 200],
          [-500, 200],
        ],
        40,
      ),
    )
    const base = analyseTrack(buildTrack(def)!).longestStraight
    def.startFraction = 0.2 // middle of the first long straight
    expect(analyseTrack(buildTrack(def)!).longestStraight).toBeCloseTo(base, 0)
  })
})

describe('validateTrack', () => {
  it('rejects a track that is too short', () => {
    const issues = validateTrack(buildTrack(circleTrack(40))!)
    expect(isDrivable(issues)).toBe(false)
  })

  it('rejects a figure of eight', () => {
    const def = createTrack('Eight', [
      { x: -300, y: -150 },
      { x: 300, y: 150 },
      { x: 300, y: -150 },
      { x: -300, y: 150 },
    ])
    const issues = validateTrack(buildTrack(def)!)
    expect(issues.some((i) => i.level === 'error' && /overlap|cross/.test(i.message))).toBe(true)
  })

  it('rejects a corner tighter than the track width', () => {
    const def = createTrack('Spike', [
      { x: -300, y: 0 },
      { x: 0, y: -200 },
      { x: 300, y: 0 },
      { x: 12, y: 200 },
      { x: 0, y: 190 },
      { x: -12, y: 200 },
    ])
    def.width = 20
    const issues = validateTrack(buildTrack(def)!)
    expect(issues.some((i) => i.level === 'error' && /tighter/.test(i.message))).toBe(true)
  })
})

describe('presets', () => {
  const presets = createPresets()

  it('have unique ids and names', () => {
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length)
    expect(new Set(presets.map((p) => p.name)).size).toBe(presets.length)
  })

  for (const def of presets) {
    it(`${def.name} builds and is drivable`, () => {
      const track = buildTrack(def)
      expect(track).not.toBeNull()
      const issues = validateTrack(track!)
      expect(issues.filter((i) => i.level === 'error')).toEqual([])
      const analysis = analyseTrack(track!)
      expect(analysis.length).toBeGreaterThan(1000)
      expect(analysis.corners.length).toBeGreaterThanOrEqual(2)
    })
  }
})

describe('serialisation', () => {
  it('round-trips a preset through JSON', () => {
    for (const def of createPresets()) {
      expect(parseTrack(trackToJson(def))).toEqual(def)
    }
  })

  it('rejects data that is not a track', () => {
    expect(() => parseTrack('not json')).toThrow(/JSON/)
    expect(() => parseTrack({ version: 99, points: [] })).toThrow(/version/)
    expect(() => parseTrack({ version: 1 })).toThrow(/control points/)
    expect(() => parseTrack({ version: 1, points: [{ x: 'a', y: 0 }] })).toThrow(/Control point 1/)
  })

  it('clamps out-of-range values and fills defaults', () => {
    const def = parseTrack({
      version: 1,
      points: [
        { x: 0, y: 0, width: 500 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      width: 1,
      startFraction: 1.25,
    })
    expect(def.width).toBe(8)
    expect(def.points[0].width).toBe(20)
    expect(def.startFraction).toBeCloseTo(0.25)
    expect(def.name).toBe('Untitled circuit')
    expect(def.pit).toBeNull()
  })

  it('reverses direction without moving markers on the ground', () => {
    const def = createPresets()[0]
    const forward = buildTrack(def)!
    const reversed = buildTrack(reverseTrack(def))!
    expect(reversed.length).toBeCloseTo(forward.length, 3)
    const a = poseAt(forward, def.startFraction * forward.length)
    const b = poseAt(reversed, reversed.def.startFraction * reversed.length)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(3)
    const twice = reverseTrack(reverseTrack(def))
    expect(twice.points).toEqual(def.points)
    expect(twice.startFraction).toBeCloseTo(def.startFraction, 9)
    expect(twice.sectors[0]).toBeCloseTo(def.sectors[0], 9)
    expect(twice.pit?.side).toBe(def.pit?.side)
  })
})

describe('strokeToControlPoints', () => {
  it('reduces a noisy freehand loop to a few control points', () => {
    const stroke = Array.from({ length: 600 }, (_, k) => {
      const a = (2 * Math.PI * k) / 600
      const wobble = 3 * Math.sin(k * 1.7)
      return { x: (400 + wobble) * Math.cos(a), y: (250 + wobble) * Math.sin(a) }
    })
    const points = strokeToControlPoints(stroke)!
    expect(points.length).toBeGreaterThanOrEqual(6)
    expect(points.length).toBeLessThanOrEqual(40)
    const track = buildTrack(createTrack('Freehand', points))!
    expect(isDrivable(validateTrack(track))).toBe(true)
    expect(track.length).toBeGreaterThan(1800)
    expect(track.length).toBeLessThan(2300)
  })

  it('rejects a stroke that is too small', () => {
    expect(strokeToControlPoints([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBeNull()
    const dot = Array.from({ length: 50 }, (_, k) => ({ x: Math.cos(k) * 10, y: Math.sin(k) * 10 }))
    expect(strokeToControlPoints(dot)).toBeNull()
  })
})
