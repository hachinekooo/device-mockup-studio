import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyColorway } from './screenMaterial'

function buildModel() {
  // Mirrors how a cloned GLTF scene looks: several meshes sharing one
  // material instance.
  const shared = new THREE.MeshStandardMaterial({ color: '#ffffff' })
  shared.name = 'Rim_Buttons'
  const colorMap = new THREE.Texture()
  shared.map = colorMap
  const other = new THREE.MeshStandardMaterial({ color: '#111111' })
  other.name = 'Screen_Glass'
  // The screen carries its own material, as every real model does — the
  // iPhone 17 Pro's screen mesh and its material are both called 'Screen'.
  const screenMat = new THREE.MeshStandardMaterial({ color: '#222222' })
  screenMat.name = 'Screen'

  const root = new THREE.Group()
  const bodyA = new THREE.Mesh(new THREE.BoxGeometry(), shared)
  bodyA.name = 'BodyA'
  const bodyB = new THREE.Mesh(new THREE.BoxGeometry(), shared)
  bodyB.name = 'BodyB'
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), other)
  glass.name = 'Glass'
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(), screenMat)
  screen.name = 'Screen'
  root.add(bodyA, bodyB, glass, screen)

  return { root, shared, other, screenMat, colorMap, bodyA, bodyB, glass, screen }
}

const OVERRIDES = { Rim_Buttons: { color: '#3a3a3c', roughness: 0.32, metalness: 0.9 } }

describe('applyColorway', () => {
  it('recolours meshes whose material name matches', () => {
    const m = buildModel()
    applyColorway(m.root, OVERRIDES, 'Screen')
    const mat = m.bodyA.material as THREE.MeshStandardMaterial
    expect(`#${mat.color.getHexString()}`).toBe('#3a3a3c')
    expect(mat.roughness).toBeCloseTo(0.32, 6)
    expect(mat.metalness).toBeCloseTo(0.9, 6)
  })

  it('never mutates the shared source material', () => {
    // The regression this guards: a GLTF's materials are shared across every
    // clone of that scene AND cached by the loader, so writing in place
    // repaints other instances and leaks into the next mount.
    const m = buildModel()
    applyColorway(m.root, OVERRIDES, 'Screen')
    expect(`#${m.shared.color.getHexString()}`).toBe('#ffffff')
    expect(m.bodyA.material).not.toBe(m.shared)
    expect(m.bodyB.material).not.toBe(m.shared)
  })

  it('leaves unmatched materials completely alone', () => {
    const m = buildModel()
    applyColorway(m.root, OVERRIDES, 'Screen')
    expect(m.glass.material).toBe(m.other)
  })

  it('skips the screen so a colorway cannot repaint the screenshot', () => {
    // The override deliberately names the screen's own material: a manifest
    // that lists it must still be ignored there, or the swatch paints over
    // the user's screenshot.
    const m = buildModel()
    applyColorway(m.root, { ...OVERRIDES, Screen: { color: '#ff00ff' } }, 'Screen')
    expect(m.screen.material).toBe(m.screenMat)
    expect(`#${m.screenMat.color.getHexString()}`).toBe('#222222')
  })

  it('applies only the properties the colorway actually specifies', () => {
    const m = buildModel()
    const before = (m.bodyA.material as THREE.MeshStandardMaterial).roughness
    applyColorway(m.root, { Rim_Buttons: { color: '#ff0000' } }, 'Screen')
    const after = m.bodyA.material as THREE.MeshStandardMaterial
    expect(`#${after.color.getHexString()}`).toBe('#ff0000')
    expect(after.roughness).toBeCloseTo(before, 6)
  })

  it('can remove an authored colour map without mutating the GLTF source', () => {
    const m = buildModel()
    applyColorway(
      m.root,
      { Rim_Buttons: { color: '#e6e3de', removeColorMap: true } },
      'Screen',
    )
    expect((m.bodyA.material as THREE.MeshStandardMaterial).map).toBeNull()
    expect(m.shared.map).toBe(m.colorMap)
  })

  it('restores the authored source material when switching to an empty colorway', () => {
    const m = buildModel()
    applyColorway(m.root, { Rim_Buttons: { removeColorMap: true } }, 'Screen')
    applyColorway(m.root, {}, 'Screen')
    expect(m.bodyA.material).toBe(m.shared)
    expect((m.bodyA.material as THREE.MeshStandardMaterial).map).toBe(m.colorMap)
  })

  it('is idempotent across repeated swatch changes', () => {
    const m = buildModel()
    applyColorway(m.root, OVERRIDES, 'Screen')
    applyColorway(m.root, { Rim_Buttons: { color: '#e6e3de' } }, 'Screen')
    expect(`#${(m.bodyA.material as THREE.MeshStandardMaterial).color.getHexString()}`).toBe('#e6e3de')
    expect(`#${m.shared.color.getHexString()}`).toBe('#ffffff')
  })
})
