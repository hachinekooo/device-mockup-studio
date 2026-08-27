import { easingFor } from './easing'
import type { Project, SceneState, Track, TrackSet } from '../store/schema'

/**
 * Evaluate one track at time `t`.
 *
 * Hold semantics (§8.1): before the first key and after the last, the
 * boundary value holds. An empty/absent track falls back to `fallback`,
 * which is how a channel that has never been touched reports its default.
 *
 * A track with exactly one key is a *static value* — that is deliberate and
 * load-bearing. It means "a number in the inspector" and "an animated
 * channel" are the same data, so the UI's animate toggle only has to add a
 * second key, never migrate between two representations.
 *
 * Easing convention: the handle on a key governs the segment *leaving* it,
 * matching CSS `animation-timing-function` on a keyframe. The last key's
 * handle is therefore never read.
 */
export function sampleTrack(track: Track | undefined, t: number, fallback: number): number {
  const keys = track?.keys
  if (!keys || keys.length === 0) return fallback
  if (keys.length === 1) return keys[0].v
  if (t <= keys[0].t) return keys[0].v

  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v

  // Binary search for the pair bracketing t. Keys are sorted by t; the
  // track editing helpers in tracks.ts are what maintain that invariant.
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid].t <= t) lo = mid
    else hi = mid
  }

  const a = keys[lo]
  const b = keys[hi]
  const span = b.t - a.t
  if (span <= 0) return b.v // coincident keys: the later one wins

  return a.v + (b.v - a.v) * easingFor(a.ease)((t - a.t) / span)
}

function vec3(
  tracks: TrackSet,
  prefix: string,
  t: number,
  fallback: [number, number, number],
): [number, number, number] {
  return [
    sampleTrack(tracks[`${prefix}.x`], t, fallback[0]),
    sampleTrack(tracks[`${prefix}.y`], t, fallback[1]),
    sampleTrack(tracks[`${prefix}.z`], t, fallback[2]),
  ]
}

/**
 * The single source of scene truth (§4). Preview and export both call this;
 * the only difference between them is what drives `t` and where the pixels
 * land. If export-specific animation logic ever appears, the abstraction
 * has broken.
 *
 * Pure: no frame delta, no wall clock, no reads of live scene objects
 * (§14 trap 5). Same `t` in, same state out, forever.
 *
 * Rotations come back as per-axis Euler radians and must be applied as
 * such. Never route them through a quaternion on the way in — slerp takes
 * the short path, so a 720° spin silently becomes no spin at all
 * (§8.1, §14 trap 11).
 */
export function sampleTimeline(project: Project, t: number): SceneState {
  const cam = project.camera.tracks

  return {
    camera: {
      position: vec3(cam, 'position', t, [0, 0, 3.2]),
      target: vec3(cam, 'target', t, [0, 0, 0]),
      fov: sampleTrack(cam['fov'], t, project.camera.fov),
    },
    devices: project.devices.map((device) => ({
      position: vec3(device.transform, 'position', t, [0, 0, 0]),
      rotation: vec3(device.transform, 'rotation', t, [0, 0, 0]),
      scale: sampleTrack(device.transform['scale'], t, 1),
    })),
  }
}

/** True if any channel in the set carries real animation (more than one key). */
export function isAnimated(tracks: TrackSet): boolean {
  return Object.values(tracks).some((track) => track.keys.length > 1)
}

/** Latest keyframe time across every channel — the timeline's content extent. */
export function tracksEnd(tracks: TrackSet): number {
  let end = 0
  for (const track of Object.values(tracks)) {
    const last = track.keys[track.keys.length - 1]
    if (last && last.t > end) end = last.t
  }
  return end
}
