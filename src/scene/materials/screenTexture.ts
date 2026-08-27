import * as THREE from 'three'

/**
 * Configure a screenshot texture for maximum legibility.
 *
 * Three's defaults are wrong for this job in one specific way: `anisotropy`
 * is 1. A device tilted in the frame — which every showcase template does —
 * is minified much harder along one axis than the other, and with anisotropy
 * 1 the GPU must pick a mip level that satisfies the *worst* axis, softening
 * the entire screen to protect an edge case. Raising it to the hardware
 * maximum lets it take multiple taps along the major axis and stay on a
 * sharper mip.
 *
 * Mipmaps stay on. They are what stops a device shimmering while the camera
 * orbits, and with anisotropy raised they are no longer the thing costing us
 * sharpness — insufficient render resolution is (see `still.ts`).
 */
export function prepareScreenTexture(texture: THREE.Texture, renderer: THREE.WebGLRenderer) {
  texture.colorSpace = THREE.SRGBColorSpace // §14 trap 3
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}
