import { describe, expect, it } from 'vitest'
import { parseRoute } from '../src/ui/app/useHashRoute'

describe('parseRoute', () => {
  it('maps hashes to module ids', () => {
    expect(parseRoute('#/studio')).toBe('studio')
    expect(parseRoute('#/pitwall')).toBe('pitwall')
    expect(parseRoute('#optimiser')).toBe('optimiser')
  })

  it('ignores trailing segments and queries', () => {
    expect(parseRoute('#/evolution/run/3')).toBe('evolution')
    expect(parseRoute('#/race?seed=4')).toBe('race')
  })

  it('falls back to the home page for empty or unknown hashes', () => {
    expect(parseRoute('')).toBe('home')
    expect(parseRoute('#/')).toBe('home')
    expect(parseRoute('#/home')).toBe('home')
    expect(parseRoute('#/nope')).toBe('home')
  })

  it('keeps a shared circuit link on the studio', () => {
    expect(parseRoute('#/studio?track=zabc')).toBe('studio')
  })
})
