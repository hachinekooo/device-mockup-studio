import { staticTrack, staticVec3 } from './tracks'
import type { BackgroundConfig, CameraConfig, DeviceInstance, TrackSet, Vec3 } from '../store/schema'

/**
 * Showcase templates — camera plus a device arrangement, as data.
 *
 * A pose is expressed as each device's own transform with the camera left
 * head-on, rather than by flying the camera around a single device. That is
 * what makes multi-device arrangements composable: a staggered duo is two
 * poses side by side, and nothing about it is a special case.
 *
 * Angles are in radians. With the screen facing +Z and the camera on +Z:
 *   rotation.y > 0  turns the phone's right edge away, revealing its LEFT side
 *   rotation.z < 0  leans the phone clockwise on screen
 *   rotation.x > 0  tips the top away from the viewer
 */

export type Pose = {
  position: Vec3
  rotation: Vec3
  scale: number
}

export type Template = {
  id: string
  name: string
  /** What it's for, shown under the name in the picker. */
  description: string
  poses: Pose[]
  camera: { position: Vec3; fov: number }
  /** Templates that only read well in a particular frame shape. */
  suggestedOutput?: { width: number; height: number }
  /**
   * Backdrop and shadow are part of the look, not decoration around it. The
   * product-shot templates float their devices on near-white with almost no
   * contact shadow; applying the pose without that reads as a different
   * template entirely.
   */
  background?: BackgroundConfig
  shadowOpacity?: number
}

/** The near-white studio backdrop these showcase layouts are built on. */
const STUDIO_BG: BackgroundConfig = { type: 'solid', color: '#f2f2f3' }

const DEG = Math.PI / 180

