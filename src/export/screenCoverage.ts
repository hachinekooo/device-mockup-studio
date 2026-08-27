import * as THREE from 'three'
import { sampleTimeline } from '../timeline/sample'
import type { Project } from '../store/schema'

/**
 * How much of a screenshot's own resolution survives into the export.
 *
 * Supersampling fixed the *render*: at 3x the screen lands at or above 1:1
 * with its texture, so no detail is lost to a half-resolution mip. What it
 * cannot fix is the output canvas. A phone fills roughly 80% of frame height
 * in a typical pose, so at the default 1920x1080 a 2622px-tall screenshot is
 * reproduced on about 860 pixels — two thirds of its rows are discarded by
 * arithmetic, before any filtering is involved, and no amount of quality
 * setting brings them back.
 *
 * That is the answer to "it was crisp going in and soft coming out" once the
 * filtering losses are gone, and it is invisible in the UI: nothing in the
 * export dialog relates the output size to the screenshot's size. This
 * measures the relationship so it can be stated in pixels.
 */
export type ScreenCoverage = {
  /** The screenshot's own height, in pixels. */
  sourceHeight: number
  /** Output pixels the screenshot's full height is reproduced on. */
  renderedHeight: number
  /** renderedHeight / sourceHeight. 1 means nothing is thrown away. */
  ratio: number
  /** Output height at which `ratio` reaches 1, composition unchanged. */
  heightFor1to1: number
}

/**
 * The arithmetic, split out so it is testable without a GPU.
 *
 * `renderedSpanPx` is the on-screen length of the mesh's whole v axis and
 * `repeatY * sourceHeight` is the number of texture rows mapped across that
 * same span, so their quotient is texels-per-output-pixel directly. Taking
 * both over the identical uv range is what makes this correct under
 * letterboxing too: the black bars are counted on both sides and cancel.
 */
export function coverageFrom(
  sourceHeight: number,
  repeatY: number,
  renderedSpanPx: number,
  outputHeight: number,
): ScreenCoverage {
  const mappedRows = repeatY * sourceHeight
  if (!(mappedRows > 0) || !(renderedSpanPx > 0)) {
    return { sourceHeight, renderedHeight: sourceHeight, ratio: 1, heightFor1to1: outputHeight }
  }

  const ratio = renderedSpanPx / mappedRows
  return {
    sourceHeight,
    renderedHeight: Math.round(ratio * sourceHeight),
    ratio,
    // Round up: landing a pixel short still discards a row.
    heightFor1to1: Math.ceil(outputHeight / ratio),
  }
}

/** Endpoints of a geometry's v axis in local space, keyed by geometry. */
const vAxisCache = new WeakMap<THREE.BufferGeometry, { lo: THREE.Vector3; hi: THREE.Vector3 }>()

/**
 * Find the two positions that bracket the geometry's uv.y range.
 *
 * Read off the UV attribute rather than assuming the screen's long local axis
 * is the textured one — the iPhone GLB's screen plane lies in x/z with a
 * degenerate y, while the procedural fallback is a plain x/y plane, and a
 * heuristic that guessed wrong here would report a confidently wrong number.
 * Cached because this runs from a React render, not a frame loop.
 */
function vAxisEndpoints(geometry: THREE.BufferGeometry) {
  const cached = vAxisCache.get(geometry)
  if (cached) return cached

  const uv = geometry.getAttribute('uv')
  const position = geometry.getAttribute('position')
  if (!uv || !position) return null

  let loIndex = 0
  let hiIndex = 0
  for (let i = 1; i < uv.count; i++) {
    if (uv.getY(i) < uv.getY(loIndex)) loIndex = i
    if (uv.getY(i) > uv.getY(hiIndex)) hiIndex = i
  }

  const endpoints = {
    lo: new THREE.Vector3().fromBufferAttribute(position, loIndex),
    hi: new THREE.Vector3().fromBufferAttribute(position, hiIndex),
  }
  vAxisCache.set(geometry, endpoints)
  return endpoints
}

/**
 * Source height of whatever media is on a screen.
 *
 * A video element reports `videoHeight`; its `height` is the HTML attribute,
 * which is 0 on the detached element a VideoTexture wraps. Reading `height`
 * first silently returned 0 for every screen recording.
 */
