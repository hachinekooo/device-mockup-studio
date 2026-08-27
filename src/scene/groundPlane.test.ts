import { describe, expect, it } from 'vitest'
import type { DeviceState, Vec3 } from '../store/schema'
import { deviceBottom, groundPlaneY, verticalHalfExtent, GROUND_CLEARANCE } from './groundPlane'
import { DEVICE_MANIFESTS } from '../devices/manifest'

const DEG = Math.PI / 180
const flat = (over: Partial<DeviceState> = {}): DeviceState => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  ...over,
})

describe('verticalHalfExtent', () => {
  it('is half the height when the device is upright', () => {
    expect(verticalHalfExtent([0.8, 1.6, 0.12], [0, 0, 0])).toBeCloseTo(0.8, 6)
  })

  it('is half the WIDTH when the device is turned on its side', () => {
    expect(verticalHalfExtent([0.8, 1.6, 0.12], [0, 0, Math.PI / 2])).toBeCloseTo(0.4, 6)
  })

  it('reaches lower than half-height at an intermediate roll', () => {
    // The reason half-height alone is not enough: every showcase template
    // rolls its devices a few degrees, which drops a corner.
    const upright = verticalHalfExtent([0.792, 1.634, 0.133], [0, 0, 0])
    const rolled = verticalHalfExtent([0.792, 1.634, 0.133], [3 * DEG, 22 * DEG, -6 * DEG])
    expect(rolled).toBeGreaterThan(upright)
    expect(rolled).toBeCloseTo(0.854, 2)
  })

  it('is unaffected by a turn about the vertical axis', () => {
    const size: Vec3 = [0.8, 1.6, 0.12]
    expect(verticalHalfExtent(size, [0, Math.PI, 0])).toBeCloseTo(
      verticalHalfExtent(size, [0, 0, 0]),
      6,
    )
  })
})

describe('deviceBottom', () => {
  it('follows the device down', () => {
    const size: Vec3 = [0.8, 1.6, 0.12]
    expect(deviceBottom(flat({ position: [0, -0.23, 0] }), size)).toBeCloseTo(-1.03, 6)
  })

  it('shrinks with scale', () => {
    const size: Vec3 = [0.8, 1.6, 0.12]
    expect(deviceBottom(flat({ scale: 0.5 }), size)).toBeCloseTo(-0.4, 6)
  })
})

describe('groundPlaneY', () => {
  it('reproduces the old hardcoded height for the iPhone 17 Pro', () => {
    // -0.76 was exactly the 17 Pro's half-height plus the clearance. The
    // computed plane must not move that device's shadow.
    const size = DEVICE_MANIFESTS['iphone-17-pro'].bodySize
    expect(groundPlaneY([{ state: flat(), size }])).toBeCloseTo(-0.76, 6)
  })

  it('drops below a 16.3cm phone instead of slicing it', () => {
    // The bug: at -0.76 the plane sat 55mm inside these, and the intersection
    // drew a diagonal line across the lower screen.
    for (const id of ['iphone-17-pro-max', 'pixel-9-pro-xl', 'galaxy-s26-ultra'] as const) {
      const size = DEVICE_MANIFESTS[id].bodySize
      const y = groundPlaneY([{ state: flat(), size }])
      expect(y, id).toBeLessThan(-0.76)
      expect(y, id).toBeLessThan(deviceBottom(flat(), size))
    }
  })

  it('clears the lowest device in a multi-device scene', () => {
    const tall = DEVICE_MANIFESTS['iphone-17-pro-max'].bodySize
    const short = DEVICE_MANIFESTS['iphone-17-pro'].bodySize
    const scene = [
      { state: flat({ position: [-0.46, -0.23, 0.55] }), size: tall },
      { state: flat({ position: [0.55, 0.2, -0.15], scale: 0.97 }), size: short },
    ]
    const y = groundPlaneY(scene)
    for (const { state, size } of scene) {
      expect(y).toBeLessThan(deviceBottom(state, size))
    }
  })

  it('clears every device at every built-in tilt', () => {
    // Guards the whole family at once: no manifest may be added whose device
    // pokes through at a normal showcase pose.
    const poses: Vec3[] = [
      [0, 0, 0],
      [3 * DEG, 22 * DEG, -6 * DEG],
      [0, 30 * DEG, -5 * DEG],
      [0, 26 * DEG, 9 * DEG],
      [-88 * DEG, 0, 12 * DEG],
    ]
    for (const manifest of Object.values(DEVICE_MANIFESTS)) {
      for (const rotation of poses) {
        const state = flat({ rotation })
        const y = groundPlaneY([{ state, size: manifest.bodySize }])
        expect(y, `${manifest.id} ${rotation}`).toBeLessThanOrEqual(
          deviceBottom(state, manifest.bodySize) - GROUND_CLEARANCE + 1e-9,
        )
      }
    }
  })

  it('falls back to the historical height for an empty scene', () => {
    expect(groundPlaneY([])).toBe(-0.76)
  })
})
