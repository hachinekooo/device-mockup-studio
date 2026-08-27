import type { DeviceState, Project, Vec3 } from '../store/schema'
import { sampleTimeline } from '../timeline/sample'
import { getManifest } from '../devices/manifest'

/**
 * Gap between the lowest device and the shadow catcher.
 *
 * 25mm, which is exactly what the original hardcoded -0.76 gave the iPhone
 * 17 Pro (half-height 0.735). Keeping it preserves that device's look
 * pixel-for-pixel while every other device gets the same treatment instead
 * of being sliced.
 */
export const GROUND_CLEARANCE = 0.025

/**
 * How far a rotated box extends below its own centre.
 *
 * Not simply height/2: a phone rolled a few degrees drops a corner lower
 * than its flat half-height, and the showcase templates roll every device.
 * At the Hero Tilt pose the 17 Pro Max reaches 0.854 below centre against a
 * flat half-height of 0.817 — a 37mm difference, easily enough to put the
 * plane back inside the phone.
 *
 * For an axis-aligned box under rotation R, the vertical half-extent is
 * half the sum of each dimension times the magnitude of that dimension's
 * contribution to world Y — i.e. the second row of R.
 */
export function verticalHalfExtent(size: Vec3, rotation: Vec3): number {
  const [rx, ry, rz] = rotation
  const cx = Math.cos(rx), sx = Math.sin(rx)
  const cy = Math.cos(ry), sy = Math.sin(ry)
  const cz = Math.cos(rz), sz = Math.sin(rz)

  // Second row of the intrinsic XYZ euler rotation matrix, matching
  // THREE.Euler's default order.
  const m10 = cx * sz + sx * sy * cz
  const m11 = cx * cz - sx * sy * sz
  const m12 = -sx * cy

  return 0.5 * (Math.abs(m10) * size[0] + Math.abs(m11) * size[1] + Math.abs(m12) * size[2])
}

/** The lowest point a posed device reaches. */
export function deviceBottom(state: DeviceState, size: Vec3): number {
  return state.position[1] - verticalHalfExtent(size, state.rotation) * state.scale
}

/**
 * Y for the shadow catcher: clear of every device in the scene.
 *
 * The plane is a shadow receiver, not real ground — nothing is ever meant to
 * be below it. When it intersected a device it was drawn over the device's
 * lower part (it is transparent, so it renders in the transparent pass,
 * after the opaque body) and the intersection showed as a hard diagonal line
 * across the screen.
 *
 * Falls back to the historical constant for an empty scene so a project with
 * no devices still looks the same.
 */
export function groundPlaneY(devices: { state: DeviceState; size: Vec3 }[]): number {
  if (devices.length === 0) return -0.76
  const lowest = Math.min(...devices.map(({ state, size }) => deviceBottom(state, size)))
  return lowest - GROUND_CLEARANCE
}

/** Samples taken across the timeline when placing the ground. */
const GROUND_SAMPLES = 17

/**
 * Ground height for a whole project, across its whole timeline.
 *
 * Sampled rather than read at t=0 because an animated device dips: a float
 * preset that sinks 5cm mid-loop would slice itself on a ground placed from
 * the first frame. Sampling also keeps the plane STATIC — it is resolved once
 * per document edit, not per frame, so the ground never slides around under
 * a moving phone, which would read as the camera moving.
 */
export function projectGroundY(project: Project): number {
  if (project.devices.length === 0) return -0.76

  const sizes = project.devices.map((device) => getManifest(device.id).bodySize)
  let lowest = Infinity

  for (let i = 0; i < GROUND_SAMPLES; i++) {
    const t = (project.duration * i) / (GROUND_SAMPLES - 1)
    const { devices } = sampleTimeline(project, t)
    devices.forEach((state, index) => {
      lowest = Math.min(lowest, deviceBottom(state, sizes[index]))
    })
  }

  return lowest - GROUND_CLEARANCE
}
