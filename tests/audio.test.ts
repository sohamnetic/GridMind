import { describe, expect, it } from 'vitest'
import { engineNote, flagTune, GEARS, rateLimiter } from '../src/audio/notes'

describe('engine note', () => {
  it('idles at a standstill and reaches the limiter at top speed', () => {
    const idle = engineNote(0)
    const flat = engineNote(1)
    expect(idle.gear).toBe(1)
    expect(flat.gear).toBe(GEARS)
    expect(flat.revs).toBe(1)
    expect(idle.frequency).toBeLessThan(80)
    expect(flat.frequency).toBeGreaterThan(idle.frequency * 2)
  })

  it('climbs through each gear and drops at the change', () => {
    let changes = 0
    let previous = engineNote(0)
    for (let s = 0.005; s <= 1; s += 0.005) {
      const note = engineNote(s)
      if (note.gear === previous.gear) expect(note.frequency).toBeGreaterThanOrEqual(previous.frequency)
      else {
        changes++
        expect(note.gear).toBe(previous.gear + 1)
        expect(note.frequency).toBeLessThan(previous.frequency)
      }
      previous = note
    }
    expect(changes).toBe(GEARS - 1)
  })

  it('copes with speeds it should never be given', () => {
    expect(engineNote(-1)).toEqual(engineNote(0))
    expect(engineNote(3)).toEqual(engineNote(1))
    expect(engineNote(Number.NaN)).toEqual(engineNote(0))
  })
})

describe('flag tune', () => {
  it('is longer the better the result, and always rises', () => {
    expect(flagTune(1).length).toBeGreaterThan(flagTune(3).length)
    expect(flagTune(3).length).toBeGreaterThan(flagTune(8).length)
    expect(flagTune(8).length).toBeGreaterThan(flagTune(15).length)
    for (const place of [1, 2, 7, 18]) {
      const tune = flagTune(place)
      for (let i = 1; i < tune.length; i++) expect(tune[i]).toBeGreaterThan(tune[i - 1])
    }
  })
})

describe('rate limiter', () => {
  it('lets a sound through no more often than its gap', () => {
    const allow = rateLimiter(1)
    expect(allow(10)).toBe(true)
    expect(allow(10.4)).toBe(false)
    expect(allow(10.99)).toBe(false)
    expect(allow(11.01)).toBe(true)
    expect(allow(11.5)).toBe(false)
  })
})
