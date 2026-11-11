import { wrap } from '../math/util'
import type { BuiltTrack } from '../track/types'
import type { CarInput, CarState } from './car'

/**
 * Car-to-car interaction: slipstream, DRS and contact.
 *
 * Everything here works in track coordinates (distance along the lap and
 * offset across the road). Racing cars point along the track almost all the
 * time, so treating each one as a box aligned with the road is both cheap
 * and close enough.
 */

/** Footprint used for contact, slightly inside the bodywork (m). */
export const CONTACT_LENGTH = 5.0
export const CONTACT_WIDTH = 1.9

/** A car this close behind another, and roughly in line, gets a tow. */
const TOW_RANGE = 70
const TOW_HALF_WIDTH = 2.2
/** Contacts between the same two cars closer together than this are one incident (s). */
const INCIDENT_GAP = 1.5
/** Largest share of drag removed by a tow. */
const TOW_MAX = 0.28
/** Share of drag removed by an open DRS flap. */
const DRS_EFFECT = 0.22
/** DRS opens only when this close (seconds) to the car ahead on entering a zone. */
const DRS_GAP = 1.0

export interface TrafficState {
  /** Drag multiplier per car for the next physics step (1 = clean air). */
  drag: Float32Array
  /** 1 while a car's DRS is open. */
  drs: Uint8Array
  /** Zone a car was in at the previous step (-1 = none), to detect zone entry. */
  zone: Int8Array
  /** Seconds each car has spent touching another. */
  contactTime: Float32Array
  /** Blame points: 1 + closing speed / 5 for running into the back of someone, 0.5 each for side contact. */
  fault: Float32Array
  /** Number of separate contacts each car has been involved in. */
  hits: Uint16Array
  /**
   * Clock time each pair last touched. Cars that bump, separate and bump again
   * within a moment are having one incident, not several.
   */
  lastTouch: Float32Array
  /** Seconds of racing seen by resolveContacts. */
  clock: number
}

export function createTrafficState(count: number): TrafficState {
  return {
    drag: new Float32Array(count).fill(1),
    drs: new Uint8Array(count),
    zone: new Int8Array(count).fill(-1),
    contactTime: new Float32Array(count),
    fault: new Float32Array(count),
    hits: new Uint16Array(count),
    lastTouch: new Float32Array(count * count).fill(-Infinity),
    clock: 0,
  }
}

export function resetTrafficState(state: TrafficState): void {
  state.drag.fill(1)
  state.drs.fill(0)
  state.zone.fill(-1)
  state.contactTime.fill(0)
  state.fault.fill(0)
  state.hits.fill(0)
  state.lastTouch.fill(-Infinity)
  state.clock = 0
}

/** Signed distance along the lap from car `a` to car `b`, in (-L/2, L/2]; positive = b is ahead. */
export function gapAlong(track: BuiltTrack, a: CarState, b: CarState): number {
  let d = b.s - a.s
  const half = track.length / 2
  if (d > half) d -= track.length
  else if (d <= -half) d += track.length
  return d
}

function zoneAt(track: BuiltTrack, s: number): number {
  const zones = track.def.drsZones
  const f = s / track.length
  for (let z = 0; z < zones.length; z++) {
    const span = wrap(zones[z].end - zones[z].start, 1)
    if (wrap(f - zones[z].start, 1) < span) return z
  }
  return -1
}

/**
 * Works out each car's drag multiplier for the coming step from the tow it
 * is getting and whether its DRS is open.
 *
 * @param active   1 for cars still racing.
 * @param drsEnabled whether DRS may be used at all yet (not on the opening lap).
 */
