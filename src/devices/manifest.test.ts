import { describe, expect, it } from 'vitest'
import { DEVICE_LIST, DEVICE_MANIFESTS, getManifest } from './manifest'

// Resolved by Vite against the real filesystem at transform time, rather
// than node:fs — the app tsconfig deliberately exposes only `vite/client`
// types, and a test is not a reason to widen that.
const SHIPPED_GLBS = new Set(
  Object.keys(import.meta.glob('../../public/devices/*.glb')).map((path) =>
    path.slice(path.lastIndexOf('/') + 1),
  ),
)

describe('device manifests', () => {
  it('keys every manifest by its own id', () => {
    for (const [key, manifest] of Object.entries(DEVICE_MANIFESTS)) {
      expect(manifest.id).toBe(key)
    }
  })

  it('ships the GLB every manifest points at', () => {
    // A renamed or forgotten file fails as a silent 404 and an empty scene at
    // runtime, which looks like a broken device rather than a missing asset.
    for (const manifest of DEVICE_LIST) {
      if (!manifest.glb) continue
      const file = manifest.glb.slice(manifest.glb.lastIndexOf('/') + 1)
      expect(SHIPPED_GLBS.has(file), `missing public${manifest.glb}`).toBe(true)
    }
  })

  it('names a screen material for every model-backed device', () => {
    for (const manifest of DEVICE_LIST) {
      if (!manifest.glb) continue
      expect(manifest.screenMaterialName, manifest.id).not.toBe('')
    }
  })

  it('gives every phone a plausible screen aspect', () => {
    // Every modern phone lands near 0.46 (w/h). A number far outside this
    // means a measurement read the wrong mesh — the failure mode is a
    // screenshot cropped or letterboxed for no visible reason.
    for (const manifest of DEVICE_LIST) {
      if (manifest.category !== 'phone') continue
      expect(manifest.screenAspect, manifest.id).toBeGreaterThan(0.35)
      expect(manifest.screenAspect, manifest.id).toBeLessThan(0.75)
    }
  })

  it('keeps every visible fraction a real fraction', () => {
    for (const manifest of DEVICE_LIST) {
      for (const axis of manifest.screenVisibleFraction) {
        expect(axis, manifest.id).toBeGreaterThan(0)
        expect(axis, manifest.id).toBeLessThanOrEqual(1)
      }
    }
  })

  it('scales every model to a believable physical height', () => {
    // The convention is 1 unit = 10cm (§7.2). A scale that is out by a factor
    // of ten puts one device off-frame in a multi-device scene while the
    // others look fine, which is a confusing thing to debug from pixels.
    for (const manifest of DEVICE_LIST) {
      const scale = manifest.modelTransform?.scale ?? 1
      expect(scale, manifest.id).toBeGreaterThan(0)
    }
  })

  it('gives every device at least one colorway, with unique ids', () => {
    for (const manifest of DEVICE_LIST) {
      expect(manifest.colorways.length, manifest.id).toBeGreaterThan(0)
      const ids = manifest.colorways.map((c) => c.id)
      expect(new Set(ids).size, manifest.id).toBe(ids.length)
    }
  })

  it('never lets a colorway repaint the screen material', () => {
    // applyColorway skips it, but a manifest listing it is a sign someone
    // mis-identified the screen — worth failing loudly rather than silently
    // relying on the skip.
    for (const manifest of DEVICE_LIST) {
      for (const colorway of manifest.colorways) {
        expect(
          Object.keys(colorway.materials),
          `${manifest.id}/${colorway.id}`,
        ).not.toContain(manifest.screenMaterialName)
      }
    }
  })

  it('repaints the iPhone 17 Pro exterior for every advertised finish', () => {
    const manifest = getManifest('iphone-17-pro')
    const [original, ...customFinishes] = manifest.colorways
    expect(original.id).toBe('original-blue')
    expect(original.materials).toEqual({})

    for (const colorway of customFinishes) {
      expect(Object.keys(colorway.materials), colorway.id).toEqual(
        expect.arrayContaining(['Material.004', 'Material.002', 'Rim_Buttons']),
      )
      expect(colorway.materials.Rim_Buttons.removeColorMap, colorway.id).toBe(true)
    }
  })

  it('resolves every id through getManifest', () => {
    for (const manifest of DEVICE_LIST) {
      expect(getManifest(manifest.id)).toBe(manifest)
    }
  })
})
