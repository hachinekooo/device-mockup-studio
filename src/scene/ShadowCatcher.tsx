import * as THREE from 'three'
import { useMemo } from 'react'

type ShadowCatcherProps = {
  opacity: number
  /** Resolved by `projectGroundY` so the plane clears every device. */
  y: number
}

// A real shadow-catcher plane, not drei's baked ContactShadows (§6.4) — this
// responds correctly to camera/device motion and survives transparent export
// because ShadowMaterial composites onto clearAlpha = 0.
export function ShadowCatcher({ opacity, y }: ShadowCatcherProps) {
  const material = useMemo(
    () => new THREE.ShadowMaterial({ opacity, transparent: true }),
    [],
  )
  material.opacity = opacity

  return (
    // The height is computed, not fixed. At a hardcoded -0.76 this plane sat
    // 25mm below the iPhone 17 Pro but 55mm INSIDE every 16.3cm phone, and
    // because it is transparent it draws in the transparent pass — after the
    // opaque body — so the intersection appeared as a hard diagonal line
    // across the lower screen (§14 trap 11).
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <planeGeometry args={[12, 12]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
