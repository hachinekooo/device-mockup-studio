#!/usr/bin/env node
/**
 * Measure a device GLB and print the numbers a DeviceManifest needs.
 *
 * Usage:  node scripts/measure-device.mjs <file.glb> [ScreenMaterialName]
 *
 * Exists so adding a device does not require opening Blender just to read
 * geometry back. It reports:
 *   - every primitive with its world-space bbox and material name
 *   - the screen's aspect and the UV rect it is unwrapped across
 *   - the visible opening, if a bezel sits over the screen
 *   - a paste-ready manifest block, modelTransform included
 *
 * Draco-compressed files are decoded to a temp copy automatically via
 * @gltf-transform/cli, which is fetched on demand with npx.
 *
 * Two things this script learned the hard way:
 *
 * 1. It used to read only `mesh.primitives[0]`. Three of the four models
 *    here are a SINGLE mesh carrying 18-19 primitives, so it saw one
 *    primitive out of nineteen and reported "no screen mesh found" — which
 *    reads as "this model is unusable" rather than "the script is wrong".
 *
 * 2. It ignored node transforms and read raw mesh coordinates. Models that
 *    carry their scale or orientation on the node then measure wrong, with
 *    no sign that anything is off.
 *
 * Both are fixed below: every primitive is enumerated, in world space.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [, , inputPath, screenMaterialArg] = process.argv
if (!inputPath) {
  console.error('usage: node scripts/measure-device.mjs <file.glb> [ScreenMaterialName]')
  process.exit(1)
}

function parseGlb(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`)
  const jsonLength = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'))
  return { json, bin: buf.subarray(20 + jsonLength + 8) }
}

let { json, bin } = parseGlb(inputPath)

if (json.extensionsUsed?.includes('KHR_draco_mesh_compression')) {
  const out = join(mkdtempSync(join(tmpdir(), 'measure-')), 'decoded.glb')
  console.log('Draco-compressed — decoding to a temp copy…')
  execFileSync('npx', ['--yes', '@gltf-transform/cli@latest', 'copy', inputPath, out], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  ;({ json, bin } = parseGlb(out))
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function readAccessor(index) {
  const accessor = json.accessors[index]
  const view = json.bufferViews[accessor.bufferView]
  const size = COMPONENTS[accessor.type]
  // Interleaved buffer views carry a byteStride; ignoring it silently reads
  // neighbouring attributes as if they were positions.
  const stride = view.byteStride || size * 4
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0)
  const rows = []
  for (let i = 0; i < accessor.count; i++) {
    const row = []
    for (let c = 0; c < size; c++) row.push(bin.readFloatLE(base + i * stride + c * 4))
    rows.push(row)
  }
  return rows
}

// --- node transforms, column-major like glTF --------------------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function multiply(a, b) {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix
  const [tx, ty, tz] = node.translation || [0, 0, 0]
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale || [1, 1, 1]
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
  const xx = qx * x2, xy = qx * y2, xz = qx * z2
  const yy = qy * y2, yz = qy * z2, zz = qz * z2
  const wx = qw * x2, wy = qw * y2, wz = qw * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

const transform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

const primitives = []
function walk(nodeIndex, parentMatrix) {
  const node = json.nodes[nodeIndex]
  const world = multiply(parentMatrix, nodeMatrix(node))
  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh]
    mesh.primitives.forEach((primitive, i) => {
      primitives.push({
        // Mirrors GLTFLoader's naming, which sanitises and de-duplicates —
        // shown only for orientation. Address the screen by MATERIAL name.
        name: i === 0 ? mesh.name : `${mesh.name}_${i}`,
        material: json.materials?.[primitive.material]?.name ?? '(none)',
        positions: readAccessor(primitive.attributes.POSITION).map((p) => transform(world, p)),
        uvs:
          primitive.attributes.TEXCOORD_0 !== undefined
            ? readAccessor(primitive.attributes.TEXCOORD_0)
            : null,
      })
    })
  }
  for (const child of node.children || []) walk(child, world)
}
for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, IDENTITY)

// --- geometry ---------------------------------------------------------------

const extent = (rows, axis) => ({
  min: Math.min(...rows.map((r) => r[axis])),
  max: Math.max(...rows.map((r) => r[axis])),
})
const span = (e) => e.max - e.min
const mid = (e) => (e.min + e.max) / 2
const f = (n) => n.toFixed(4)
const AXIS = 'xyz'

for (const p of primitives) {
  p.bbox = [extent(p.positions, 0), extent(p.positions, 1), extent(p.positions, 2)]
}

const everything = primitives.flatMap((p) => p.positions)
const modelBox = [extent(everything, 0), extent(everything, 1), extent(everything, 2)]
const modelSpans = modelBox.map(span)

// A phone is thin in one axis, tall in another. Deriving these rather than
// assuming y-up keeps the script working on models exported from anything.
const depthAxis = modelSpans.indexOf(Math.min(...modelSpans))
const heightAxis = modelSpans.indexOf(Math.max(...modelSpans))
const widthAxis = [0, 1, 2].find((a) => a !== depthAxis && a !== heightAxis)

console.log('\n--- primitives (world space) ---')
for (const p of primitives) {
  console.log(
    `${p.name.padEnd(24)} mat=${p.material.padEnd(24)} ` +
      `${f(span(p.bbox[widthAxis]))} x ${f(span(p.bbox[heightAxis]))}  ` +
      `depth ${f(span(p.bbox[depthAxis]))}`,
  )
}

console.log('\n--- model ---')
console.log(
  `bbox ${f(modelSpans[widthAxis])} (w, ${AXIS[widthAxis]}) x ` +
    `${f(modelSpans[heightAxis])} (h, ${AXIS[heightAxis]}) x ` +
    `${f(modelSpans[depthAxis])} (d, ${AXIS[depthAxis]})`,
)
console.log(`centre [${modelBox.map((e) => f(mid(e))).join(', ')}]`)

// --- pick the screen --------------------------------------------------------

const frontalArea = (p) => span(p.bbox[widthAxis]) * span(p.bbox[heightAxis])

// A display is PERFECTLY flat — a single plane, depth exactly 0. The
// tolerance here has to stay tight: the 17 Pro Max's cover `Glass` is only
// 0.55% of body height deep and has a larger frontal area than the display,
// so a 1% threshold picks the glass and reports a screen 2% too wide with a
// bezel that does not exist. Anything with measurable depth is a shell.
const screen = screenMaterialArg
  ? primitives.find((p) => p.material === screenMaterialArg)
  : primitives
      .filter((p) => span(p.bbox[depthAxis]) < span(p.bbox[heightAxis]) * 0.0005)
      .sort((a, b) => frontalArea(b) - frontalArea(a))[0]

if (!screen) {
  console.log(
    screenMaterialArg
      ? `\nNo primitive uses material "${screenMaterialArg}".`
      : '\nNo flat screen-like primitive found — pass its material name as the second argument.',
  )
  process.exit(0)
}

const screenW = span(screen.bbox[widthAxis])
const screenH = span(screen.bbox[heightAxis])

console.log(`\n--- screen: material "${screen.material}" (loads as mesh ${screen.name}) ---`)
console.log(`bbox ${f(screenW)} x ${f(screenH)}  (aspect ${(screenW / screenH).toFixed(6)})`)

if (screen.uvs) {
  const u = extent(screen.uvs, 0)
  const v = extent(screen.uvs, 1)
  const clean = span(u) > 0.999 && span(v) > 0.999 && u.min > -0.001 && v.min > -0.001
  console.log(
    `UV rect u[${f(u.min)},${f(u.max)}] v[${f(v.min)},${f(v.max)}] — ` +
      (clean
        ? 'clean 0-1 unwrap'
        : 'NOT 0-1; normalised at runtime by screenUvBounds, nothing to do'),
  )
}

// Which way does the screen face? It sits proud of the model's bulk, so the
// sign of its offset from the centre is the outward direction.
const facing = mid(screen.bbox[depthAxis]) > mid(modelBox[depthAxis]) ? +1 : -1
console.log(
  `faces ${facing > 0 ? '+' : '-'}${AXIS[depthAxis]} — ` +
    (facing > 0 && depthAxis === 2
      ? 'already matches the +Z convention'
      : 'needs a corrective rotation'),
)

// --- bezel ------------------------------------------------------------------

// A bezel shares the screen's outer bbox and reaches in FRONT of it: it
// covers the screen's edges, so the visible opening is its inner hole rather
// than the screen's own bbox. A frame that merely surrounds the screen (a
// larger bbox) hides nothing and must not be treated as one.
//
// Compare LEADING EDGES, not bbox centres. A bezel is a shell with real
// depth, so its centre can sit behind the flat screen while its front face
// still covers it — which is exactly the iPhone 17 Pro's Screen_Rim (centre
// 0.0216, front 0.0471, screen at 0.0458). Testing centres reported that
// model as bezel-free and silently threw away the inset the whole of trap 1
// exists to apply.
const leadingEdge = (p) => (facing > 0 ? p.bbox[depthAxis].max : p.bbox[depthAxis].min)
const screenDepth = mid(screen.bbox[depthAxis])
const centreW = mid(screen.bbox[widthAxis])
const centreH = mid(screen.bbox[heightAxis])

/**
 * Side-bezel thickness implied by a candidate, or null if it is not a ring.
 *
 * The naive inner edge — "smallest distance to the centreline" — reads the
 * Dynamic Island and speaker cutouts that sit INSIDE the ring and reports a
 * far smaller opening than the real one. Side bezels are unobstructed, so
 * measure there and let the rest follow.
 */
