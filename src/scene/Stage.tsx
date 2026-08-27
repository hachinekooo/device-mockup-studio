import { Canvas, useThree } from '@react-three/fiber'
import { Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SceneDriver } from './SceneDriver'
import { ShadowCatcher } from './ShadowCatcher'
import { DeviceInstanceView } from './DeviceInstanceView'
import { useProjectStore } from '../store/project'
import { projectGroundY } from './groundPlane'
import { clearExportContext, registerExportContext } from '../export/renderer'

// Color management per spec §6.1. Screen content bypasses this via
// toneMapped: false on its material, set in materials/index.ts.
function ColorManagement() {
  const { gl } = useThree()
  useEffect(() => {
    gl.outputColorSpace = THREE.SRGBColorSpace
    /*
     * Khronos PBR Neutral, not ACES Filmic (§6.1 revisited).
     *
     * ACES is a *film* transform: it crushes shadows, desaturates as it
     * rolls off, and turns a metal rail's specular into a blown white
     * streak — the "lighting is too much" read. PBR Neutral exists for
     * exactly this job (product renders): it preserves the material's own
     * colour, so a titanium colourway stays the colour of the swatch, and
     * it rolls highlights off gently instead of clipping them.
     *
     * Screen content is unaffected either way — it bypasses tone mapping
     * entirely on its own unlit material.
     */
    gl.toneMapping = THREE.NeutralToneMapping
    gl.toneMappingExposure = 1.0
    gl.shadowMap.enabled = true
    gl.shadowMap.type = THREE.VSMShadowMap
  }, [gl])
  return null
}

/**
 * Half-width of the shadow camera, in scene units (1 unit = 10cm).
 *
 * 4 units covers the widest showcase template with room to spare; over a
 * 2048 map that is a 3.9mm shadow texel, which VSM blurs away entirely.
 */
const SHADOW_EXTENT = 4

function ExportBridge() {
  const { gl, scene, camera, setFrameloop } = useThree()
  useEffect(() => {
    registerExportContext({ renderer: gl, scene, camera, setFrameloop })
    return () => clearExportContext()
  }, [gl, scene, camera, setFrameloop])
  return null
}

export function Stage() {
  const project = useProjectStore((s) => s.project)
  const devices = project.devices
  const environment = useProjectStore((s) => s.project.environment)
  const setCameraPosition = useProjectStore((s) => s.setCameraPosition)

  /*
   * The shadow light is held in STATE, not a ref.
   *
   * It lives inside <Suspense>, whose fallback is null, so on the first
   * commit `lightRef.current` was null — the configuration effect below hit
   * its early return and, with deps that never changed again, never re-ran
   * once the environment finished loading and the light actually mounted.
   * Every shadow in the app was therefore drawn with three's DEFAULTS: a
   * 512x512 map, radius 1 and a +/-5 frustum, rather than the 2048 map and
   * VSM radius this code has always meant to set. That is what made the
   * contact shadow read as a hard blocky slab with a straight edge where
   * the map ran out.
   *
   * A state setter in the ref callback re-runs the effect on the commit
   * that mounts the light, which a ref cannot do.
   */
  const [shadowLight, setShadowLight] = useState<THREE.DirectionalLight | null>(null)
  const deviceRefs = useRef<(THREE.Group | null)[]>([])
  const orbitingRef = useRef(false)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  // Resolved per document edit, never per frame — a ground that slid under a
  // moving phone would read as the camera drifting.
  const groundY = useMemo(() => projectGroundY(project), [project])


  useEffect(() => {
    if (!shadowLight) return
    const shadow = shadowLight.shadow
    shadow.mapSize.set(2048, 2048)
    shadow.radius = environment.shadowBlur
    /*
     * VSM blurs the depth map with a fixed number of taps, so a large radius
     * spread over the default 8 samples bands into visible rings instead of
     * softening. Scaling the samples with the radius is what turns the blur
     * into an actual penumbra.
     */
    shadow.blurSamples = Math.min(32, Math.max(8, Math.round(environment.shadowBlur * 1.5)))
    shadow.bias = -0.0005

    /*
     * The frustum has to cover every device, not one phone at the origin.
     * At +/-1.5 a Trio or Perspective Row — which spread devices well past
     * 1.5 units — had the outer phones' shadows simply stop, with the
     * straight edge of the shadow map across the ground.
     */
    shadow.camera.left = -SHADOW_EXTENT
    shadow.camera.right = SHADOW_EXTENT
    shadow.camera.top = SHADOW_EXTENT
    shadow.camera.bottom = -SHADOW_EXTENT
    shadow.camera.near = 0.5
    shadow.camera.far = 12
    // Without this the camera keeps its old projection and every value
    // above is inert — the other half of why this never took effect.
    shadow.camera.updateProjectionMatrix()

    // Force the map to be reallocated at the new size//settings.
    shadow.map?.dispose()
    shadow.map = null
    shadow.needsUpdate = true
  }, [shadowLight, environment.shadowBlur])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
      onCreated={({ gl }) => gl.setClearAlpha(0)}
    >
      <ColorManagement />
      <ExportBridge />
      {/* Pose comes from SceneDriver each frame; this fov is only the value
          used before the first sample lands. */}
      <PerspectiveCamera makeDefault fov={30} />

      {/* Orbiting is a *camera edit*, not a viewport mode: on release the
          resulting position is written into the document, which is what keeps
          the inspector's numeric fields and the canvas showing one truth. */}
      <OrbitControls
        ref={controlsRef}
        target={[0, 0, 0]}
        enableDamping
        makeDefault
        onStart={() => {
          orbitingRef.current = true
        }}
        onEnd={() => {
          orbitingRef.current = false
          const p = controlsRef.current?.object.position
          if (p) setCameraPosition([p.x, p.y, p.z])
        }}
      />

      <SceneDriver deviceRefs={deviceRefs} orbitingRef={orbitingRef} />

      <Suspense fallback={null}>
        <Environment
          preset={environment.hdri}
          environmentIntensity={environment.intensity}
          environmentRotation={[0, environment.rotation, 0]}
          background={false}
        />

        {/* Image-based lighting only (§6.3) — this light casts shadow, contributes no illumination. */}
        {/* Higher and closer to overhead than the original [2, 4, 3]: a low
            light throws a long shadow off to the side, which reads as
            late-afternoon sun rather than as a product on a surface. */}
        <directionalLight ref={setShadowLight} position={[1.2, 6, 2]} intensity={0} castShadow />

        {devices.map((device, index) => (
          <group
            key={device.instanceId}
            ref={(group) => {
              deviceRefs.current[index] = group
              // Tag the group with its document index so measurements can map
              // a screen mesh back to the device whose pose drives it, without
              // depending on the order three.js happens to hold children in.
              if (group) group.userData.deviceIndex = index
            }}
          >
            <DeviceInstanceView device={device} />
          </group>
        ))}

        <ShadowCatcher opacity={environment.shadowOpacity} y={groundY} />
      </Suspense>
    </Canvas>
  )
}