export function updateAero(
  cars: readonly CarState[],
  inputs: readonly CarInput[],
  active: Uint8Array,
  track: BuiltTrack,
  state: TrafficState,
  drsEnabled: boolean,
): void {
  const n = cars.length
  for (let i = 0; i < n; i++) {
    state.drag[i] = 1
    if (!active[i]) {
      state.drs[i] = 0
      continue
    }
    const car = cars[i]

    // Nearest car ahead: for the tow and for the DRS gap.
    let tow = 0
    let nearest = Infinity
    for (let j = 0; j < n; j++) {
      if (j === i || !active[j]) continue
      const gap = gapAlong(track, car, cars[j])
      if (gap <= 0.5) continue
      if (gap < nearest) nearest = gap
      if (gap < TOW_RANGE && Math.abs(cars[j].lateral - car.lateral) < TOW_HALF_WIDTH) {
        tow = Math.max(tow, TOW_MAX * (1 - gap / TOW_RANGE))
      }
    }

    // DRS is decided once, on entering a zone, and closes under braking.
    const zone = zoneAt(track, car.s)
    if (zone !== state.zone[i]) {
      state.zone[i] = zone
      state.drs[i] = zone >= 0 && drsEnabled && nearest / Math.max(car.speed, 10) < DRS_GAP ? 1 : 0
    }
    if (state.drs[i] && inputs[i].brake > 0.1) state.drs[i] = 0

    state.drag[i] = (1 - tow) * (state.drs[i] ? 1 - DRS_EFFECT : 1)
  }
}

/**
 * Finds overlapping cars, pushes them apart and takes speed off them.
 * Returns the number of new contacts that began this step.
 */
export function resolveContacts(
  cars: CarState[],
  active: Uint8Array,
  track: BuiltTrack,
  state: TrafficState,
  dt: number,
): number {
  const n = cars.length
  let started = 0
  state.clock += dt
  for (let i = 0; i < n; i++) {
    if (!active[i]) continue
    for (let j = i + 1; j < n; j++) {
      if (!active[j]) continue
      const pair = i * n + j
      const a = cars[i]
      const b = cars[j]
      const ds = gapAlong(track, a, b)
      const dl = b.lateral - a.lateral
      const overlapS = CONTACT_LENGTH - Math.abs(ds)
      const overlapL = CONTACT_WIDTH - Math.abs(dl)
      if (overlapS <= 0 || overlapL <= 0) continue

      const isNew = state.clock - state.lastTouch[pair] > INCIDENT_GAP
      state.lastTouch[pair] = state.clock
      state.contactTime[i] += dt
      state.contactTime[j] += dt
      if (isNew) {
        started++
        state.hits[i]++
        state.hits[j]++
      }

      // Separate along whichever axis needs the smaller move.
      if (overlapL * CONTACT_LENGTH < overlapS * CONTACT_WIDTH) {
        // Side by side: wheel-banging. Both lose a little speed.
        const push = (overlapL / 2 + 0.02) * (dl >= 0 ? 1 : -1)
        shiftAcross(track, a, -push)
        shiftAcross(track, b, push)
        const rub = 1 - 0.6 * dt
        a.speed *= rub
        b.speed *= rub
        if (isNew) {
          state.fault[i] += 0.5
          state.fault[j] += 0.5
        }
      } else {
        // Nose to tail: the car behind is at fault and takes the speed loss.
        const rear = ds >= 0 ? a : b
        const front = ds >= 0 ? b : a
        const rearIndex = ds >= 0 ? i : j
        const closing = rear.speed - front.speed
        if (closing > 0) {
          front.speed += closing * 0.25
          rear.speed = Math.max(0, front.speed - closing * 0.25 - 0.5)
          if (isNew) state.fault[rearIndex] += 1 + closing / 5
        } else if (isNew) {
          state.fault[rearIndex] += 0.5
        }
        const push = overlapS / 2 + 0.02
        shiftAlong(track, rear, -push)
        shiftAlong(track, front, push)
      }
    }
  }
  return started
}

/** Moves a car sideways across the road; positive = to the left. */
function shiftAcross(track: BuiltTrack, car: CarState, amount: number): void {
  const i = car.index
  car.x += track.ty[i] * amount
  car.y -= track.tx[i] * amount
  car.lateral += amount
}

/** Moves a car along the road; positive = forwards. */
function shiftAlong(track: BuiltTrack, car: CarState, amount: number): void {
  const i = car.index
  car.x += track.tx[i] * amount
  car.y += track.ty[i] * amount
  car.s = wrap(car.s + amount, track.length)
}
