import * as THREE from 'three'

/**
 * A rounded-rect shape centred at the origin. ShapeGeometry derives UVs from
 * the shape's own bounding box, which gives the "0–1, unrotated, origin
 * bottom-left" UV layout the spec requires (§7.2) for free.
 */
export function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const w = width / 2
  const h = height / 2
  const r = Math.min(radius, w, h)
  const shape = new THREE.Shape()
  shape.moveTo(-w + r, -h)
  shape.lineTo(w - r, -h)
  shape.quadraticCurveTo(w, -h, w, -h + r)
  shape.lineTo(w, h - r)
  shape.quadraticCurveTo(w, h, w - r, h)
  shape.lineTo(-w + r, h)
  shape.quadraticCurveTo(-w, h, -w, h - r)
  shape.lineTo(-w, -h + r)
  shape.quadraticCurveTo(-w, -h, -w + r, -h)
  shape.closePath()
  return shape
}

export function roundedRectPlaneGeometry(width: number, height: number, radius: number) {
  return new THREE.ShapeGeometry(roundedRectShape(width, height, radius), 24)
}

export function roundedRectBodyGeometry(
  width: number,
  height: number,
  radius: number,
  depth: number,
) {
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(width, height, radius), {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.12,
    bevelSize: depth * 0.1,
    bevelSegments: 6,
    curveSegments: 24,
  })
  geo.translate(0, 0, -depth / 2)
  return geo
}
