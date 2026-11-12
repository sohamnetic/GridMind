import { COMPOUNDS } from '../../core/race/tyres'
import { strategyLabel, type Strategy } from '../../core/race/strategy'

/** 1st, 2nd, 3rd, 4th ... */
export function ordinal(n: number): string {
  const tail = n % 100
  if (tail >= 11 && tail <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** A plan in words: "M-H: stop on lap 18 for hard". */
export function describePlan(strategy: Strategy): string {
  const stops = strategy.stops.map((s) => `lap ${s.lap} for ${COMPOUNDS[s.compound].label.toLowerCase()}`)
  return `${strategyLabel(strategy)}: stop on ${stops.join(', then ')}`
}

/** Budget in thousands of credits, as "1.25 M" or "375 k". */
export function money(thousands: number): string {
  return thousands >= 1000 ? `${(thousands / 1000).toFixed(2)} M` : `${thousands} k`
}

/** A signed gap in seconds: "+0.412". */
export function gap(seconds: number): string {
  return `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds).toFixed(3)}`
}
