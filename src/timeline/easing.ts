import BezierEasing from 'bezier-easing'
import type { EaseHandle } from '../store/schema'

// CSS-compatible cubic-bezier control points. These are the four values a
// keyframe carries; anything the UI offers as a named curve is just a label
// on one of these.
export const EASE_LINEAR: EaseHandle = [0, 0, 1, 1]
export const EASE_IN: EaseHandle = [0.42, 0, 1, 1]
export const EASE_OUT: EaseHandle = [0, 0, 0.58, 1]
export const EASE_IN_OUT: EaseHandle = [0.42, 0, 0.58, 1]
export const EASE_SMOOTH: EaseHandle = [0.33, 0, 0.15, 1]

export const NAMED_EASINGS = {
  linear: EASE_LINEAR,
  'ease-in': EASE_IN,
  'ease-out': EASE_OUT,
  'ease-in-out': EASE_IN_OUT,
  smooth: EASE_SMOOTH,
} as const

export type NamedEasing = keyof typeof NAMED_EASINGS

// Constructing a BezierEasing builds a sample table, so it is far too
// expensive to do per-frame — and sampleTimeline runs once per track per
// frame. Handles come from a small fixed set in practice, so cache on the
// control points themselves.
const cache = new Map<string, (x: number) => number>()

export function easingFor(handle: EaseHandle): (x: number) => number {
  const key = `${handle[0]},${handle[1]},${handle[2]},${handle[3]}`
  let fn = cache.get(key)
  if (!fn) {
    fn = BezierEasing(handle[0], handle[1], handle[2], handle[3])
    cache.set(key, fn)
  }
  return fn
}
