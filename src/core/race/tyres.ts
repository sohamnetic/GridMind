/**
 * Tyre model for the lap-level race engine.
 *
 * All lap-time effects are written for a 90-second reference lap and scaled
 * by the circuit's own lap time, so a 30-second lap sees a third of the
 * seconds but the same proportions.
 */
export type Compound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet'
export type DriveMode = 'push' | 'normal' | 'conserve'

export const DRY_COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard']
export const ALL_COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet']

export interface CompoundSpec {
  id: Compound
  label: string
  /** Letter shown on timing screens. */
  short: string
  color: string
  dry: boolean
  /** Lap-time offset on fresh tyres against a fresh medium (s per reference lap). */
  pace: number
  /** Laps to wear the tyre out completely on an average circuit in its ideal conditions. */
  life: number
  /** Lap time lost over the tyre's whole life before the cliff (s per reference lap). */
  degLinear: number
}

export const COMPOUNDS: Record<Compound, CompoundSpec> = {
  soft: { id: 'soft', label: 'Soft', short: 'S', color: '#ff4d4d', dry: true, pace: -0.65, life: 17, degLinear: 1.5 },
  medium: { id: 'medium', label: 'Medium', short: 'M', color: '#ffd23f', dry: true, pace: 0, life: 27, degLinear: 1.25 },
  hard: { id: 'hard', label: 'Hard', short: 'H', color: '#f1f3f7', dry: true, pace: 0.55, life: 40, degLinear: 1.05 },
  inter: { id: 'inter', label: 'Intermediate', short: 'I', color: '#3ddc97', dry: false, pace: 0, life: 30, degLinear: 1.2 },
  wet: { id: 'wet', label: 'Wet', short: 'W', color: '#4aa8ff', dry: false, pace: 0, life: 36, degLinear: 1.0 },
}

/** Lap length the model's seconds are written for. */
export const REFERENCE_LAP = 90
/** Wear fraction at which grip starts to fall away sharply. */
export const CLIFF_WEAR = 0.8
const CLIFF_GAIN = 110

const MODE_PACE: Record<DriveMode, number> = { push: -0.25, normal: 0, conserve: 0.35 }
const MODE_WEAR: Record<DriveMode, number> = { push: 1.3, normal: 1, conserve: 0.75 }

/**
 * Lap time lost to tyre wear (s per reference lap): a steady climb with age,
 * then a steep one past the cliff.
 */
export function degradation(compound: Compound, wear: number): number {
  const over = Math.max(0, wear - CLIFF_WEAR)
  return COMPOUNDS[compound].degLinear * wear + CLIFF_GAIN * over * over
}

/**
 * Lap time lost to the conditions (s per reference lap) for a compound on a
 * track of the given wetness (0 = dry, 1 = standing water). Slicks are free
 * in the dry and hopeless in the wet; intermediates and wets are the reverse.
 */
export function conditionsPenalty(compound: Compound, wetness: number): number {
  const w = Math.min(1, Math.max(0, wetness))
  if (COMPOUNDS[compound].dry) {
    if (w <= 0.1) return 0
    const deep = Math.max(0, w - 0.3)
    return 3 * (w - 0.1) + 60 * deep * deep
  }
  if (compound === 'inter') {
    const tooDry = Math.max(0, 0.3 - w) / 0.3
    const tooWet = Math.max(0, w - 0.7)
    return 1.5 + 5 * tooDry + 40 * tooWet * tooWet
  }
  return 3 + 7 * (Math.max(0, 0.6 - w) / 0.6)
}

/** The quickest compound type for a track this wet. */
export function bestForConditions(wetness: number): 'dry' | 'inter' | 'wet' {
  const slick = conditionsPenalty('medium', wetness)
  const inter = conditionsPenalty('inter', wetness)
  const wet = conditionsPenalty('wet', wetness)
  if (slick <= inter && slick <= wet) return 'dry'
  return inter <= wet ? 'inter' : 'wet'
}

/**
 * Share of the tyre's life used in one lap.
 *
 * @param stress  circuit tyre stress (TrackProfile.tyreStress)
 * @param fuelShare fuel on board as a share of a full tank, 0..1 (a heavy car works its tyres harder)
 */
export function wearPerLap(
  compound: Compound,
  stress: number,
  mode: DriveMode,
  fuelShare: number,
  wetness: number,
): number {
  const spec = COMPOUNDS[compound]
  const w = Math.min(1, Math.max(0, wetness))
  let conditions: number
  if (spec.dry) conditions = 1 - 0.3 * Math.min(1, w / 0.5)
  // Rain tyres overheat and tear themselves up on a drying track.
  else if (compound === 'inter') conditions = 1 + 2.5 * (Math.max(0, 0.3 - w) / 0.3)
  else conditions = 1 + 3 * (Math.max(0, 0.5 - w) / 0.5)
  return (stress * MODE_WEAR[mode] * (1 + 0.15 * fuelShare) * conditions) / spec.life
}

export function modePace(mode: DriveMode): number {
  return MODE_PACE[mode]
}

/** Laps a fresh set lasts before reaching the cliff, on a dry (or suitably wet) track. */
export function lapsToCliff(compound: Compound, stress: number): number {
  return Math.floor(CLIFF_WEAR / wearPerLap(compound, stress, 'normal', 0.5, COMPOUNDS[compound].dry ? 0 : 0.5))
}
