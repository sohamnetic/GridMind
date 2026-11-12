import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeFloats, encodeFloats, isDriverFile } from '../src/core/evolution/driverFile'
import { DRIVER_LAYOUT, simulateDriver } from '../src/core/evolution/trainer'
import { buildTrack } from '../src/core/track/build'
import { createPresets } from '../src/core/track/presets'
import { trackKey } from '../src/core/track/serialize'

describe('driver files', () => {
  it('store weights exactly', () => {
    const values = Float32Array.from([0, 1, -1, 0.1, 1e-7, 123456.789, -3.25e12, Math.PI])
    expect(Array.from(decodeFloats(encodeFloats(values)))).toEqual(Array.from(values))
    const many = Float32Array.from({ length: 70_000 }, (_, i) => Math.sin(i))
    expect(decodeFloats(encodeFloats(many))).toEqual(many)
    expect(decodeFloats(encodeFloats(new Float32Array(0))).length).toBe(0)
  })

  it('are recognised by their shape', () => {
    expect(isDriverFile(null)).toBe(false)
    expect(isDriverFile({ version: 1 })).toBe(false)
    expect(
      isDriverFile({ version: 1, trackId: 'x', trackKey: 'k', layout: [1], populationSize: 1, population: '', history: [] }),
    ).toBe(true)
  })
})

/**
 * The drivers shipped with the presets were trained on the presets and the
 * physics as they were then. If either changes, the files must be made
 * again (npm run sim:pretrain): this is the test that says so.
 */
describe('pre-trained drivers for the presets', () => {
  for (const def of createPresets()) {
    it(`${def.name}: the bundled champion still drives its lap`, () => {
      const path = `public/drivers/${def.id}.json`
      expect(existsSync(path)).toBe(true)
      const file: unknown = JSON.parse(readFileSync(path, 'utf8'))
      expect(isDriverFile(file)).toBe(true)
      if (!isDriverFile(file)) return
      expect(file.trackId).toBe(def.id)
      expect(file.trackKey).toBe(trackKey(def))
      expect(file.layout).toEqual([...DRIVER_LAYOUT.sizes])

      const population = decodeFloats(file.population)
      expect(population.length).toBe(file.populationSize * DRIVER_LAYOUT.weightCount)
      // A wheel-to-wheel race puts twenty cars on the grid.
      expect(file.populationSize).toBeGreaterThanOrEqual(20)
      expect(file.recordLap).not.toBeNull()
      expect(file.recordGenome).not.toBeNull()
      expect(file.ghost).not.toBeNull()
      expect(decodeFloats(file.ghost!).length % 3).toBe(0)

      const track = buildTrack(def)!
      const champion = decodeFloats(file.recordGenome!)
      expect(Array.from(population.subarray(0, champion.length))).toEqual(Array.from(champion))
      const run = simulateDriver(track, champion)
      expect(run.bestLap).not.toBeNull()
      expect(run.bestLap!).toBeCloseTo(file.recordLap!, 2)

      // Enough of the others get round for a full grid.
      let lappers = 0
      for (let i = 0; i < 24; i++) {
        const genome = population.subarray(i * champion.length, (i + 1) * champion.length)
        if (simulateDriver(track, genome, { laps: 1 }).bestLap !== null) lappers++
      }
      expect(lappers).toBeGreaterThanOrEqual(20)
    })
  }
})