function sourceHeightOf(texture: THREE.Texture | null | undefined): number {
  const image = texture?.image as
    | { videoHeight?: number; naturalHeight?: number; height?: number }
    | undefined
  return image?.videoHeight || image?.naturalHeight || image?.height || 0
}

type ScreenMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uRepeat: { value: THREE.Vector2 }
    map: { value: THREE.Texture | null }
  }
}

/**
 * Identify a screen by its material's uniforms rather than by mesh name.
 *
 * Names are per-manifest; the shader material is the one thing every textured
 * screen shares, so this keeps working as devices are added.
 */
function findScreen(scene: THREE.Object3D): { mesh: THREE.Mesh; material: ScreenMaterial } | null {
  let found: { mesh: THREE.Mesh; material: ScreenMaterial } | null = null
  scene.traverse((obj) => {
    if (found) return
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const material = mesh.material as ScreenMaterial
    if (!material?.uniforms?.uRepeat || !material.uniforms.map?.value?.image) return
    found = { mesh, material }
  })
  return found
}

/**
 * Measure the first textured screen in the scene against the export size.
 *
 * Returns null when there is no screenshot to measure — a blank device has
 * nothing to lose. The camera's aspect is read as-is rather than being
 * temporarily set to the output aspect: the artboard already letterboxes to
 * that ratio, and mutating a live camera from a render pass would flash the
 * preview. Only the horizontal component would shift anyway.
 */
export function measureScreenCoverage(
  scene: THREE.Object3D,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenCoverage | null {
  const screen = findScreen(scene)
  if (!screen) return null

  /*
   * `videoHeight` first, and it is not a nicety.
   *
   * A video element's `height` is its HTML *attribute* — the display size —
   * which is 0 on the detached element a VideoTexture wraps. Reading it gave
   * sourceHeight 0, so this returned null and the export panel silently
   * dropped the "Screenshot detail" readout for every screen recording. The
   * one number that explains why a screen comes out soft was missing from
   * exactly the case that most needs it: a 1080x2340 recording is taller
   * than most screenshots, so it is under-reproduced sooner.
   */
  const sourceHeight = sourceHeightOf(screen.material.uniforms.map.value)
  if (!sourceHeight) return null

  const endpoints = vAxisEndpoints(screen.mesh.geometry)
  if (!endpoints) return null

  screen.mesh.updateWorldMatrix(true, false)
  const lo = endpoints.lo.clone().applyMatrix4(screen.mesh.matrixWorld).project(camera)
  const hi = endpoints.hi.clone().applyMatrix4(screen.mesh.matrixWorld).project(camera)

  // Screen-space length, not vertical extent: a tilted device's v axis runs
  // diagonally across the frame, and it is the length along that axis that
  // sets how many texels each output pixel has to cover.
  const dx = ((hi.x - lo.x) / 2) * width
  const dy = ((hi.y - lo.y) / 2) * height
  const renderedSpanPx = Math.hypot(dx, dy)

  return coverageFrom(sourceHeight, screen.material.uniforms.uRepeat.value.y, renderedSpanPx, height)
}

// ---------------------------------------------------------------------------
// Worst case across the whole clip
// ---------------------------------------------------------------------------

/**
 * Every textured screen in the scene, with the device index driving its pose.
 *
 * The index comes from `userData.deviceIndex`, stamped on the group in
 * `Stage`. Matching by position among `scene.children` would work today and
 * break silently the first time anything else is added to the scene.
 */
function findScreens(scene: THREE.Object3D) {
  const screens: { mesh: THREE.Mesh; material: ScreenMaterial; deviceIndex: number }[] = []

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const material = mesh.material as ScreenMaterial
    if (!material?.uniforms?.uRepeat || !material.uniforms.map?.value?.image) return

    let node: THREE.Object3D | null = mesh
    while (node && node.userData.deviceIndex === undefined) node = node.parent
    if (!node) return

    screens.push({ mesh, material, deviceIndex: node.userData.deviceIndex as number })
  })

  return screens
}

/** Scratch objects — this runs per document edit, not per frame, but it runs
 *  over every sampled instant and allocating there adds up for nothing. */
