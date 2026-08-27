import type { DeviceId, Vec3 } from '../store/schema'

/**
 * Device descriptor (§7.1). One of these per model; the scene reads only
 * this, never a hardcoded device branch.
 */
export type DeviceManifest = {
  id: DeviceId
  name: string
  category: 'phone' | 'tablet' | 'laptop' | 'desktop' | 'watch' | 'browser'
  /** Null means procedural geometry rather than a loaded GLB. */
  glb: string | null
  screenMaterialName: string
  /**
   * Aspect of the area the viewer can actually SEE, which is not always the
   * screen mesh's own bbox — see `screenVisibleFraction`.
   */
  screenAspect: number
  /**
   * Fraction of the screen mesh's UV rect left uncovered by whatever bezel
   * geometry sits in front of it, as [x, y].
   *
   * Scanned models routinely run the screen mesh edge to edge underneath a
   * separate bezel ring, so mapping a screenshot across UV 0-1 buries its
   * outer few percent — the picture reads as zoomed in and anything pinned
   * to an edge (a status bar clock, a right-hand carousel) is cut off. [1, 1]
   * for a model whose screen mesh really is the display.
   */
  screenVisibleFraction: [number, number]
  screenCornerRadius: number
  /**
   * The device body's [width, height, depth] in scene units, AFTER
   * `modelTransform.scale`. 1 unit = 10cm, so these read as decimetres.
   *
   * Used to place the shadow catcher below every device in the scene. Fixed
   * at -0.76 it was exactly 25mm under the iPhone 17 Pro and 55mm INSIDE
   * every 16.3cm phone, so the plane sliced through their lower third and
   * drew a diagonal line across the screen (trap 11).
   *
   * Measured, not derived at runtime: reading a Box3 off a freshly cloned
   * GLTF gives garbage before updateMatrixWorld, and the shadow plane must
   * not wait on a model load to settle.
   */
  bodySize: Vec3
  /**
   * Corrective transform applied to the loaded model, so a downloaded GLB
   * does not have to be re-centred and re-scaled in Blender to satisfy the
   * "1 unit = 10cm, centred at origin, screen facing +Z" convention (§7.2).
   * Absorbing the convention here is what keeps the Blender pass for the
   * cases that genuinely need it — split meshes, broken UVs, junk geometry.
   *
   * Applied innermost-first: `position` shifts the model in its OWN
   * coordinates, then `rotation`, then `scale` (see DeviceInstanceView).
   * That ordering is deliberate — it makes `position` simply the negated
   * model-bbox centre as measured, with no need to pre-rotate the offset by
   * hand, which is exactly the kind of arithmetic that ships wrong.
   */
  modelTransform?: { scale?: number; rotation?: Vec3; position?: Vec3 }
  defaultCamera: { position: Vec3; fov: number }
  colorways: {
    id: string
    name: string
    swatch: string
    materials: Record<string, { color?: string; roughness?: number; metalness?: number }>
  }[]
}

// Measured on the GLB itself, in mesh-local units:
//   Screen mesh bbox        76.413 x 159.514   (aspect 0.4790)
//   Screen_Rim inner edge   71.465 x 154.568   (aspect 0.4624)
// The rim shares the screen mesh's exact outer bbox and covers the outer
// ~3% on every side, so the second pair is what the viewer sees. Apple's
// published display aspect for this device is 1206/2622 = 0.4600, which the
// visible opening matches to within 0.5% — the mesh bbox misses it by 4%.
// Re-measure both numbers per model; do not derive either at runtime
// (a freshly cloned scene has no world matrix, so Box3 reads back garbage).
const IPHONE_17_PRO_SCREEN_MESH = { width: 76.413, height: 159.514 }
const IPHONE_17_PRO_SCREEN_OPENING = { width: 71.465, height: 154.568 }

