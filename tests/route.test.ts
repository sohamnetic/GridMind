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

  it('falls back to the studio for empty or unknown hashes', () => {
    expect(parseRoute('')).toBe('studio')
    expect(parseRoute('#/')).toBe('studio')
    expect(parseRoute('#/nope')).toBe('studio')
  })
})
