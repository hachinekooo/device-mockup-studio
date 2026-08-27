import * as THREE from 'three'

// Material recipes from spec §6.2. Image-based lighting only — no hand-placed
// lights feed these, `envMapIntensity` is how "shininess response" is tuned.

export function createBodyMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#c9cbd1',
    metalness: 0.9,
    roughness: 0.3,
    envMapIntensity: 1.1,
  })
}

export function createScreenMaterial(texture: THREE.Texture | null) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    color: texture ? '#ffffff' : '#0a0a0c',
    toneMapped: false, // screen content must bypass ACES — see spec §6.1
  })
}

export function createGlassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.12,
    roughness: 0.05,
    metalness: 0,
    envMapIntensity: 1.6,
    clearcoat: 1,
  })
}

export function applyUserTextureColorSpace(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
}
