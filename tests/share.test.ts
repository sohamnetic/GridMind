import { describe, expect, it } from 'vitest'
import { createPresets } from '../src/core/track/presets'
import { reverseTrack } from '../src/core/track/serialize'
import { decodeTrack, encodeTrack, sharedTrackParam, shareUrl } from '../src/share/urlCodec'

describe('share links', () => {
  it('carry a circuit there and back, as a fresh copy', async () => {
    for (const def of createPresets()) {
      const payload = await encodeTrack(def)
      expect(payload).toMatch(/^[zj][A-Za-z0-9_-]+$/)
      const back = await decodeTrack(payload)
      expect(back.id).not.toBe(def.id)
      expect({ ...back, id: def.id }).toEqual(def)
    }
  })

  it('are short enough to paste anywhere', async () => {
    const payload = await encodeTrack(createPresets()[2])
    expect(payload.length).toBeLessThan(2000)
    const twice = await encodeTrack(reverseTrack(createPresets()[2]))
    expect(twice).not.toBe(payload)
  })

  it('sit after the route in the hash', async () => {
    const payload = await encodeTrack(createPresets()[0])
    const url = shareUrl('https://example.test/GridMind/#/race', payload)
    expect(url).toBe(`https://example.test/GridMind/#/studio?track=${payload}`)
    expect(sharedTrackParam(new URL(url).hash)).toBe(payload)
    expect(sharedTrackParam('#/studio')).toBeNull()
    expect(sharedTrackParam('#/studio?seed=4')).toBeNull()
    expect(sharedTrackParam('#/studio?seed=4&track=zabc')).toBe('zabc')
    expect(sharedTrackParam('#/studio?track=')).toBeNull()
  })

  it('reject links that are not circuits', async () => {
    await expect(decodeTrack('')).rejects.toThrow(/does not contain/)
    await expect(decodeTrack('q123')).rejects.toThrow(/damaged/)
    await expect(decodeTrack('z!!!not-base64!!!')).rejects.toThrow()
    await expect(decodeTrack('zAAAA')).rejects.toThrow()
    // Valid packing, wrong contents.
    const junk = 'j' + btoa(JSON.stringify({ hello: 'world' })).replace(/=+$/, '')
    await expect(decodeTrack(junk)).rejects.toThrow()
    await expect(decodeTrack('z' + 'A'.repeat(300_000))).rejects.toThrow(/does not contain/)
  })
})
