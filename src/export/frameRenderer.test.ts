import { describe, expect, it } from 'vitest'
import { resolveSupersample } from './frameRenderer'
import type * as THREE from 'three'

const fakeRenderer = (maxTextureSize: number) =>
  ({ capabilities: { maxTextureSize } }) as unknown as THREE.WebGLRenderer

describe('resolveSupersample', () => {
  it('uses the requested factor when the GPU can allocate it', () => {
    const gl = fakeRenderer(16384)
    expect(resolveSupersample(gl, 1350, 1600, 'standard')).toBe(2)
    expect(resolveSupersample(gl, 1350, 1600, 'high')).toBe(3)
    expect(resolveSupersample(gl, 1350, 1600, 'max')).toBe(4)
  })

  it('clamps to the max texture size instead of failing the render', () => {
    // A 4x supersample of a 4000px export is 16000px — past many GPUs.
    expect(resolveSupersample(fakeRenderer(8192), 4000, 3000, 'max')).toBe(2)
    expect(resolveSupersample(fakeRenderer(4096), 4000, 3000, 'max')).toBe(1)
  })

  it('caps total pixels, not just the longest edge', () => {
    // A 4000x3000 export at 4x is 192M pixels. The edge limit alone would
    // wave that through on a large-maxTexture GPU; multisampling plus the
    // preserveDrawingBuffer copy makes it fail in ways that look like
    // corrupted output rather than a clean error.
    expect(resolveSupersample(fakeRenderer(32768), 4000, 3000, 'max')).toBeLessThan(4)
  })

  it('leaves every quality tier meaningful at ordinary export sizes', () => {
    // A budget tight enough to collapse the tiers into each other is a
    // control that lies to the user.
    const gl = fakeRenderer(16384)
    const tiers = (['standard', 'high', 'max'] as const).map((q) =>
      resolveSupersample(gl, 1350, 1600, q),
    )
    expect(new Set(tiers).size).toBe(3)
  })

  it('never returns less than 1', () => {
    // An export larger than the GPU can hold should still produce an image
    // rather than a zero-sized buffer.
    expect(resolveSupersample(fakeRenderer(2048), 8000, 8000, 'max')).toBe(1)
  })

  it('clamps on the longer edge, not the shorter one', () => {
    // 9:16 output: the height is what runs into the limit first.
    expect(resolveSupersample(fakeRenderer(8192), 1080, 1920, 'max')).toBe(4)
    expect(resolveSupersample(fakeRenderer(8192), 1080, 2400, 'max')).toBe(3)
  })

  it('renders the screenshot at or above 1:1 on a default export', () => {
    // The regression this guards: at 2x, a 1206x2622 screenshot lands on
    // ~800x1900 render pixels and is sampled from a half-resolution mip,
    // which is why exports came out softer than the source.
    const gl = fakeRenderer(16384)
    const DEG = Math.PI / 180
    const fov = 30
    const cameraZ = 4.45
    const outputHeight = 1600
    const screenHeightUnits = 1.42 // visible opening of the iPhone 17 Pro mesh
    const sourceHeight = 2622

    const ss = resolveSupersample(gl, 1350, outputHeight, 'high')
    const halfHeight = Math.tan((fov / 2) * DEG) * cameraZ
    const pxPerUnit = (outputHeight * ss) / (2 * halfHeight)
    const screenPx = screenHeightUnits * pxPerUnit

    expect(screenPx).toBeGreaterThanOrEqual(sourceHeight)
  })
})
