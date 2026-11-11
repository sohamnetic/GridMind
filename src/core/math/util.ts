export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Wraps an integer index into [0, n). */
export function wrapIndex(i: number, n: number): number {
  // Almost every call is within one lap of the range; avoid the two divisions then.
  if (i >= 0) {
    if (i < n) return i
    if (i < 2 * n) return i - n
  } else if (i >= -n) {
    return i + n
  }
  return ((i % n) + n) % n
}

/** Wraps a value into [0, period). */
export function wrap(value: number, period: number): number {
  // Values already in range are returned untouched, so stored fractions do not
  // pick up floating-point noise each time they pass through here.
  if (value >= 0 && value < period) return value
  const r = value % period
  return r < 0 ? r + period : r
}

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI)
  if (r > Math.PI) r -= 2 * Math.PI
  else if (r <= -Math.PI) r += 2 * Math.PI
  return r
}

/** Hermite smoothstep on [0, 1]. */
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}
