/**
 * The arithmetic behind the sounds, kept apart from the Web Audio code so it
 * can be tested without a sound card.
 */

/** Gears the engine note steps through between a standstill and top speed. */
export const GEARS = 6

export interface EngineNote {
  /** 1 to GEARS. */
  gear: number
  /** Engine speed within the gear, 0 (idle) to 1 (the limiter). */
  revs: number
  /** Pitch of the note (Hz). */
  frequency: number
}

const IDLE_HZ = 48
const LIMIT_HZ = 205

/**
 * The engine note for a road speed, as a fraction of top speed. Revs climb
 * through each gear and drop back at the change, so the pitch saws upward
 * the way a real car's does.
 */
export function engineNote(speedFraction: number): EngineNote {
  const s = Math.min(1, Math.max(0, Number.isFinite(speedFraction) ? speedFraction : 0))
  const through = s * GEARS
  const gear = Math.min(GEARS - 1, Math.floor(through))
  const inGear = Math.min(1, through - gear)
  // First gear pulls away from idle; the others pick up from mid revs after the change.
  const revs = gear === 0 ? 0.12 + 0.88 * inGear : 0.5 + 0.5 * inGear
  return { gear: gear + 1, revs, frequency: IDLE_HZ + (LIMIT_HZ - IDLE_HZ) * revs }
}

/** Notes of the short tune played at the flag: brighter and longer the better the result. */
export function flagTune(position: number): number[] {
  const C = 261.63
  const major = [C, C * 1.25, C * 1.5, C * 2]
  if (position === 1) return [...major, C * 2.5, C * 3]
  if (position <= 3) return major
  if (position <= 10) return [C, C * 1.5, C * 2]
  return [C, C * 1.5]
}

/** Keeps a sound from repeating faster than `gap` seconds: returns whether it may play now. */
export function rateLimiter(gap: number): (now: number) => boolean {
  let last = -Infinity
  return (now) => {
    if (now - last < gap) return false
    last = now
    return true
  }
}
