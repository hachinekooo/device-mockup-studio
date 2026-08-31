import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { roundedRectBodyGeometry, roundedRectPlaneGeometry } from './geometry'
import { createBodyMaterial, createGlassMaterial, createScreenMaterial } from './materials'
import { coverCropRepeatOffset, fitPlaneSize } from './screenFit'
import { prepareScreenTexture } from './materials/screenTexture'
import type { MaterialOverride } from '../devices/manifest'
import { createScreenVideo } from '../media/screenVideo'
import type { MediaRef, ScreenFit } from '../store/schema'

// Procedural phone: 1 unit = 10cm, iPhone-ish proportions (~1.47 units tall).
const BODY_WIDTH = 0.72
const BODY_HEIGHT = 1.47
const BODY_DEPTH = 0.08
const BODY_RADIUS = 0.14

const SCREEN_MARGIN = 0.035
const SCREEN_WIDTH = BODY_WIDTH - SCREEN_MARGIN * 2
const SCREEN_HEIGHT = BODY_HEIGHT - SCREEN_MARGIN * 2
const SCREEN_RADIUS = 0.1

type DeviceProps = {
  screen: MediaRef | null
  screenFit: ScreenFit
  colorwayMaterials: Record<string, MaterialOverride>
}

export function Device({ screen, screenFit, colorwayMaterials }: DeviceProps) {
  const { bodyGeo, frontZ } = useMemo(() => {
    const geo = roundedRectBodyGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_RADIUS, BODY_DEPTH)
    geo.computeBoundingBox()
    // ExtrudeGeometry's bevel extends past the requested depth, so the true
    // front face isn't at BODY_DEPTH/2 — read it back from the geometry.
    return { bodyGeo: geo, frontZ: geo.boundingBox!.max.z }
  }, [])
  // The procedural device has one paintable part, named 'Body' to match the
  // manifest's material keys so colorways are expressed the same way here as
  // for a loaded GLB.
  const bodyMat = useMemo(() => {
    const material = createBodyMaterial()
    const override = colorwayMaterials['Body']
    if (override?.color) material.color = new THREE.Color(override.color)
    if (override?.roughness !== undefined) material.roughness = override.roughness
    if (override?.metalness !== undefined) material.metalness = override.metalness
    return material
  }, [colorwayMaterials])

  const screenGeo = useMemo(
    () => roundedRectPlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT, SCREEN_RADIUS),
    [],
  )
  const glassGeo = useMemo(
    () => roundedRectPlaneGeometry(BODY_WIDTH, BODY_HEIGHT, BODY_RADIUS),
    [],
  )
  const glassMat = useMemo(() => createGlassMaterial(), [])
  const bezelMat = useMemo(() => createScreenMaterial(null), [])

  const imageTexture = useScreenTexture(screen)

  const { imagePlaneGeo, imageTransform } = useMemo(() => {
    if (!screen || !imageTexture) return { imagePlaneGeo: null, imageTransform: null }
    const imageAspect = screen.width / screen.height
    // Match the screen bezel's corner radius so the image is masked to the
    // same rounded silhouette, not a sharp-cornered rectangle poking past it.
    const radiusRatio = SCREEN_RADIUS / Math.min(SCREEN_WIDTH, SCREEN_HEIGHT)
    if (screenFit === 'contain') {
      const size = fitPlaneSize(SCREEN_WIDTH, SCREEN_HEIGHT, imageAspect, 'contain')
      const radius = radiusRatio * Math.min(size.width, size.height)
      return {
        imagePlaneGeo: roundedRectPlaneGeometry(size.width, size.height, radius),
        imageTransform: null,
      }
    }
    const { repeat, offset } = coverCropRepeatOffset(SCREEN_WIDTH, SCREEN_HEIGHT, imageAspect)
    return {
      imagePlaneGeo: roundedRectPlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT, SCREEN_RADIUS),
      imageTransform: { repeat, offset },
    }
  }, [screen, imageTexture, screenFit])

  if (imageTexture && imageTransform) {
    imageTexture.repeat.set(...imageTransform.repeat)
    imageTexture.offset.set(...imageTransform.offset)
    imageTexture.needsUpdate = true
  } else if (imageTexture) {
    imageTexture.repeat.set(1, 1)
    imageTexture.offset.set(0, 0)
    imageTexture.needsUpdate = true
  }

  const imageMat = useMemo(() => createScreenMaterial(imageTexture), [imageTexture])

  return (
    <group>
      <mesh geometry={bodyGeo} material={bodyMat} castShadow receiveShadow />
      <mesh geometry={screenGeo} material={bezelMat} position={[0, 0, frontZ + 0.001]} />
      {imagePlaneGeo && (
        <mesh
          geometry={imagePlaneGeo}
          material={imageMat}
          position={[0, 0, frontZ + 0.002]}
        />
      )}
      <mesh geometry={glassGeo} material={glassMat} position={[0, 0, frontZ + 0.004]} />
    </group>
  )
}

/**
 * Screen texture for either kind of media. A video screen produces a
 * VideoTexture that advances itself from timeline time (see
 * `media/screenVideo.ts`); everything downstream — fit, crop, material —
 * treats it as an ordinary texture.
 */
function useScreenTexture(screen: MediaRef | null): THREE.Texture | null {
  const gl = useThree((s) => s.gl)

  const image = useMemo(() => {
    if (screen?.kind !== 'image') return null
    return prepareScreenTexture(new THREE.TextureLoader().load(screen.url), gl)
  }, [screen, gl])

  const video = useMemo(
    () =>
      screen?.kind === 'video'
        ? createScreenVideo(screen.url, screen.duration ?? 0, gl)
        : null,
    [screen, gl],
  )
  useEffect(() => () => video?.dispose(), [video])

  return image ?? video?.texture ?? null
}