export const DEVICE_MANIFESTS: Record<DeviceId, DeviceManifest> = {
  'procedural-phone': {
    id: 'procedural-phone',
    name: 'Generic Phone',
    category: 'phone',
    glb: null,
    screenMaterialName: '',
    screenAspect: 0.6981 / 1.4574,
    screenVisibleFraction: [1, 1], // procedural geometry has no bezel overlay
    screenCornerRadius: 0.1,
    // BODY_WIDTH / BODY_HEIGHT / BODY_DEPTH in Device.tsx.
    bodySize: [0.72, 1.47, 0.08],
    defaultCamera: { position: [-2.2, 0.9, 2.4], fov: 32 },
    colorways: [
      { id: 'graphite', name: 'Graphite', swatch: '#3b3b3f', materials: { Body: { color: '#3b3b3f' } } },
      { id: 'silver', name: 'Silver', swatch: '#d9d9dd', materials: { Body: { color: '#d9d9dd' } } },
    ],
  },
  'iphone-17-pro': {
    id: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    category: 'phone',
    glb: '/devices/iphone-17-pro.glb',
    screenMaterialName: 'Screen',
    screenAspect: IPHONE_17_PRO_SCREEN_OPENING.width / IPHONE_17_PRO_SCREEN_OPENING.height,
    screenVisibleFraction: [
      IPHONE_17_PRO_SCREEN_OPENING.width / IPHONE_17_PRO_SCREEN_MESH.width,
      IPHONE_17_PRO_SCREEN_OPENING.height / IPHONE_17_PRO_SCREEN_MESH.height,
    ],
    screenCornerRadius: 0.1,
    bodySize: [0.7186, 1.47, 0.1026],
    // This scan already lands at the right scale and orientation once the
    // GLB's own node transforms are applied, so nothing to correct.
    modelTransform: undefined,
    defaultCamera: { position: [-2.2, 0.9, 2.4], fov: 32 },
    colorways: [
      {
        id: 'natural-titanium',
        name: 'Natural Titanium',
        swatch: '#b7b0a6',
        materials: { Rim_Buttons: { color: '#b7b0a6', roughness: 0.3, metalness: 0.9 } },
      },
      {
        id: 'black-titanium',
        name: 'Black Titanium',
        swatch: '#3a3a3c',
        materials: { Rim_Buttons: { color: '#3a3a3c', roughness: 0.32, metalness: 0.9 } },
      },
      {
        id: 'white-titanium',
        name: 'White Titanium',
        swatch: '#e6e3de',
        materials: { Rim_Buttons: { color: '#e6e3de', roughness: 0.28, metalness: 0.9 } },
      },
    ],
  },
  /*
   * The three models below were measured with
   * `node scripts/measure-device.mjs <file.glb>`. Every number is a
   * measurement, not a guess — re-run the script rather than nudging them.
   *
   * All three are authored in metres or near-metres with the screen facing
   * -Z, so each carries a recentring offset, a scale onto the 1-unit-per-10cm
   * convention, and (for two of them) a 180° turn.
   *
   * Screens are addressed by MATERIAL name. Two of these models are a single
   * multi-primitive mesh whose screen would otherwise have to be called
   * `Circle001_2` — a name that appears nowhere in the source file. See
   * `findScreenMesh`.
   */
  'iphone-17-pro-max': {
    id: 'iphone-17-pro-max',
    name: 'iPhone 17 Pro Max',
    category: 'phone',
    glb: '/devices/iphone-17-pro-max.glb',
    screenMaterialName: 'OLED',
    // Measured 0.460538; Apple publishes 1320/2868 = 0.4603, so the OLED mesh
    // IS the visible display here — nothing overlaps it (only a 12%-opacity
    // `Glass` sheet sits in front), hence a visible fraction of [1, 1] rather
    // than the rim inset the 17 Pro needs.
    screenAspect: 0.460538,
    screenVisibleFraction: [1, 1],
    screenCornerRadius: 0.1,
    bodySize: [0.79201, 1.634, 0.13291],
    modelTransform: {
      position: [0, 0, -0.00227],
      rotation: [0, Math.PI, 0],
      scale: 10,
    },
    defaultCamera: { position: [-2.2, 0.9, 2.4], fov: 32 },
    colorways: [
      {
        id: 'cosmic-orange',
        name: 'Cosmic Orange',
        swatch: '#cf3204',
        // As authored — the model ships in Cosmic Orange.
        materials: {},
      },
      {
        id: 'deep-blue',
        name: 'Deep Blue',
        swatch: '#2f4a6d',
        materials: {
          'Anodized aluminum': { color: '#2f4a6d' },
          'Plastic antena': { color: '#27405e' },
          'Metal tint': { color: '#35527a' },
          'Frosted glass': { color: '#2f4a6d' },
          'Tinted glass': { color: '#27405e' },
        },
      },
      {
        id: 'silver',
        name: 'Silver',
        swatch: '#e3e4e6',
        materials: {
          'Anodized aluminum': { color: '#e3e4e6' },
          'Plastic antena': { color: '#d3d4d6' },
          'Metal tint': { color: '#eceded' },
          'Frosted glass': { color: '#e3e4e6' },
          'Tinted glass': { color: '#d3d4d6' },
        },
      },
    ],
  },
  'pixel-9-pro-xl': {
    id: 'pixel-9-pro-xl',
    name: 'Google Pixel 9 Pro XL',
    category: 'phone',
    glb: '/devices/pixel-9-pro-xl.glb',
    screenMaterialName: 'GP9XL_Screen',
    screenAspect: 0.460538,
    // Nothing sits in front of this screen — it is the front-most primitive
    // in the model, so the whole mesh is visible.
    screenVisibleFraction: [1, 1],
    screenCornerRadius: 0.1,
    bodySize: [0.76656, 1.628, 0.12069],
    modelTransform: {
      // This model is authored a long way off the origin (z ~ 6.01).
      position: [0.10184, 0.002452, -6.012562],
      rotation: [0, Math.PI, 0],
      scale: 9.904475,
    },
    defaultCamera: { position: [-2.2, 0.9, 2.4], fov: 32 },
    colorways: [
      {
        id: 'obsidian',
        name: 'Obsidian',
        swatch: '#1b1b1b',
        materials: {},
      },
      {
        id: 'porcelain',
        name: 'Porcelain',
        swatch: '#e8e4dc',
        materials: {
          GP9XL_Frame: { color: '#d8d4cc', roughness: 0.12, metalness: 0.9 },
          GP9XL_Back: { color: '#e8e4dc', roughness: 0.55, metalness: 0.1 },
        },
      },
      {
        id: 'hazel',
        name: 'Hazel',
        swatch: '#8d8b7e',
        materials: {
          GP9XL_Frame: { color: '#7e7c70', roughness: 0.1, metalness: 0.95 },
          GP9XL_Back: { color: '#8d8b7e', roughness: 0.5, metalness: 0.2 },
        },
      },
    ],
  },
  'galaxy-s26-ultra': {
    id: 'galaxy-s26-ultra',
    name: 'Samsung Galaxy S26 Ultra',
    category: 'phone',
    glb: '/devices/galaxy-s26-ultra.glb',
    // This model's materials are all called `Material_1NN`; 173 is the screen,
    // identified by being the front-most perfectly flat primitive with a
    // clean 0-1 unwrap and a 0.4609 aspect.
    screenMaterialName: 'Material_173',
    screenAspect: 0.460905,
    screenVisibleFraction: [1, 1],
    screenCornerRadius: 0.1,
    bodySize: [0.7797, 1.628, 0.12303],
    modelTransform: {
      position: [0.014504, 0.02949, -0.000643],
      // Already faces +Z, unlike the other two.
      rotation: [0, 0, 0],
      scale: 1.936745,
    },
    defaultCamera: { position: [-2.2, 0.9, 2.4], fov: 32 },
    colorways: [
      {
        // This model is texture-driven — nearly every material is white with
        // a baseColor texture, so a colour override would tint the texture
        // rather than repaint the finish. Left as authored until someone can
        // look at it; a wrong swatch is worse than one honest swatch.
        id: 'titanium',
        name: 'Titanium',
        swatch: '#83a4be',
        materials: {},
      },
    ],
  },
}

export const DEVICE_LIST = Object.values(DEVICE_MANIFESTS)

export function getManifest(id: DeviceId): DeviceManifest {
  return DEVICE_MANIFESTS[id]
}