function sideThicknessOf(candidate) {
  const nearMidHeight = candidate.positions.filter(
    (p) => Math.abs(p[heightAxis] - centreH) < screenH * 0.25,
  )
  if (!nearMidHeight.length) return null
  const innerHalfWidth = Math.min(...nearMidHeight.map((p) => Math.abs(p[widthAxis] - centreW)))
  return screenW / 2 - innerHalfWidth
}

// Share the screen's outer bbox, reach in front of it, AND imply a plausible
// thickness. That last test is what separates a bezel from a coincident flat
// panel: the 17 Pro also carries a `Plane.011` matching the screen's bbox to
// 0.1%, and taking it as the bezel yields a NEGATIVE thickness — an opening
// larger than the screen. Requiring a positive, phone-sized ring rejects it.
const bezel = primitives
  .filter(
    (p) =>
      p !== screen &&
      Math.abs(span(p.bbox[widthAxis]) - screenW) < screenW * 0.02 &&
      Math.abs(span(p.bbox[heightAxis]) - screenH) < screenH * 0.02 &&
      (leadingEdge(p) - screenDepth) * facing > 0,
  )
  .map((p) => ({ p, thickness: sideThicknessOf(p) }))
  .filter(({ thickness }) => thickness !== null && thickness > screenW * 0.002 && thickness < screenW * 0.1)
  .sort((a, b) => b.thickness - a.thickness)[0]

