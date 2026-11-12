import { parseTrack } from '../core/track/serialize'
import type { TrackDef } from '../core/track/types'

/**
 * A circuit packed into a link.
 *
 * There is no server to store shared circuits on, so the link carries the
 * circuit itself: its JSON, compressed with the browser's own deflate and
 * written in URL-safe base64 after the route (`#/studio?track=...`). The
 * hash never leaves the browser, so nothing is uploaded anywhere.
 */

/** First character of the payload says how it was packed: 'z' deflated, 'j' plain JSON. */
const DEFLATED = 'z'
const PLAIN = 'j'
/** Longest payload accepted, so a hostile link cannot make the page inflate something huge. */
const MAX_PAYLOAD = 200_000

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  // Awaited together with the read, so a stream that fails on bad input rejects here and nowhere else.
  const written = writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close())
  const [buffer] = await Promise.all([new Response(stream.readable).arrayBuffer(), written])
  return new Uint8Array(buffer)
}

/** The circuit as link text. The id is left out: whoever opens the link gets their own copy. */
export async function encodeTrack(def: TrackDef): Promise<string> {
  const { id: _id, ...rest } = def
  void _id
  const bytes = new TextEncoder().encode(JSON.stringify(rest))
  if (typeof CompressionStream === 'undefined') return PLAIN + toBase64Url(bytes)
  return DEFLATED + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))
}

/** Reads link text back into a circuit. Throws an Error with a readable message if it is not one. */
export async function decodeTrack(payload: string): Promise<TrackDef> {
  if (payload.length < 2 || payload.length > MAX_PAYLOAD) throw new Error('This link does not contain a circuit.')
  const kind = payload[0]
  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(payload.slice(1))
    if (kind === DEFLATED) {
      if (typeof DecompressionStream === 'undefined') throw new Error('unsupported')
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
    } else if (kind !== PLAIN) {
      throw new Error('unknown')
    }
  } catch {
    throw new Error('This link is damaged or was made by a newer version of GridMind.')
  }
  return parseTrack(new TextDecoder().decode(bytes))
}

const PARAM = 'track='

/** The circuit payload in a location hash such as `#/studio?track=z...`, or null. */
export function sharedTrackParam(hash: string): string | null {
  const query = hash.indexOf('?')
  if (query < 0) return null
  for (const part of hash.slice(query + 1).split('&')) {
    if (part.startsWith(PARAM)) return part.slice(PARAM.length) || null
  }
  return null
}

/** A link that opens `payload` in the Track Studio of the app at `base` (its URL without the hash). */
export function shareUrl(base: string, payload: string): string {
  return `${base.split('#')[0]}#/studio?${PARAM}${payload}`
}
