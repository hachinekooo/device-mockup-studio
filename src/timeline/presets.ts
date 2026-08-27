import { EASE_LINEAR, EASE_OUT, EASE_SMOOTH } from './easing'
import { staticTrack, staticVec3 } from './tracks'
import { CAMERA_PRESETS, type CameraAnglePreset, type Project, type TrackSet } from '../store/schema'

// Presets are keyframe *generators*, never a parallel runtime path (§8.2).
// Applying one writes keys into a track set and then gets out of the way, so
// anything a preset produces the user can immediately drag, retime, or
// re-ease like hand-authored animation. One code path, no "preset mode".

export type MotionPresetId =
  | 'none'
  | 'float'
  | 'spin-y-360'
  | 'tilt-in'
  | 'slide-in-left'
  | 'hero-reveal'
  | 'orbit'

export const MOTION_PRESETS: { id: MotionPresetId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'float', label: 'Float' },
  { id: 'spin-y-360', label: 'Spin 360°' },
  { id: 'tilt-in', label: 'Tilt In' },
  { id: 'slide-in-left', label: 'Slide In' },
  { id: 'hero-reveal', label: 'Hero Reveal' },
  { id: 'orbit', label: 'Orbit' },
]

const TAU = Math.PI * 2

/** Camera angle presets collapse to a single key — a static pose. */
export function cameraTracksForAngle(preset: CameraAnglePreset, fov: number): TrackSet {
  return {
    ...staticVec3('position', CAMERA_PRESETS[preset].position),
    ...staticVec3('target', [0, 0, 0]),
    fov: staticTrack(fov),
  }
}

export function applyCameraAngle(project: Project, preset: CameraAnglePreset): Project {
  return {
    ...project,
    camera: {
      ...project.camera,
      preset,
      tracks: cameraTracksForAngle(preset, project.camera.fov),
    },
  }
}

function restDeviceTracks(): TrackSet {
  return {
    ...staticVec3('position', [0, 0, 0]),
    ...staticVec3('rotation', [0, 0, 0]),
    scale: staticTrack(1),
  }
}

/**
 * Build the device tracks for a motion preset over `duration` seconds.
 * Every preset starts from rest and overwrites only the channels it drives,
 * so switching presets never leaves a stray key on an unrelated axis.
 */
export function deviceTracksForMotion(preset: MotionPresetId, duration: number): TrackSet {
  const d = duration
  const base = restDeviceTracks()

  switch (preset) {
    case 'none':
      return base

    case 'float':
      // Loops cleanly: same value at both ends, eased at the turnaround.
      return {
        ...base,
        'position.y': {
          keys: [
            { t: 0, v: 0, ease: EASE_SMOOTH },
            { t: d / 2, v: 0.07, ease: EASE_SMOOTH },
            { t: d, v: 0, ease: EASE_SMOOTH },
          ],
        },
      }

    case 'spin-y-360':
      // Linear, and 0 -> TAU rather than 0 -> 0. Per-axis Euler lerp means
      // this reads as exactly one revolution (§8.1).
      return {
        ...base,
        'rotation.y': {
          keys: [
            { t: 0, v: 0, ease: EASE_LINEAR },
            { t: d, v: TAU, ease: EASE_LINEAR },
          ],
        },
      }

    case 'tilt-in':
      return {
        ...base,
        'rotation.y': {
          keys: [
            { t: 0, v: -0.55, ease: EASE_OUT },
            { t: d * 0.7, v: 0, ease: EASE_SMOOTH },
          ],
        },
        'rotation.x': {
          keys: [
            { t: 0, v: 0.22, ease: EASE_OUT },
            { t: d * 0.7, v: 0, ease: EASE_SMOOTH },
          ],
        },
      }

    case 'slide-in-left':
      return {
        ...base,
        'position.x': {
          keys: [
            { t: 0, v: -2.4, ease: EASE_OUT },
            { t: d * 0.55, v: 0, ease: EASE_SMOOTH },
          ],
        },
      }

    case 'hero-reveal':
      return {
        ...base,
        scale: {
          keys: [
            { t: 0, v: 0.86, ease: EASE_SMOOTH },
            { t: d * 0.6, v: 1, ease: EASE_SMOOTH },
          ],
        },
        'position.y': {
          keys: [
            { t: 0, v: -0.28, ease: EASE_SMOOTH },
            { t: d * 0.6, v: 0, ease: EASE_SMOOTH },
          ],
        },
        'rotation.y': {
          keys: [
            { t: 0, v: 0.45, ease: EASE_SMOOTH },
            { t: d * 0.75, v: 0, ease: EASE_SMOOTH },
          ],
        },
      }

    case 'orbit':
      return base // orbit drives the camera, not the device — see below
  }
}

/**
 * Orbit is the one preset that moves the camera instead of the device.
 * A circle can't be expressed by two bezier segments, so sample it into
 * evenly spaced linear keys — 12 steps is under half a degree of chord
 * error at any radius we use, and it stays editable as ordinary keyframes.
 */
export function cameraTracksForOrbit(radius: number, height: number, duration: number): TrackSet {
  const STEPS = 12
  const x: { t: number; v: number; ease: typeof EASE_LINEAR }[] = []
  const z: { t: number; v: number; ease: typeof EASE_LINEAR }[] = []
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * duration
    const angle = (i / STEPS) * TAU
    x.push({ t, v: Math.sin(angle) * radius, ease: EASE_LINEAR })
    z.push({ t, v: Math.cos(angle) * radius, ease: EASE_LINEAR })
  }
  return {
    'position.x': { keys: x },
    'position.y': staticTrack(height),
    'position.z': { keys: z },
    ...staticVec3('target', [0, 0, 0]),
  }
}

/**
 * Motion applies to every device in the scene, because an arrangement that
 * animates one phone out of three reads as a glitch rather than a choice.
 * Each device keeps its own placement: the preset's motion is composed onto
 * the pose the template gave it, not substituted for it.
 */
export function applyMotionPreset(project: Project, preset: MotionPresetId): Project {
  if (preset === 'orbit') {
    // Orbit moves the camera, so the devices keep whatever poses they have.
    const [px, py, pz] = CAMERA_PRESETS[project.camera.preset ?? 'three-quarter-left'].position
    const radius = Math.hypot(px, pz)
    return {
      ...project,
      camera: {
        ...project.camera,
        tracks: {
          ...cameraTracksForOrbit(radius, py, project.duration),
          fov: staticTrack(project.camera.fov),
        },
      },
    }
  }

  const motion = deviceTracksForMotion(preset, project.duration)
  return {
    ...project,
    devices: project.devices.map((device) => ({
      ...device,
      transform: composeMotionOntoPose(device.transform, motion),
    })),
  }
}

/**
 * Offset a preset's motion by the device's existing static pose, so a phone
 * placed at x = -0.68 by a template floats around -0.68 rather than snapping
 * to the origin. Channels the preset doesn't drive are left untouched.
 */
function composeMotionOntoPose(pose: TrackSet, motion: TrackSet): TrackSet {
  const result: TrackSet = { ...pose }
  for (const [channel, track] of Object.entries(motion)) {
    const base = pose[channel]?.keys[0]?.v ?? 0
    const isScale = channel === 'scale'
    result[channel] = {
      keys: track.keys.map((key) => ({
        ...key,
        // Scale composes multiplicatively; position and rotation add.
        v: isScale ? key.v * (base || 1) : key.v + base,
      })),
    }
  }
  return result
}
