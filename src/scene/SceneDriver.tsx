import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { sampleTimeline } from '../timeline/sample'
import { useProjectStore } from '../store/project'
import { applySceneState } from './applySceneState'
import { registerSceneApplier } from '../export/renderer'
import { syncScreenVideos } from '../media/screenVideo'

type SceneDriverProps = {
  /** One group per device instance, in project order. */
  deviceRefs: React.RefObject<(THREE.Group | null)[]>
  /** True while the user is dragging OrbitControls — the camera is theirs then. */
  orbitingRef: React.RefObject<boolean>
}

/**
 * The one place scene objects are written each frame.
 *
 * Everything here reads from `sampleTimeline(project, t)` and nothing reads a
 * frame delta (§14 trap 5) — `delta` is used solely to advance the playhead,
 * i.e. to choose *which* `t` to ask for, never to compute a pose. That
 * distinction is what keeps preview and export in agreement: the export loop
 * feeds the same function a `t` it derives from a frame index instead.
 *
 * Store access is via getState() rather than a hook subscription on purpose.
 * A driver that subscribed to the project would re-render the whole scene
 * tree on every scrub (§14 trap 10); this one never re-renders at all.
 */
export function SceneDriver({ deviceRefs, orbitingRef }: SceneDriverProps) {
  const { camera } = useThree()

  /*
   * Publish "pose the scene at t" for the export loop.
   *
   * The export cannot go through useFrame — it renders with the loop stopped,
   * hundreds of times, at times of its own choosing — but it must not grow
   * its own copy of this logic either. Registering the applier from the one
   * component that owns the device refs keeps a single path: same sample,
   * same write, different clock.
   */
  useEffect(
    () =>
      registerSceneApplier((t) => {
        const { project } = useProjectStore.getState()
        applySceneState(sampleTimeline(project, t), deviceRefs.current, camera)
      }),
    [camera, deviceRefs],
  )

  useFrame((_, delta) => {
    const store = useProjectStore.getState()
    const { project, playing } = store

    let t = store.playhead
    if (playing) {
      t += delta
      if (t >= project.duration) t -= project.duration // loop
      store.setPlayhead(t)
    }

    // Screen recordings follow the playhead too — playing while the timeline
    // plays, seeked while it is scrubbed. Tolerant by design in preview; the
    // export seeks the same elements exactly (§8.3).
    syncScreenVideos(t, playing)

    // While the user is orbiting, the camera belongs to them; OrbitControls
    // commits the resulting pose back into the document on release. Applying
    // sampled state to it here too would fight the drag every frame.
    applySceneState(sampleTimeline(project, t), deviceRefs.current, camera, orbitingRef.current)
  })

  return null
}
