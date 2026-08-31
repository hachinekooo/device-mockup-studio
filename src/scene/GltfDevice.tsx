import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { composeInset, containFitRepeatOffset, coverCropRepeatOffset } from './screenFit'
import {
  applyColorway,
  createBlankScreenMaterial,
  createScreenShaderMaterial,
  findScreenMesh,
  resolveScreenUv,
} from './materials/screenMaterial'
import { prepareScreenTexture } from './materials/screenTexture'
import { createScreenVideo } from '../media/screenVideo'
import type { MediaRef, ScreenFit } from '../store/schema'
import type { MaterialOverride } from '../devices/manifest'

type GltfDeviceProps = {
  url: string
  /** Material name of the screen. See `findScreenMesh` for why not a mesh name. */
  screenMaterialName: string
  screenAspect: number
  /**
   * Fraction of the screen mesh's own UV rect that is actually VISIBLE, i.e.
   * not covered by the bezel ring that sits in front of it. [x, y], both <= 1.
   */
  screenVisibleFraction: [number, number]
  /**
   * The manifest's model fixup rotation. Needed here, not just on the parent
   * group, to work out which way the screen's v axis runs — see
   * `screenUvRunsUp`.
   */
  correctiveRotation?: [number, number, number]
  screen: MediaRef | null
  screenFit: ScreenFit
  /** Per-material overrides for the selected colorway. */
  colorwayMaterials: Record<string, MaterialOverride>
}

// A screenshot captured at (or near) this device's real screen aspect gets
// mapped 1:1 onto the mesh, no crop — see the big comment below for why.
// Only a genuinely mismatched image (e.g. landscape on a portrait phone)
// falls back to crop-to-fill.
const STRETCH_TOLERANCE = 0.15 // 15% relative aspect difference

// Loads a device GLB per the §7 manifest convention and textures the image
// directly onto the model's own screen mesh (not a separate overlay plane),
// so the image is masked to the authentic silhouette for free.
//
// Trap: this mesh does NOT stop at the visible display area. It is a full
// rounded rect running edge to edge under the separate `Screen_Rim` bezel
// mesh, which shares its exact outer bbox and covers the outer ~3% on every
// side. Mapping UV 0..1 across the mesh therefore buries ~6.5% of the
// image's width and ~3% of its height under the bezel — the screenshot
// reads as zoomed in, and content pinned to an edge (the status bar clock,
// a right-hand carousel) gets eaten. `screenVisibleFraction` shrinks the
// image onto just the rim's inner opening so the whole frame stays visible.
//
// `screenAspect` must be measured once, offline (Blender bounding box on the
// exported mesh — see the fixup script), and passed in as a prop. Measuring
// it at runtime off the loaded Three.js mesh's Box3 is a trap: the clone has
// just been created and nothing has run updateMatrixWorld() on it yet, so
// the bbox can read back wrong (garbage aspect -> visibly wrong crop).
//
// `screenAspect` must likewise describe the rim's INNER opening, not the
// mesh bbox. Measured on the bbox it reads 0.479, which is ~4% off Apple's
// published 0.460 and makes every native screenshot look mismatched; the
// real opening is 0.462, within 0.5% of spec. With the right rectangle a
// native screenshot needs neither a crop nor a visible stretch, and the
// tolerance below only ever fires for genuinely mismatched images (a
// landscape shot, say).
export function GltfDevice({
  url,
  screenMaterialName,
  screenAspect,
  screenVisibleFraction,
  correctiveRotation,
  screen,
  screenFit,
  colorwayMaterials,
}: GltfDeviceProps) {
  const { scene } = useGLTF(url)
  const gl = useThree((s) => s.gl)
  const cloned = useMemo(() => scene.clone(true), [scene])
  const [screenMesh, setScreenMesh] = useState<THREE.Mesh | null>(null)

  useEffect(() => {
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
    })
    setScreenMesh(findScreenMesh(cloned, screenMaterialName))
  }, [cloned, screenMaterialName])

  const imageTexture = useMemo(() => {
    if (screen?.kind !== 'image') return null
    return prepareScreenTexture(new THREE.TextureLoader().load(screen.url), gl)
  }, [screen, gl])

  /*
   * A video screen is the same thing as far as everything downstream is
   * concerned — a Texture the shader samples — so the fit, bezel inset and
   * UV orientation below need no video-specific branch at all. What differs
   * is who advances it: the element registers itself with `screenVideo`,
   * which the preview loop nudges and the export loop seeks exactly (§8.3).
   */
  const video = useMemo(
    () =>
      screen?.kind === 'video'
        ? createScreenVideo(screen.url, screen.duration ?? 0, gl)
        : null,
    [screen, gl],
  )
  useEffect(() => () => video?.dispose(), [video])

  const screenTexture = imageTexture ?? video?.texture ?? null

  // Colorway repaint is its own pass: it depends on the model and the chosen
  // swatch, and must not re-run when the screenshot changes.
  useEffect(() => {
    applyColorway(cloned, colorwayMaterials, screenMaterialName)
  }, [cloned, colorwayMaterials, screenMaterialName])

  const screenMaterial = useMemo(
    () => (screenTexture ? createScreenShaderMaterial(screenTexture) : null),
    [screenTexture],
  )

  useEffect(() => {
    if (!screenMesh) return

    if (!screen || !screenMaterial) {
      screenMesh.material = createBlankScreenMaterial()
      return
    }

    const imageAspect = screen.width / screen.height
    const relativeDiff = Math.abs(imageAspect - screenAspect) / screenAspect

    // A near-native screenshot maps 1:1 under either fit mode — there is
    // nothing meaningful to crop or letterbox at half a percent, and the
    // imperceptible stretch beats slicing the status bar. Beyond the
    // tolerance the two modes genuinely diverge.
    const fit =
      relativeDiff <= STRETCH_TOLERANCE
        ? { repeat: [1, 1] as [number, number], offset: [0, 0] as [number, number] }
        : screenFit === 'contain'
          ? containFitRepeatOffset(screenAspect, 1, imageAspect)
          : coverCropRepeatOffset(screenAspect, 1, imageAspect)

    const { repeat, offset } = composeInset(fit, screenVisibleFraction)
    screenMaterial.uniforms.uRepeat.value.set(repeat[0], repeat[1])
    screenMaterial.uniforms.uOffset.value.set(offset[0], offset[1])

    // Normalise onto the mesh's own UV rect and orient it: not every model
    // unwraps its screen across a clean 0..1 square, and not every model runs
    // v up the device.
    const uv = resolveScreenUv(screenMesh, cloned, correctiveRotation)
    screenMaterial.uniforms.uUvMin.value.set(uv.min[0], uv.min[1])
    screenMaterial.uniforms.uUvSpan.value.set(uv.span[0], uv.span[1])

    screenMesh.material = screenMaterial
  }, [
    screenMesh,
    cloned,
    screen,
    screenMaterial,
    screenFit,
    screenAspect,
    screenVisibleFraction,
    correctiveRotation,
  ])

  return <primitive object={cloned} />
}

useGLTF.preload('/devices/iphone-17-pro.glb')
