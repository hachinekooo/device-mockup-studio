import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { measureScreenCoverage } from './screenCoverage'

/**
 * A screen the measurement should recognise: identified by its uniforms, not
 * its name, so this mirrors what `createScreenShaderMaterial` produces.
 */
function screenMesh(sourceHeight: number, repeatY = 1) {
  const texture = new THREE.Texture()
  texture.image = { width: sourceHeight / 2, height: sourceHeight }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uRepeat: { value: new THREE.Vector2(1, repeatY) },
      uOffset: { value: new THREE.Vector2(0, 0) },
    },
  })

  // 1x2 plane: uv.y runs along local +Y, from y=-1 to y=+1.
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 2), material)
}

/**
 * fov 90 puts the frustum half-height equal to the distance, so a 2-unit
 * plane at distance 2 covers exactly half the frame height. Every expected
 * number below follows from that by hand.
 */
function scene(mesh: THREE.Mesh, aspect: number) {
  const root = new THREE.Scene()
  root.add(mesh)
  const camera = new THREE.PerspectiveCamera(90, aspect, 0.1, 100)
  camera.position.set(0, 0, 2)
  camera.updateMatrixWorld(true)
  root.updateMatrixWorld(true)
  return { root, camera }
}

describe('measureScreenCoverage', () => {
  it('measures the rendered span from the projected uv.y axis', () => {
    const mesh = screenMesh(1000)
    const { root, camera } = scene(mesh, 1)

    const coverage = measureScreenCoverage(root, camera, 1000, 1000)!

    // Half the frame height of 1000px = 500px for a 1000px screenshot.
    expect(coverage.renderedHeight).toBe(500)
    expect(coverage.ratio).toBeCloseTo(0.5, 6)
    expect(coverage.heightFor1to1).toBe(2000)
  })

  it('is unchanged by an in-plane rotation of the device', () => {
    // Rolling the phone flat on screen moves its uv.y axis from vertical to
    // horizontal. The *length* on screen is identical, so sampling density is
    // too — which only holds if the span is a 2D distance in pixels rather
    // than an NDC vertical extent. Reading NDC y alone would report zero here.
    const upright = screenMesh(1000)
    const rolled = screenMesh(1000)
    rolled.rotation.z = Math.PI / 2

    const a = measureScreenCoverage(...sceneArgs(upright, 2000, 1000))!
    const b = measureScreenCoverage(...sceneArgs(rolled, 2000, 1000))!

    expect(b.renderedHeight).toBeCloseTo(a.renderedHeight, 6)
  })

  it('halves the rendered span when the device is pushed twice as far away', () => {
    const mesh = screenMesh(1000)
    const { root, camera } = scene(mesh, 1)
    camera.position.set(0, 0, 4)
    camera.updateMatrixWorld(true)

    const coverage = measureScreenCoverage(root, camera, 1000, 1000)!
    expect(coverage.renderedHeight).toBe(250)
  })

  it('accounts for the bezel inset carried in uRepeat', () => {
    // A repeat above 1 maps more texture rows across the same mesh span, so
    // each output pixel covers more of them and the ratio must drop.
    const mesh = screenMesh(1000, 2)
    const { root, camera } = scene(mesh, 1)

    const coverage = measureScreenCoverage(root, camera, 1000, 1000)!
    expect(coverage.ratio).toBeCloseTo(0.25, 6)
  })

  it('measures a video screen, which reports its size differently', () => {
    /*
     * The regression: a video element's `height` is its HTML attribute, 0 on
     * the detached element a VideoTexture wraps, so reading `height` made
     * this return null and the export panel silently dropped the sharpness
     * readout for every screen recording — the case that needs it most.
     */
    const mesh = screenMesh(1000)
    const texture = (mesh.material as THREE.ShaderMaterial).uniforms.map.value as THREE.Texture
    texture.image = { videoWidth: 500, videoHeight: 1000, width: 0, height: 0 }

    const { root, camera } = scene(mesh, 1)
    const coverage = measureScreenCoverage(root, camera, 1000, 1000)

    expect(coverage).not.toBeNull()
    expect(coverage!.sourceHeight).toBe(1000)
    // Same geometry as the first case: the mesh spans half the frame, so
    // half the source rows survive.
    expect(coverage!.renderedHeight).toBe(500)
  })

  it('returns null for a device with no screenshot on it', () => {
    const bare = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial())
    const { root, camera } = scene(bare, 1)

    expect(measureScreenCoverage(root, camera, 1000, 1000)).toBeNull()
  })
})

function sceneArgs(
  mesh: THREE.Mesh,
  width: number,
  height: number,
): [THREE.Object3D, THREE.Camera, number, number] {
  const { root, camera } = scene(mesh, width / height)
  return [root, camera, width, height]
}
