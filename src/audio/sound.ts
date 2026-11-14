import { engineNote, flagTune } from './notes'

/**
 * Every sound in GridMind is made here, in the browser, from oscillators and
 * filtered noise: there are no audio files to download.
 *
 * Browsers only let a page make sound after the user has clicked or pressed
 * a key, so the audio context is created on the first such gesture and
 * anything asked for before then is simply not played.
 */

const PREFERENCE = 'gridmind:sound'

type Wave = OscillatorType

interface ToneSpec {
  frequency: number
  /** Seconds from now. */
  at?: number
  duration: number
  wave?: Wave
  gain?: number
  /** Pitch to glide to by the end of the note. */
  slideTo?: number
}

interface NoiseSpec {
  at?: number
  duration: number
  gain?: number
  /** Centre of the band the noise is filtered to (Hz). */
  band: number
}

interface EngineVoice {
  oscillators: OscillatorNode[]
  filter: BiquadFilterNode
  gain: GainNode
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE) !== 'off'
  } catch {
    return true
  }
}

class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private engine: EngineVoice | null = null
  private listeners = new Set<() => void>()
  private on = typeof window !== 'undefined' ? readPreference() : false
  /** One-shot sounds started since the page loaded: lets a check see that something played. */
  played = 0

  constructor() {
    if (typeof window === 'undefined') return
    // The first click or key press is what allows sound at all.
    const unlock = () => {
      if (this.on) void this.context()?.resume()
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock, { passive: true })
    // A tab in the background stops drawing; its engine should not drone on.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.engineStop()
    })
  }

  get enabled(): boolean {
    return this.on
  }

  setEnabled(on: boolean): void {
    this.on = on
    try {
      window.localStorage.setItem(PREFERENCE, on ? 'on' : 'off')
    } catch {
      // Without storage the choice lasts for this visit only.
    }
    if (on) void this.context()?.resume()
    else this.engineStop()
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.02)
    for (const listener of this.listeners) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The audio context, made on first use. Null where there is no Web Audio. */
  private context(): AudioContext | null {
    if (this.ctx) return this.ctx
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null
    try {
      this.ctx = new window.AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.on ? 0.5 : 0
      this.master.connect(this.ctx.destination)
    } catch {
      this.ctx = null
    }
    return this.ctx
  }

  /** The context, if sound is on and the browser has let it start. */
  private ready(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.on) return null
    const ctx = this.context()
    if (!ctx || !this.master || ctx.state !== 'running') return null
    return { ctx, out: this.master }
  }

  private tone(spec: ToneSpec): void {
    const audio = this.ready()
    if (!audio) return
    const { ctx, out } = audio
    const start = ctx.currentTime + (spec.at ?? 0)
    const end = start + spec.duration
    const osc = ctx.createOscillator()
    osc.type = spec.wave ?? 'sine'
    osc.frequency.setValueAtTime(spec.frequency, start)
    if (spec.slideTo) osc.frequency.exponentialRampToValueAtTime(spec.slideTo, end)
    const gain = ctx.createGain()
    const level = spec.gain ?? 0.2
    // A few milliseconds of fade either end, or every note clicks.
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(level, start + 0.008)
    gain.gain.setValueAtTime(level, Math.max(start + 0.008, end - 0.03))
    gain.gain.linearRampToValueAtTime(0, end)
    osc.connect(gain).connect(out)
    osc.start(start)
    osc.stop(end + 0.02)
    this.played++
  }

  private noise(spec: NoiseSpec): void {
    const audio = this.ready()
    if (!audio) return
    const { ctx, out } = audio
    if (!this.noiseBuffer) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      // A fixed sequence: the sounds are the same every time.
      let seed = 0x2f6e2b1
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        data[i] = seed / 0x80000000 - 1
      }
      this.noiseBuffer = buffer
    }
    const start = ctx.currentTime + (spec.at ?? 0)
    const end = start + spec.duration
    const source = ctx.createBufferSource()
    source.buffer = this.noiseBuffer
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = spec.band
    filter.Q.value = 1.2
    const gain = ctx.createGain()
    const level = spec.gain ?? 0.2
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(level, start + 0.01)
    gain.gain.linearRampToValueAtTime(0, end)
    source.connect(filter).connect(gain).connect(out)
    source.start(start)
    source.stop(end + 0.02)
    this.played++
  }

  // ---------- Named sounds ----------

  /** The start: five lights come on, then go out. */
  lights(): void {
    for (let i = 0; i < 5; i++) this.tone({ frequency: 440, at: i * 0.16, duration: 0.09, wave: 'square', gain: 0.07 })
    this.tone({ frequency: 880, at: 5 * 0.16 + 0.1, duration: 0.45, wave: 'square', gain: 0.08 })
  }

  /** The click of the radio opening, pitched by what kind of message it is. */
  radio(tone: 'info' | 'good' | 'warn'): void {
    if (tone === 'warn') {
      this.tone({ frequency: 620, duration: 0.07, wave: 'triangle', gain: 0.12 })
      this.tone({ frequency: 620, at: 0.11, duration: 0.07, wave: 'triangle', gain: 0.12 })
    } else if (tone === 'good') {
      this.tone({ frequency: 660, duration: 0.07, wave: 'triangle', gain: 0.1 })
      this.tone({ frequency: 990, at: 0.08, duration: 0.1, wave: 'triangle', gain: 0.1 })
    } else {
      this.tone({ frequency: 780, duration: 0.06, wave: 'triangle', gain: 0.08 })
    }
  }

  /** The clock has stopped for a call. */
  decision(): void {
    this.tone({ frequency: 523, duration: 0.12, gain: 0.14 })
    this.tone({ frequency: 784, at: 0.13, duration: 0.2, gain: 0.14 })
  }

  safetyCar(): void {
    for (let i = 0; i < 3; i++) {
      this.tone({ frequency: 700, at: i * 0.3, duration: 0.14, wave: 'square', gain: 0.05 })
      this.tone({ frequency: 520, at: i * 0.3 + 0.15, duration: 0.14, wave: 'square', gain: 0.05 })
    }
  }

  /** Four wheel guns, off and on. */
  pitStop(): void {
    for (let i = 0; i < 4; i++) {
      const at = i * 0.07
      this.noise({ at, duration: 0.16, band: 2600, gain: 0.16 })
      this.tone({ frequency: 180, at, duration: 0.16, wave: 'sawtooth', gain: 0.04, slideTo: 420 })
    }
    for (let i = 0; i < 4; i++) {
      const at = 0.55 + i * 0.07
      this.noise({ at, duration: 0.18, band: 3000, gain: 0.16 })
      this.tone({ frequency: 420, at, duration: 0.18, wave: 'sawtooth', gain: 0.04, slideTo: 200 })
    }
  }

  /** The chequered flag, for a car finishing in `position`. */
  flag(position: number): void {
    flagTune(position).forEach((frequency, i) => {
      this.tone({ frequency, at: i * 0.13, duration: i === 0 ? 0.12 : 0.22, wave: 'triangle', gain: 0.14 })
    })
  }

  /** Money spent well. */
  buy(): void {
    this.tone({ frequency: 1318, duration: 0.07, gain: 0.1 })
    this.tone({ frequency: 1760, at: 0.07, duration: 0.18, gain: 0.1 })
  }

  /** Through to the next part of qualifying, or pole. */
  through(): void {
    this.tone({ frequency: 587, duration: 0.09, wave: 'triangle', gain: 0.12 })
    this.tone({ frequency: 880, at: 0.1, duration: 0.2, wave: 'triangle', gain: 0.12 })
  }

  /** Knocked out. */
  knockedOut(): void {
    this.tone({ frequency: 392, duration: 0.14, wave: 'triangle', gain: 0.12 })
    this.tone({ frequency: 277, at: 0.15, duration: 0.3, wave: 'triangle', gain: 0.12 })
  }

  /** A soft tick for something finishing: a practice session, a study. */
  done(): void {
    this.tone({ frequency: 880, duration: 0.08, gain: 0.08 })
  }

  crash(): void {
    this.noise({ duration: 0.5, band: 500, gain: 0.35 })
    this.tone({ frequency: 120, duration: 0.4, wave: 'sawtooth', gain: 0.1, slideTo: 40 })
  }

  // ---------- The engine ----------

  /** Starts the engine note, if sound is on and it is not already running. */
  engineStart(): void {
    const audio = this.ready()
    if (!audio || this.engine) return
    const { ctx, out } = audio
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400
    filter.Q.value = 3
    const gain = ctx.createGain()
    gain.gain.value = 0
    filter.connect(gain).connect(out)
    // Two saws a few cents apart, and a square an octave down for the body of it.
    const oscillators = [
      { wave: 'sawtooth' as Wave, detune: 0 },
      { wave: 'sawtooth' as Wave, detune: 9 },
      { wave: 'square' as Wave, detune: -1200 },
    ].map(({ wave, detune }) => {
      const osc = ctx.createOscillator()
      osc.type = wave
      osc.detune.value = detune
      osc.frequency.value = 50
      osc.connect(filter)
      osc.start()
      return osc
    })
    this.engine = { oscillators, filter, gain }
  }

  /**
   * Moves the engine note to where the car is now.
   *
   * @param speedFraction road speed as a fraction of top speed
   * @param throttle 0 (off) to 1 (flat out)
   */
  engineUpdate(speedFraction: number, throttle: number): void {
    // The first frames of a drive can come before the browser lets sound start.
    if (!this.engine) this.engineStart()
    const voice = this.engine
    const ctx = this.ctx
    if (!voice || !ctx) return
    const note = engineNote(speedFraction)
    const now = ctx.currentTime
    for (const osc of voice.oscillators) osc.frequency.setTargetAtTime(note.frequency, now, 0.04)
    // On the throttle the note is louder and brighter; off it, the engine burbles.
    voice.filter.frequency.setTargetAtTime(350 + 1500 * note.revs * (0.45 + 0.55 * throttle), now, 0.06)
    voice.gain.gain.setTargetAtTime(0.035 + 0.07 * throttle, now, 0.08)
  }

  engineStop(): void {
    const voice = this.engine
    this.engine = null
    if (!voice || !this.ctx) return
    const now = this.ctx.currentTime
    voice.gain.gain.setTargetAtTime(0, now, 0.05)
    for (const osc of voice.oscillators) osc.stop(now + 0.3)
  }

  /** The audio clock, for rate limits; 0 before any sound is possible. */
  now(): number {
    return this.ctx?.currentTime ?? 0
  }

  /** Whether the browser has let the page make sound yet. */
  get running(): boolean {
    return this.ctx?.state === 'running'
  }
}

export const sound = new Sound()
