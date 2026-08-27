import { useMemo } from 'react'
import { Device } from './Device'
import { GltfDevice } from './GltfDevice'
import { getManifest } from '../devices/manifest'
import type { DeviceInstance } from '../store/schema'

/**
 * Renders one device instance. Everything model-specific is resolved from the
 * manifest here, so the stage only has to place groups — which is what lets a
 * scene hold a mix of different devices without the stage knowing about any
 * of them.
 */
export function DeviceInstanceView({ device }: { device: DeviceInstance }) {
  const manifest = getManifest(device.id)

  // Fall back to the first swatch so a project referencing a colorway this
  // device doesn't define still renders, rather than silently losing its finish.
  const colorwayMaterials = useMemo(
    () =>
      (manifest.colorways.find((c) => c.id === device.colorway) ?? manifest.colorways[0])
        .materials,
    [manifest, device.colorway],
  )

  return (
    /*
     * The manifest's corrective transform, applied innermost-first:
     * recentre in the model's own coordinates, then turn the device (for
     * landscape), then turn the model to face +Z, then scale onto the
     * 1-unit-per-10cm convention.
     *
     * Nested rather than set on one group because a single object applies
     * T * R * S — position last, in parent space — which would mean every
     * manifest offset had to be pre-rotated by hand. Splitting them lets
     * `position` be exactly the negated bbox centre the measure script
     * prints, which is a number a person can check.
     *
     * The landscape turn sits OUTSIDE the recentring group on purpose: it has
     * to pivot about the device's centre, and inside it would pivot about the
     * model's arbitrary authored origin — which for the Pixel is six units
     * away, swinging the phone clean out of frame.
     */
    <group scale={manifest.modelTransform?.scale ?? 1}>
      <group rotation={manifest.modelTransform?.rotation ?? [0, 0, 0]}>
        {/* Landscape is a rotation of the device, not a second model or a
            swapped screen aspect — the screenshot rotates with the hardware. */}
        <group rotation={[0, 0, device.orientation === 'landscape' ? Math.PI / 2 : 0]}>
          <group position={manifest.modelTransform?.position ?? [0, 0, 0]}>
            {manifest.glb ? (
              <GltfDevice
                url={manifest.glb}
                screenMaterialName={manifest.screenMaterialName}
                screenAspect={manifest.screenAspect}
                screenVisibleFraction={manifest.screenVisibleFraction}
                correctiveRotation={manifest.modelTransform?.rotation}
                screen={device.screen}
                screenFit={device.screenFit}
                colorwayMaterials={colorwayMaterials}
              />
            ) : (
              <Device
                screen={device.screen}
                screenFit={device.screenFit}
                colorwayMaterials={colorwayMaterials}
              />
            )}
          </group>
        </group>
      </group>
    </group>
  )
}