let visibleFraction = [1, 1]
let openW = screenW
let openH = screenH

if (!bezel) {
  console.log('\nNo bezel covers the screen — the whole mesh is visible.')
} else {
  openW = screenW - bezel.thickness * 2
  openH = screenH - bezel.thickness * 2
  visibleFraction = [openW / screenW, openH / screenH]

  console.log(`\n--- bezel: material "${bezel.p.material}" ---`)
  console.log(`visible opening ${f(openW)} x ${f(openH)}  (aspect ${(openW / openH).toFixed(6)})`)
  console.log(`bezel thickness ${f(bezel.thickness)} (measured on the sides, assumed uniform)`)
  console.log(
    `hidden under bezel: ${((1 - visibleFraction[0]) * 100).toFixed(1)}% width, ` +
      `${((1 - visibleFraction[1]) * 100).toFixed(1)}% height`,
  )
}

// --- manifest block ---------------------------------------------------------

// Convention is 1 unit = 10cm (§7.2). Without a real-world height we cannot
// know the intended scale, so ask rather than guess a wrong one.
const heightMm = Number(process.env.DEVICE_HEIGHT_MM)
const scale = heightMm ? heightMm / 100 / modelSpans[heightAxis] : null

console.log('\n--- paste into the manifest ---')
console.log(`  screenMaterialName: '${screen.material}',`)
console.log(`  screenAspect: ${(openW / openH).toFixed(6)},`)
console.log(
  `  screenVisibleFraction: [${visibleFraction[0].toFixed(6)}, ${visibleFraction[1].toFixed(6)}],`,
)
console.log('  modelTransform: {')
console.log(`    position: [${modelBox.map((e) => (-mid(e)).toFixed(6)).join(', ')}],`)
console.log(
  `    rotation: [0, ${facing > 0 && depthAxis === 2 ? '0' : 'Math.PI'}, 0],` +
    (depthAxis === 2 ? '' : `  // NOTE: model is thin in ${AXIS[depthAxis]}, not z — check by eye`),
)
console.log(
  scale !== null
    ? `    scale: ${scale.toFixed(6)},`
    : '    scale: <set DEVICE_HEIGHT_MM=<real height in mm> and re-run>,',
)
console.log('  },')
console.log('\n  // colorway keys — material names in this file:')
console.log('  //   ' + [...new Set(primitives.map((p) => p.material))].join(', '))
