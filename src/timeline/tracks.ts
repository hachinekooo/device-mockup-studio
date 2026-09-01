import { EASE_SMOOTH } from './easing'
import type { EaseHandle, Keyframe, Track, TrackSet } from '../store/schema'

// Pure, immutable operations on tracks. Everything that mutates a track set
// goes through here so the "keys sorted by t" invariant sampleTrack's binary
// search depends on holds in exactly one place.

const EPSILON = 1e-6

/** A channel pinned to a single value — the inspector's "just a number" case. */
export function staticTrack(v: number): Track {
  return { keys: [{ t: 0, v, ease: EASE_SMOOTH }] }
}

export function staticVec3(prefix: string, v: [number, number, number]): TrackSet {
  return {
    [`${prefix}.x`]: staticTrack(v[0]),
    [`${prefix}.y`]: staticTrack(v[1]),
    [`${prefix}.z`]: staticTrack(v[2]),
  }
}

/**
 * Insert or replace the key at `t`. Replacing preserves the existing key's
 * easing unless a new handle is given — dragging a keyframe's value in the
 * UI should not silently reset the curve the user chose.
 */
export function setKey(track: Track | undefined, t: number, v: number, ease?: EaseHandle): Track {
  const keys = track?.keys ?? []
  const at = keys.findIndex((k) => Math.abs(k.t - t) < EPSILON)
  if (at >= 0) {
    const next = keys.slice()
    next[at] = { t, v, ease: ease ?? keys[at].ease }
    return { keys: next }
  }
  const inserted: Keyframe = { t, v, ease: ease ?? EASE_SMOOTH }
  return { keys: [...keys, inserted].sort((a, b) => a.t - b.t) }
}

export function removeKey(track: Track | undefined, t: number): Track {
  const keys = track?.keys ?? []
  return { keys: keys.filter((k) => Math.abs(k.t - t) >= EPSILON) }
}

/**
 * Remove a key without leaving a scalar channel empty. A one-key track is
 * the document's representation of a static value, so deleting its final
 * key would silently replace the user's value with a sampler fallback.
 */
export function removeKeySafely(track: Track | undefined, t: number): Track | undefined {
  if (!track || track.keys.length <= 1) return track
  const next = removeKey(track, t)
  return next.keys.length === track.keys.length ? track : next
}

/** Write a complete object pose at one time, including static channels. */
export function setTrackValuesAt(
  tracks: TrackSet,
  t: number,
  values: Record<string, number>,
): TrackSet {
  let changed = false
  const next = { ...tracks }
  for (const [channel, value] of Object.entries(values)) {
    const track = setKey(tracks[channel], t, value)
    next[channel] = track
    if (track !== tracks[channel]) changed = true
  }
  return changed ? next : tracks
}

/** Remove every removable scalar key represented by one aggregate diamond. */
export function removeTrackValuesAt(tracks: TrackSet, t: number): TrackSet {
  let changed = false
  const next: TrackSet = {}
  for (const [channel, track] of Object.entries(tracks)) {
    const result = removeKeySafely(track, t) ?? track
    next[channel] = result
    if (result !== track) changed = true
  }
  return changed ? next : tracks
}

/**
 * Set a channel's value at `t`. On a static (single-key) channel this edits
 * that key in place rather than adding a second one, so scrubbing the
 * timeline and typing in a number can't accidentally create animation.
 */
export function setValueAt(track: Track | undefined, t: number, v: number): Track {
  const keys = track?.keys ?? []
  if (keys.length <= 1) return staticTrack(v)
  return setKey(track, t, v)
}

export function setVec3At(
  tracks: TrackSet,
  prefix: string,
  t: number,
  v: [number, number, number],
): TrackSet {
  return {
    ...tracks,
    [`${prefix}.x`]: setValueAt(tracks[`${prefix}.x`], t, v[0]),
    [`${prefix}.y`]: setValueAt(tracks[`${prefix}.y`], t, v[1]),
    [`${prefix}.z`]: setValueAt(tracks[`${prefix}.z`], t, v[2]),
  }
}

/** Distinct keyframe times across a set — one column per diamond in the UI. */
export function keyTimes(tracks: TrackSet): number[] {
  const seen = new Set<number>()
  for (const track of Object.values(tracks)) {
    for (const key of track.keys) seen.add(Math.round(key.t * 1e6) / 1e6)
  }
  return [...seen].sort((a, b) => a - b)
}