export const TEMPLATES: Template[] = [
  {
    id: 'hero-straight',
    name: 'Hero',
    description: 'One device, square to camera. The App Store default.',
    poses: [{ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }],
    camera: { position: [0, 0, 3.5], fov: 30 },
    suggestedOutput: { width: 1200, height: 1600 },
  },
  {
    id: 'hero-tilt',
    name: 'Hero Tilt',
    description: 'Single device turned just enough to read as an object.',
    poses: [{ position: [0, 0, 0], rotation: [3 * DEG, 22 * DEG, -6 * DEG], scale: 1 }],
    camera: { position: [0, 0, 3.5], fov: 30 },
    suggestedOutput: { width: 1200, height: 1600 },
  },
  {
    id: 'duo-offset',
    name: 'Duo',
    description: 'Two devices in three-quarter, staggered and overlapping. The launch shot.',
    // Strong y-rotation so the side buttons read — that edge is what stops a
    // mockup looking like a flat screenshot pasted onto a rectangle. The pair
    // splays very slightly rather than sitting parallel, which is what gives
    // the arrangement its motion.
    poses: [
      { position: [-0.46, -0.23, 0.55], rotation: [1 * DEG, 24 * DEG, 7 * DEG], scale: 1 },
      { position: [0.55, 0.2, -0.15], rotation: [1 * DEG, 24 * DEG, -5 * DEG], scale: 0.97 },
    ],
    camera: { position: [0, 0, 4.45], fov: 30 },
    suggestedOutput: { width: 1350, height: 1600 },
    background: STUDIO_BG,
    shadowOpacity: 0.12,
  },
  {
    id: 'duo-flat',
    name: 'Duo Flat',
    description: 'Two devices square on, side by side. Best for comparing screens.',
    poses: [
      { position: [-0.46, 0, 0], rotation: [0, 0, 0], scale: 0.92 },
      { position: [0.46, 0, 0], rotation: [0, 0, 0], scale: 0.92 },
    ],
    camera: { position: [0, 0, 4.2], fov: 30 },
    suggestedOutput: { width: 1600, height: 1200 },
  },
  {
    id: 'trio-set',
    name: 'Trio Set',
    description: 'Three upright devices, centre one pushed forward. Clean and catalogue-like.',
    // The centre device comes toward the camera and drops slightly; the
    // outer two sit back. All three share one rotation so the set reads as a
    // single object rather than three separate shots.
    poses: [
      { position: [-0.84, 0.1, -0.5], rotation: [0, 21 * DEG, 0], scale: 0.97 },
      { position: [0.04, -0.16, 0.55], rotation: [0, 21 * DEG, 0], scale: 1 },
      { position: [0.9, 0.06, -0.4], rotation: [0, 21 * DEG, 0], scale: 0.97 },
    ],
    camera: { position: [0, 0, 5.35], fov: 30 },
    suggestedOutput: { width: 1400, height: 1500 },
    background: STUDIO_BG,
    shadowOpacity: 0.1,
  },
  {
    id: 'trio-fan',
    name: 'Trio Fan',
    description: 'Three devices fanned outward from an upright centre. Good for feature tours.',
    // Outer devices lean away from the middle in opposite directions while
    // all three keep a positive y-rotation, so every screen stays readable.
    poses: [
      { position: [-1.1, -0.04, 0.2], rotation: [0, 26 * DEG, 9 * DEG], scale: 1 },
      { position: [0, 0.08, -0.15], rotation: [0, 7 * DEG, 0], scale: 1 },
      { position: [1.1, -0.04, 0.2], rotation: [0, 17 * DEG, -9 * DEG], scale: 1 },
    ],
    camera: { position: [0, 0, 6.1], fov: 30 },
    suggestedOutput: { width: 1500, height: 1450 },
    background: STUDIO_BG,
    shadowOpacity: 0.1,
  },
  {
    id: 'perspective-row',
    name: 'Perspective Row',
    description: 'Devices receding into depth. Reads as a sequence or a flow.',
    poses: [
      { position: [-0.75, -0.1, 0.7], rotation: [0, 30 * DEG, -5 * DEG], scale: 1 },
      { position: [0.1, 0.02, -0.15], rotation: [0, 30 * DEG, -5 * DEG], scale: 0.94 },
      { position: [0.92, 0.14, -1], rotation: [0, 30 * DEG, -5 * DEG], scale: 0.88 },
    ],
    camera: { position: [0, 0, 4.6], fov: 34 },
    suggestedOutput: { width: 1600, height: 1000 },
  },
  {
    id: 'front-back',
    name: 'Front & Back',
    description: 'One device face on, one turned away — shows the hardware too.',
    poses: [
      { position: [-0.5, 0, 0.25], rotation: [0, 20 * DEG, -8 * DEG], scale: 1 },
      { position: [0.55, 0.05, -0.2], rotation: [0, 180 * DEG - 20 * DEG, 8 * DEG], scale: 1 },
    ],
    camera: { position: [0, 0, 4.3], fov: 30 },
    suggestedOutput: { width: 1400, height: 1400 },
  },
  {
    id: 'flat-lay',
    name: 'Flat Lay',
    description: 'Device lying flat, seen from above. Editorial and calm.',
    // Tipped back to horizontal, with the camera overhead looking down.
    poses: [{ position: [0, 0, 0], rotation: [-88 * DEG, 0, 12 * DEG], scale: 1 }],
    camera: { position: [0, 3.4, 0.35], fov: 30 },
    suggestedOutput: { width: 1400, height: 1400 },
  },
  {
    id: 'low-hero',
    name: 'Low Hero',
    description: 'Seen from below, tall and imposing. Strong perspective.',
    poses: [{ position: [0, 0, 0], rotation: [0, 14 * DEG, -4 * DEG], scale: 1 }],
    camera: { position: [0.35, -1.5, 2.9], fov: 42 },
    suggestedOutput: { width: 1200, height: 1600 },
  },
  {
    id: 'stacked-depth',
    name: 'Stacked Depth',
    description: 'Overlapping devices with a shallow offset. Dense, poster-like.',
    poses: [
      { position: [-0.34, -0.2, 0.55], rotation: [0, 12 * DEG, -10 * DEG], scale: 1 },
      { position: [0.06, 0.02, 0], rotation: [0, 12 * DEG, -10 * DEG], scale: 0.97 },
      { position: [0.46, 0.24, -0.55], rotation: [0, 12 * DEG, -10 * DEG], scale: 0.94 },
    ],
    camera: { position: [0, 0, 4.4], fov: 28 },
    suggestedOutput: { width: 1400, height: 1600 },
  },
]

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export function poseToTracks(pose: Pose): TrackSet {
  return {
    ...staticVec3('position', pose.position),
    ...staticVec3('rotation', pose.rotation),
    scale: staticTrack(pose.scale),
  }
}

export function templateCamera(template: Template): CameraConfig {
  return {
    fov: template.camera.fov,
    preset: null, // a template's framing is its own, not a named angle
    tracks: {
      ...staticVec3('position', template.camera.position),
      ...staticVec3('target', [0, 0, 0]),
      fov: staticTrack(template.camera.fov),
    },
  }
}

/**
 * Build the device list for a template, reusing the existing devices' model,
 * finish and screens where they exist. Switching template should re-pose what
 * you already set up, not reset it to an empty stage — and when a template
 * needs more devices than are present, the extras inherit the first one's
 * settings and its screenshot, which is nearly always what's wanted.
 */
export function applyTemplateToDevices(
  template: Template,
  existing: DeviceInstance[],
): DeviceInstance[] {
  const seed = existing[0]
  return template.poses.map((pose, index) => {
    const source = existing[index] ?? seed
    return {
      instanceId: existing[index]?.instanceId ?? crypto.randomUUID(),
      id: source?.id ?? 'iphone-17-pro',
      colorway: source?.colorway ?? 'natural-titanium',
      orientation: source?.orientation ?? 'portrait',
      screen: source?.screen ?? null,
      screenFit: source?.screenFit ?? 'contain',
      transform: poseToTracks(pose),
    }
  })
}
