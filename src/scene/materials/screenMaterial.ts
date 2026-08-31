import * as THREE from 'three'
import type { MaterialOverride } from '../../devices/manifest'

/**
 * Unlit screen material with an explicit UV transform and a hard black
 * letterbox outside 0..1.
 *
 * A plain MeshBasicMaterial can't do the letterbox: `texture.repeat > 1`
 * pushes samples outside the image, and every wrap mode is wrong there —
 * ClampToEdge smears the edge pixel into a streak, Repeat tiles the UI.
 * There is no border colour in WebGL, so the fill has to happen in the
 * shader.
 *
 * `#include <colorspace_fragment>` is what keeps this consistent with the
 * rest of the scene: the texture is uploaded as sRGB so sampling returns
 * linear, and that include converts back to the renderer's output space.
 * Tone mapping is deliberately not applied — screen content bypasses ACES
 * (§6.1), which is the whole reason this isn't a lit material.
 */
export function createScreenShaderMaterial(texture: THREE.Texture) {
  return new THREE.ShaderMaterial({
    /*
     * Double-sided, because which way a screen plane's normals point is an
     * authoring accident. The iPhone 17 Pro Max's OLED mesh faces INTO the
     * body, so with the default FrontSide it was culled entirely: the screen
     * showed the black `Display Frame` behind it and the phone's interior
     * through any gap — "no screenshot, and I can see the insides".
     *
     * Every one of these GLBs declares its own materials `doubleSided`, so
     * replacing one with a FrontSide material was a silent downgrade. A flat
     * plane costs nothing to draw twice.
     */
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: texture },
      uRepeat: { value: new THREE.Vector2(1, 1) },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uLetterbox: { value: new THREE.Color('#000000') },
      // Normalises the mesh's own UV rect to 0..1 before the fit is applied.
      // See `screenUvBounds`.
      uUvMin: { value: new THREE.Vector2(0, 0) },
      uUvSpan: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uRepeat;
      uniform vec2 uOffset;
      uniform vec3 uLetterbox;
      uniform vec2 uUvMin;
      uniform vec2 uUvSpan;
      varying vec2 vUv;

      void main() {
        // Not every screen mesh is unwrapped across a full 0..1 rect — the
        // Pixel's spans u[0.27, 0.73] — so normalise onto the mesh's own UV
        // rect first, then apply the fit. A clean unwrap makes this a no-op.
        vec2 base = (vUv - uUvMin) / uUvSpan;
        vec2 uv = base * uRepeat + uOffset;
        vec3 sampled = texture2D(map, clamp(uv, 0.0, 1.0)).rgb;
        // Outside the image is letterbox, not a smeared edge pixel.
        bvec2 lo = lessThan(uv, vec2(0.0));
        bvec2 hi = greaterThan(uv, vec2(1.0));
        float outside = float(any(lo) || any(hi));
        gl_FragColor = vec4(mix(sampled, uLetterbox, outside), 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
}

export function createBlankScreenMaterial() {
  return new THREE.MeshBasicMaterial({ color: '#0a0a0c', toneMapped: false })
}

/**
 * The UV rect a screen mesh is actually unwrapped across.
 *
 * Not every model unwraps its screen over a clean 0..1 square. The Pixel 9
 * Pro XL's spans u[0.2697, 0.7303] — an aspect-preserving unwrap centred in
 * the map — so mapping a screenshot straight onto raw UVs squeezes it into
 * the middle 46% of the display. Measuring the rect off the geometry and
 * normalising is self-correcting: it needs no per-device manifest number and
 * cannot drift out of date when a model is re-exported.
 *
 * Pure over a flat array so it can be tested without a GPU or a loader.
 */
export function screenUvBounds(uv: ArrayLike<number>, count: number) {
  if (count === 0) return { min: [0, 0] as [number, number], span: [1, 1] as [number, number] }

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (let i = 0; i < count; i++) {
    const u = uv[i * 2]
    const v = uv[i * 2 + 1]
    if (u < uMin) uMin = u
    if (u > uMax) uMax = u
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
  }

  // A degenerate axis would divide by zero and turn the whole screen into
  // NaN — which samples as black, i.e. a device that silently lost its
  // screenshot. Fall back to the identity mapping instead.
  const uSpan = uMax - uMin
  const vSpan = vMax - vMin
  if (!(uSpan > 0) || !(vSpan > 0)) {
    return { min: [0, 0] as [number, number], span: [1, 1] as [number, number] }
  }
  return { min: [uMin, vMin] as [number, number], span: [uSpan, vSpan] as [number, number] }
}

/** `screenUvBounds` over a loaded geometry's uv attribute. */
export function geometryUvBounds(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return { min: [0, 0] as [number, number], span: [1, 1] as [number, number] }
  return screenUvBounds(uv.array as ArrayLike<number>, uv.count)
}

export type UvBounds = { min: [number, number]; span: [number, number] }

/**
 * Invert the v axis of a UV rect.
 *
 * Expressed as a negative span rather than a shader branch: the mapping
 * `(v - min) / span` already reverses when `min` is the top edge and `span`
 * is negative, so nothing downstream — the fit, the bezel inset, the
 * letterbox test — needs to know this happened.
 */
export function flipUvBoundsV(bounds: UvBounds): UvBounds {
  return {
    min: [bounds.min[0], bounds.min[1] + bounds.span[1]],
    span: [bounds.span[0], -bounds.span[1]],
  }
}

/** Mirror the u axis. Same negative-span trick as `flipUvBoundsV`. */
export function flipUvBoundsU(bounds: UvBounds): UvBounds {
  return {
    min: [bounds.min[0] + bounds.span[0], bounds.min[1]],
    span: [-bounds.span[0], bounds.span[1]],
  }
}

/**
 * Does this screen's v axis run UP the device, or down it?
 *
 * glTF's UV origin is top-left and three flips textures on upload, but
 * exporters disagree about which way a screen quad's v should run, and
 * nothing in the file records the intent. All three phones added after the
 * 17 Pro have it inverted, so a screenshot came out mirrored top-to-bottom —
 * "TOP" at the bottom of the display, every letter flipped.
 *
 * Rather than carry a per-device flag that nobody can check without looking
 * at the screen, measure it: find the vertices at the extremes of v, put them
 * in the device's final orientation, and ask which one ends up higher. This
 * is self-correcting for the next model and needs no manual step.
 *
 * `correctiveRotation` is the manifest's model fixup — the landscape turn is
 * deliberately NOT included, because in landscape the screenshot is supposed
 * to rotate with the hardware.
 */
export function screenUvRunsUp(
  mesh: THREE.Mesh,
  modelRoot: THREE.Object3D,
  correctiveRotation: [number, number, number] = [0, 0, 0],
): boolean {
  const uv = mesh.geometry.getAttribute('uv')
  const position = mesh.geometry.getAttribute('position')
  if (!uv || !position) return true

  let lo = 0
  let hi = 0
  for (let i = 1; i < uv.count; i++) {
    if (uv.getY(i) < uv.getY(lo)) lo = i
    if (uv.getY(i) > uv.getY(hi)) hi = i
  }

  // Relative to the model root, not matrixWorld: the root may already be
  // parented under the groups that apply `correctiveRotation`, and reading
  // matrixWorld would then apply that rotation twice.
  mesh.updateWorldMatrix(true, false)
  modelRoot.updateWorldMatrix(true, false)
  const relative = new THREE.Matrix4()
    .copy(modelRoot.matrixWorld)
    .invert()
    .multiply(mesh.matrixWorld)

  const euler = new THREE.Euler(...correctiveRotation)
  const at = (index: number) =>
    new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(relative).applyEuler(euler)

  return at(hi).y >= at(lo).y
}

/**
 * Does the screen plane's front face point at the viewer?
 *
 * The iPhone 17 Pro Max's OLED mesh is wound facing INTO the body. With the
 * material double-sided it draws, but what you see is its back face — and a
 * back face shows the texture mirrored left-to-right, so the screenshot came
 * out reversed with the device otherwise perfectly correct.
 *
 * Detecting it here rather than flipping the model: the body geometry is
 * right, only the screen quad's winding is backwards, and mirroring u is the
 * exact compensation.
 */
export function screenFacesViewer(
  mesh: THREE.Mesh,
  modelRoot: THREE.Object3D,
  correctiveRotation: [number, number, number] = [0, 0, 0],
): boolean {
  const normal = mesh.geometry.getAttribute('normal')
  if (!normal) return true

  mesh.updateWorldMatrix(true, false)
  modelRoot.updateWorldMatrix(true, false)
  const relative = new THREE.Matrix4()
    .copy(modelRoot.matrixWorld)
    .invert()
    .multiply(mesh.matrixWorld)

  // Average a few vertices rather than trusting index 0 — a screen is flat,
  // but a stray normal on a rounded corner should not decide this.
  const accumulated = new THREE.Vector3()
  const sampled = Math.min(normal.count, 32)
  const one = new THREE.Vector3()
  for (let i = 0; i < sampled; i++) {
    accumulated.add(one.fromBufferAttribute(normal, i))
  }

  accumulated
    .normalize()
    .transformDirection(relative)
    .applyEuler(new THREE.Euler(...correctiveRotation))

  // The convention puts the screen facing +Z with the camera on +Z (§7.2).
  return accumulated.z >= 0
}

/**
 * The UV rect to sample a screenshot through: normalised to the mesh's own
 * unwrap, turned the right way up, and un-mirrored.
 */
export function resolveScreenUv(
  mesh: THREE.Mesh,
  modelRoot: THREE.Object3D,
  correctiveRotation?: [number, number, number],
): UvBounds {
  let bounds = geometryUvBounds(mesh.geometry)
  if (!screenUvRunsUp(mesh, modelRoot, correctiveRotation)) bounds = flipUvBoundsV(bounds)
  if (!screenFacesViewer(mesh, modelRoot, correctiveRotation)) bounds = flipUvBoundsU(bounds)
  return bounds
}

/**
 * Find a device's screen by MATERIAL name, never by mesh name.
 *
 * GLTFLoader sanitises mesh names and de-duplicates them against a counter
 * shared with nodes: `Circle.001` loads as `Circle001`, `iPhone 17 Pro.001`
 * as `iPhone_17_Pro001`, and every primitive after the first picks up a
 * `_1`, `_2` … suffix (three/GLTFLoader.js, `createUniqueName`). Two of the
 * three phone models here are a single multi-primitive mesh, so their screen
 * would have to be addressed as `Circle001_2` — a name that exists nowhere
 * in the source file and shifts if the exporter reorders primitives.
 *
 * Material names are assigned verbatim, with no sanitising and no counter
 * (GLTFLoader.js: `if ( materialDef.name ) material.name = materialDef.name`),
 * so they are the stable handle. Colorways already key on them.
 */
export function findScreenMesh(root: THREE.Object3D, materialName: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((obj) => {
    if (found) return
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((m) => m?.name === materialName)) found = mesh
  })
  return found
}

/**
 * Apply a colorway's per-material overrides to a loaded model.
 *
 * Materials are cloned before mutation — a GLTF's materials are shared by
 * every clone of that scene, so writing to them in place would repaint each
 * other instance of the device (and persist into the cached loader result,
 * so the next mount would start out already recoloured).
 *
 * `skipMaterialName` protects the screen. It is a material name rather than
 * a mesh name because that is the only identifier GLTFLoader leaves intact —
 * see `findScreenMesh`.
 */
// A colourway can be changed repeatedly on one cloned scene. Always derive
// the next material from the original GLTF material rather than the previous
// swatch's clone; otherwise a removed colour map can never be restored.
const colorwaySourceMaterials = new WeakMap<THREE.Material, THREE.Material>()

export function applyColorway(
  root: THREE.Object3D,
  overrides: Record<string, MaterialOverride>,
  skipMaterialName?: string,
) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const next = materials.map((material) => {
      if (material?.name === skipMaterialName) return material
      const source = colorwaySourceMaterials.get(material) ?? material
      const override = overrides[source.name]
      // An "as authored" finish deliberately has no overrides. If this
      // material came from an earlier colourway, put the GLTF source back;
      // untouched materials keep their existing identity.
      if (!override) return source
      const clone = source.clone() as THREE.MeshStandardMaterial
      colorwaySourceMaterials.set(clone, source)
      if (override.color) clone.color = new THREE.Color(override.color)
      if (override.roughness !== undefined) clone.roughness = override.roughness
      if (override.metalness !== undefined) clone.metalness = override.metalness
      if (override.removeColorMap) {
        clone.map = null
        clone.needsUpdate = true
      }
      return clone
    })
    mesh.material = Array.isArray(mesh.material) ? next : next[0]
  })
}