const sampleCamera = new THREE.PerspectiveCamera()
const groupMatrix = new THREE.Matrix4()
const meshMatrix = new THREE.Matrix4()
const localMatrix = new THREE.Matrix4()
const scratchPosition = new THREE.Vector3()
const scratchQuaternion = new THREE.Quaternion()
const scratchEuler = new THREE.Euler()
const scratchScale = new THREE.Vector3()
const scratchTarget = new THREE.Vector3()
const loPoint = new THREE.Vector3()
const hiPoint = new THREE.Vector3()

/** Instants sampled across the clip. Enough to catch a pass through the
 *  closest point without sweeping every frame of a long timeline. */
const TIME_SAMPLES = 96

/**
 * The worst coverage any screen reaches at any point in the clip.
 *
 * `measureScreenCoverage` answers "how is it right now, for the first
 * screen" — which is the wrong question twice over once anything moves:
 *
 * - **Every device, not the first.** A duo scene has two screens at two
 *   different distances, and sizing for the further one leaves the nearer
 *   one short.
 * - **Every instant, not the playhead.** A spin brings the device closer at
 *   some `t`; that frame needs the most pixels, and it is the one nobody is
 *   looking at when they choose an export size.
 *
 * Evaluated as pure maths off `sampleTimeline`, never by posing the live
 * scene: writing poses here would fight `SceneDriver` and make the preview
 * twitch while the panel re-renders. `groundPlane.ts` resolves the shadow
 * catcher's height the same way and for the same reason.
 */
export function worstCaseScreenCoverage(
  scene: THREE.Object3D,
  project: Project,
  width: number,
  height: number,
): ScreenCoverage | null {
  const screens = findScreens(scene)
  if (screens.length === 0) return null

  scene.updateMatrixWorld(true)
  sampleCamera.aspect = width / height

  let worst: ScreenCoverage | null = null

  for (const screen of screens) {
    const sourceHeight = sourceHeightOf(screen.material.uniforms.map.value)
    if (!sourceHeight) continue

    const endpoints = vAxisEndpoints(screen.mesh.geometry)
    if (!endpoints) continue

    /*
     * The screen's transform *relative to its device group*, which is the
     * part that does not change with the timeline. The group's own matrix is
     * what the pose drives, so composing the two reconstructs the screen's
     * world matrix at any `t` without touching a single scene object.
     */
    let group: THREE.Object3D | null = screen.mesh
    while (group && group.userData.deviceIndex === undefined) group = group.parent
    if (!group) continue
    localMatrix.copy(group.matrixWorld).invert().multiply(screen.mesh.matrixWorld)

    const repeatY = screen.material.uniforms.uRepeat.value.y

    for (let i = 0; i < TIME_SAMPLES; i++) {
      const t = (i / TIME_SAMPLES) * project.duration
      const state = sampleTimeline(project, t)
      const pose = state.devices[screen.deviceIndex]
      if (!pose) continue

      sampleCamera.fov = state.camera.fov
      sampleCamera.position.set(...state.camera.position)
      scratchTarget.set(...state.camera.target)
      sampleCamera.lookAt(scratchTarget)
      sampleCamera.updateMatrixWorld(true)
      sampleCamera.updateProjectionMatrix()

      scratchPosition.set(...pose.position)
      scratchEuler.set(...pose.rotation)
      scratchQuaternion.setFromEuler(scratchEuler)
      scratchScale.setScalar(pose.scale)
      groupMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
      meshMatrix.multiplyMatrices(groupMatrix, localMatrix)

      loPoint.copy(endpoints.lo).applyMatrix4(meshMatrix).project(sampleCamera)
      hiPoint.copy(endpoints.hi).applyMatrix4(meshMatrix).project(sampleCamera)

      const dx = ((hiPoint.x - loPoint.x) / 2) * width
      const dy = ((hiPoint.y - loPoint.y) / 2) * height
      const coverage = coverageFrom(sourceHeight, repeatY, Math.hypot(dx, dy), height)

      // Worst = the frame demanding the most output pixels, i.e. the lowest
      // ratio. Sizing for anything else leaves some frame short.
      if (!worst || coverage.ratio < worst.ratio) worst = coverage
    }
  }

  return worst
}
