import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createScreenShaderMaterial,
  flipUvBoundsU,
  flipUvBoundsV,
  resolveScreenUv,
  screenFacesViewer,
  screenUvRunsUp,
} from './screenMaterial'

/**
 * A screen quad with controllable UV direction and winding — the two things
 * models disagree about, and the two that produced a mirrored screenshot.
 */
function screenQuad({ vRunsUp = true, facesViewer = true } = {}) {
  const geometry = new THREE.BufferGeometry()
  // y = -1 at the bottom, +1 at the top.
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  )
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      vRunsUp ? [0, 0, 1, 0, 1, 1, 0, 1] : [0, 1, 1, 1, 1, 0, 0, 0],
      2,
    ),
  )
  const z = facesViewer ? 1 : -1
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 0, z, 0, 0, z, 0, 0, z, 0, 0, z], 3),
  )

  const root = new THREE.Group()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  root.add(mesh)
  root.updateMatrixWorld(true)
  return { root, mesh }
}

describe('flipUvBounds', () => {
  it('flips v by walking the rect backwards', () => {
    const flipped = flipUvBoundsV({ min: [0, 0.2], span: [1, 0.6] })
    expect(flipped.min[0]).toBe(0)
    expect(flipped.min[1]).toBeCloseTo(0.8, 10)
    expect(flipped.span[1]).toBeCloseTo(-0.6, 10)
    // The mapping (t - min) / span must still hit 0 and 1 at the rect edges,
    // just the other way round.
    const at = (t: number) => (t - flipped.min[1]) / flipped.span[1]
    expect(at(0.8)).toBeCloseTo(0, 10)
    expect(at(0.2)).toBeCloseTo(1, 10)
  })

  it('flips u the same way', () => {
    const flipped = flipUvBoundsU({ min: [0.25, 0], span: [0.5, 1] })
    const at = (t: number) => (t - flipped.min[0]) / flipped.span[0]
    expect(at(0.75)).toBeCloseTo(0, 10)
    expect(at(0.25)).toBeCloseTo(1, 10)
  })

  it('round-trips', () => {
    const start = { min: [0.1, 0.2] as [number, number], span: [0.5, 0.6] as [number, number] }
    const back = flipUvBoundsV(flipUvBoundsV(start))
    expect(back.min[1]).toBeCloseTo(start.min[1], 10)
    expect(back.span[1]).toBeCloseTo(start.span[1], 10)
  })
})

describe('screenUvRunsUp', () => {
  it('accepts a quad whose v increases toward the top', () => {
    const { root, mesh } = screenQuad({ vRunsUp: true })
    expect(screenUvRunsUp(mesh, root)).toBe(true)
  })

  it('catches an inverted unwrap', () => {
    // All three phones added after the 17 Pro are authored this way. Left
    // uncorrected the screenshot renders upside down and letter-mirrored.
    const { root, mesh } = screenQuad({ vRunsUp: false })
    expect(screenUvRunsUp(mesh, root)).toBe(false)
  })

  it('is judged after the corrective rotation, not before', () => {
    // Turning a device end-over-end changes which way its v axis points.
    const { root, mesh } = screenQuad({ vRunsUp: true })
    expect(screenUvRunsUp(mesh, root, [Math.PI, 0, 0])).toBe(false)
  })

  it('ignores a Y-axis turn, which does not change up', () => {
    const { root, mesh } = screenQuad({ vRunsUp: true })
    expect(screenUvRunsUp(mesh, root, [0, Math.PI, 0])).toBe(true)
  })
})

describe('screenFacesViewer', () => {
  it('accepts a quad wound toward the camera', () => {
    const { root, mesh } = screenQuad({ facesViewer: true })
    expect(screenFacesViewer(mesh, root)).toBe(true)
  })

  it('catches a quad wound into the body', () => {
    // The 17 Pro Max's OLED mesh. Double-sided it draws, but what you see is
    // the back face — the screenshot mirrored left-to-right.
    const { root, mesh } = screenQuad({ facesViewer: false })
    expect(screenFacesViewer(mesh, root)).toBe(false)
  })

  it('is judged after the corrective rotation', () => {
    const { root, mesh } = screenQuad({ facesViewer: true })
    expect(screenFacesViewer(mesh, root, [0, Math.PI, 0])).toBe(false)
  })
})

describe('resolveScreenUv', () => {
  it('leaves a well-formed screen alone', () => {
    const { root, mesh } = screenQuad()
    expect(resolveScreenUv(mesh, root)).toEqual({ min: [0, 0], span: [1, 1] })
  })

  it('corrects both axes when both are wrong', () => {
    // Exactly the 17 Pro Max: inverted unwrap AND reversed winding.
    const { root, mesh } = screenQuad({ vRunsUp: false, facesViewer: false })
    const uv = resolveScreenUv(mesh, root)
    expect(uv.span[0]).toBeCloseTo(-1, 10)
    expect(uv.span[1]).toBeCloseTo(-1, 10)
    expect(uv.min).toEqual([1, 1])
  })

  it('corrects only v when only v is wrong', () => {
    // The Pixel and the Galaxy.
    const { root, mesh } = screenQuad({ vRunsUp: false, facesViewer: true })
    const uv = resolveScreenUv(mesh, root)
    expect(uv.span[0]).toBeCloseTo(1, 10)
    expect(uv.span[1]).toBeCloseTo(-1, 10)
  })
})

describe('createScreenShaderMaterial', () => {
  it('is double-sided', () => {
    // A FrontSide screen material culls any model whose screen plane is wound
    // inward — the 17 Pro Max rendered no screenshot at all and showed its
    // own interior through the gap.
    expect(createScreenShaderMaterial(new THREE.Texture()).side).toBe(THREE.DoubleSide)
  })
})
