import * as THREE from 'three'
import type { SceneState } from '../store/schema'

const target = new THREE.Vector3()

/**
 * Write a sampled SceneState onto real scene objects.
 *
 * Pulled out of SceneDriver so the export loop can pose the scene at an
 * arbitrary `t` without the render loop running. That is the whole of the
 * difference between preview and export (§4): preview asks for the `t` a
 * clock advanced to, export asks for `i / fps`, and both hand the answer to
 * this function. Anything that posed the scene differently for export would
 * be the broken abstraction the spec warns about.
 *
 * `skipCamera` covers the one case preview has and export does not: while
 * the user drags OrbitControls the camera belongs to them, and writing the
 * sampled pose would fight the drag every frame.
 */
export function applySceneState(
  state: SceneState,
  deviceGroups: (THREE.Group | null)[],
  camera: THREE.Camera,
  skipCamera = false,
) {
  // Index-matched to project.devices. A ref can be briefly absent while
  // React commits an added or removed device, so skip rather than assume.
  for (let i = 0; i < state.devices.length; i++) {
    const group = deviceGroups[i]
    if (!group) continue
    const pose = state.devices[i]
    group.position.set(...pose.position)
    group.rotation.set(...pose.rotation) // per-axis Euler (§8.1)
    group.scale.setScalar(pose.scale)
  }

  if (skipCamera) return

  camera.position.set(...state.camera.position)
  target.set(...state.camera.target)
  camera.lookAt(target)

  if (camera instanceof THREE.PerspectiveCamera && camera.fov !== state.camera.fov) {
    camera.fov = state.camera.fov
    camera.updateProjectionMatrix()
  }

  // `render()` flushes this anyway; doing it here keeps the world matrix in
  // step for anything that reads it *before* the render — screen-coverage
  // measurement being the one that does.
  camera.updateMatrixWorld()
}
