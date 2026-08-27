import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { findScreenMesh, geometryUvBounds, screenUvBounds } from './screenMaterial'

describe('screenUvBounds', () => {
  it('is the identity for a clean 0-1 unwrap', () => {
    const uv = [0, 0, 1, 0, 1, 1, 0, 1]
    expect(screenUvBounds(uv, 4)).toEqual({ min: [0, 0], span: [1, 1] })
  })

  it('recovers the Pixel 9 Pro XL rect, which is not 0-1', () => {
    // Measured off pixel-9-pro-xl.glb: the screen is unwrapped
    // aspect-preserving and centred, so u covers only the middle 46%.
    // Mapping a screenshot onto raw UVs would squeeze it into that strip.
    const uv = [0.269743, 0, 0.730257, 0, 0.730257, 1, 0.269743, 1]
    const { min, span } = screenUvBounds(uv, 4)
    expect(min[0]).toBeCloseTo(0.269743, 6)
    expect(span[0]).toBeCloseTo(0.460514, 6)
    expect(span[1]).toBeCloseTo(1, 6)
  })

  it('falls back to the identity for a degenerate axis rather than NaN', () => {
    // Every v identical: dividing by a zero span would make the whole screen
    // NaN, which samples black — a device that silently lost its screenshot.
    const uv = [0, 0.5, 1, 0.5, 1, 0.5, 0, 0.5]
    expect(screenUvBounds(uv, 4)).toEqual({ min: [0, 0], span: [1, 1] })
  })

  it('handles an empty attribute', () => {
    expect(screenUvBounds([], 0)).toEqual({ min: [0, 0], span: [1, 1] })
  })

  it('reads a real BufferGeometry, and a missing uv attribute is the identity', () => {
    const plane = new THREE.PlaneGeometry(1, 2)
    expect(geometryUvBounds(plane)).toEqual({ min: [0, 0], span: [1, 1] })

    const bare = new THREE.BufferGeometry()
    expect(geometryUvBounds(bare)).toEqual({ min: [0, 0], span: [1, 1] })
  })
})

describe('findScreenMesh', () => {
  function model() {
    const root = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial()
    bodyMat.name = 'GP9XL_Frame'
    const screenMat = new THREE.MeshStandardMaterial()
    screenMat.name = 'GP9XL_Screen'

    // GLTFLoader sanitises and de-duplicates mesh names: a multi-primitive
    // mesh called `Circle.001` in the file loads as `Circle001`,
    // `Circle001_1`, … so the mesh name says nothing about which is which.
    const body = new THREE.Mesh(new THREE.BoxGeometry(), bodyMat)
    body.name = 'Circle001'
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(), screenMat)
    screen.name = 'Circle001_2'
    root.add(body, screen)
    return { root, screen, body }
  }

  it('finds the screen by material name, not mesh name', () => {
    const m = model()
    expect(findScreenMesh(m.root, 'GP9XL_Screen')).toBe(m.screen)
  })

  it('returns null when no material matches', () => {
    const m = model()
    expect(findScreenMesh(m.root, 'OLED')).toBeNull()
  })

  it('matches inside a multi-material mesh', () => {
    const root = new THREE.Group()
    const a = new THREE.MeshStandardMaterial()
    a.name = 'Body'
    const b = new THREE.MeshStandardMaterial()
    b.name = 'OLED'
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [a, b])
    root.add(mesh)
    expect(findScreenMesh(root, 'OLED')).toBe(mesh)
  })
})
