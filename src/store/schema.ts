// Serialisable project document (§5). No THREE.* objects, no functions —
// everything here survives JSON.stringify, because it is what gets written
// into a .mockup zip and what the undo stack snapshots.

export type MediaRef = {
  id: string
  kind: 'image' | 'video'
  width: number
  height: number
  /** Seconds. Video only — the clip's own length, not the timeline's. */
  duration?: number
  url: string // object URL for the loaded blob, held in memory for MVP
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** CSS cubic-bezier control points: [x1, y1, x2, y2]. */
export type EaseHandle = [number, number, number, number]

export type Keyframe = {
  t: number // seconds
  v: number
  ease: EaseHandle
}

export type Track = { keys: Keyframe[] }

/**
 * Channels keyed by dotted path — "position.x", "rotation.y", "scale".
 *
 * Every animatable value is a scalar channel, never a packed vector. That is
 * what makes rotation interpolate per-axis as Euler angles, which is what
 * users mean by "spin 720°" (§8.1, §14 trap 11). It also means the timeline
 * UI has exactly one kind of row to render.
 */
export type TrackSet = Record<string, Track>

// ---------------------------------------------------------------------------
// Scene state — the resolved output of sampleTimeline at one instant.
// Plain numbers; the renderers apply these to real THREE objects.
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number]

export type DeviceState = { position: Vec3; rotation: Vec3; scale: number }

export type SceneState = {
  camera: { position: Vec3; target: Vec3; fov: number }
  /** One entry per device instance, in project order. */
  devices: DeviceState[]
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export type BackgroundConfig =
  | { type: 'transparent' }
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'image'; ref: MediaRef; fit: 'cover' | 'contain' }

export type EnvironmentConfig = {
  hdri: 'studio' | 'city' | 'sunset' | 'warehouse'
  intensity: number
  rotation: number // radians, y-axis
  shadowOpacity: number
  shadowBlur: number
}

export type CameraAnglePreset =
  | 'front'
  | 'three-quarter-left'
  | 'three-quarter-right'
  | 'side'
  | 'top-down'
  | 'low-angle'

export type CameraConfig = {
  fov: number
  /** Last applied angle preset, for UI highlighting only. The pose itself
   *  lives in `tracks` — presets are keyframe generators, not a parallel
   *  runtime path (§8.2). Null once the user moves the camera freely. */
  preset: CameraAnglePreset | null
  tracks: TrackSet // position.x/y/z, target.x/y/z, fov
}

export type ScreenFit = 'cover' | 'contain'

export type DeviceId =
  | 'procedural-phone'
  | 'iphone-17-pro'
  | 'iphone-17-pro-max'
  | 'pixel-9-pro-xl'
  | 'galaxy-s26-ultra'

export type DeviceOrientation = 'portrait' | 'landscape'

/**
 * One device in the scene. A scene is always a list of these — a single
 * phone is just the one-element case, which is what keeps templates like a
 * staggered duo from needing a parallel code path.
 *
 * Each instance owns its own screen: the point of a multi-device showcase is
 * showing different screens side by side.
 */
export type DeviceInstance = {
  instanceId: string
  id: DeviceId
  colorway: string
  orientation: DeviceOrientation
  screen: MediaRef | null
  screenFit: ScreenFit
  /** position.x/y/z, rotation.x/y/z, scale — animatable like everything else. */
  transform: TrackSet
}

export type OutputConfig = {
  width: number
  height: number
}

/**
 * Canvas aspect presets (§2, v2). The artboard is always the output aspect —
 * showing the user a frame that isn't what they'll export is the fastest way
 * to make a mockup tool feel untrustworthy.
 */
export const ASPECT_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: '16:9', label: '16:9', width: 1920, height: 1080 },
  { id: '4:3', label: '4:3', width: 1600, height: 1200 },
  { id: '1:1', label: '1:1', width: 1600, height: 1600 },
  { id: '3:4', label: '3:4', width: 1200, height: 1600 },
  { id: '9:16', label: '9:16', width: 1080, height: 1920 },
]

export function aspectLabelFor(output: OutputConfig): string {
  const ratio = output.width / output.height
  const match = ASPECT_PRESETS.find((p) => Math.abs(p.width / p.height - ratio) < 0.01)
  return match ? match.label : 'Custom'
}

export type Project = {
  version: 1
  name: string
  duration: number // seconds
  fps: 30 | 60
  output: OutputConfig
  devices: DeviceInstance[]
  background: BackgroundConfig
  environment: EnvironmentConfig
  camera: CameraConfig
}

export const CAMERA_PRESETS: Record<
  CameraAnglePreset,
  { position: Vec3; label: string }
> = {
  front: { position: [0, 0, 3.2], label: 'Front' },
  'three-quarter-left': { position: [-2.2, 0.9, 2.4], label: '3/4 Left' },
  'three-quarter-right': { position: [2.2, 0.9, 2.4], label: '3/4 Right' },
  side: { position: [3.2, 0, 0.2], label: 'Side' },
  'top-down': { position: [0, 3.2, 0.6], label: 'Top Down' },
  'low-angle': { position: [0, -1.6, 2.8], label: 'Low Angle' },
}

export const DEFAULT_CAMERA_PRESET: CameraAnglePreset = 'three-quarter-left'
