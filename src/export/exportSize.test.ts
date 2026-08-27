import { describe, expect, it } from 'vitest'
import { encoderScaleLimit, macroblocksFor, resolveExportSize } from './exportSize'
import type { ScreenCoverage } from './screenCoverage'

const coverage = (ratio: number, outputHeight: number): ScreenCoverage => ({
  sourceHeight: 2622,
  renderedHeight: Math.round(2622 * ratio),
  ratio,
  heightFor1to1: Math.ceil(outputHeight / ratio),
})

describe('resolveExportSize', () => {
  it('grows the export until the source survives intact', () => {
    // The whole point: a 2622px screenshot on 860 output pixels needs the
    // export to be 1/0.328 times taller before nothing is discarded.
    const size = resolveExportSize({
      width: 1920,
      height: 1080,
      coverage: coverage(0.328, 1080),
      matchSource: true,
      gpuScaleLimit: 8,
      encoderLimited: false,
    })

    expect(size.height).toBeGreaterThanOrEqual(3292)
    expect(size.ratio).toBeCloseTo(1, 2)
    expect(size.limitedBy).toBe('none')
  })

  it('keeps the composition by scaling both axes together', () => {
    const size = resolveExportSize({
      width: 1920,
      height: 1080,
      coverage: coverage(0.5, 1080),
      matchSource: true,
      gpuScaleLimit: 8,
      encoderLimited: false,
    })

    // Aspect preserved to within the even-pixel rounding.
    expect(size.width / size.height).toBeCloseTo(1920 / 1080, 3)
  })

  it('never shrinks an export that is already generous', () => {
    // Shrinking would be a surprise, and the extra pixels still buy edge
    // quality on the device silhouette even once the screen is over-served.
    const size = resolveExportSize({
      width: 1920,
      height: 1080,
      coverage: coverage(2, 1080),
      matchSource: true,
      gpuScaleLimit: 8,
      encoderLimited: false,
    })

    expect(size).toMatchObject({ width: 1920, height: 1080 })
  })

  it('leaves the size alone when the user has taken over', () => {
    const size = resolveExportSize({
      width: 1200,
      height: 1600,
      coverage: coverage(0.3, 1600),
      matchSource: false,
      gpuScaleLimit: 8,
      encoderLimited: false,
    })

    expect(size).toMatchObject({ width: 1200, height: 1600, limitedBy: 'none' })
  })

  it('stops at the H.264 ceiling and says so', () => {
    // A landscape canvas pays for wide empty background either side of a tall
    // phone, so 1:1 crosses the encoder's frame-size limit where the same
    // shot in portrait would not.
    const size = resolveExportSize({
      width: 1920,
      height: 1080,
      coverage: coverage(0.328, 1080),
      matchSource: true,
      gpuScaleLimit: 8,
      encoderLimited: true,
    })

    expect(size.limitedBy).toBe('encoder')
    expect(macroblocksFor(size.width, size.height)).toBeLessThanOrEqual(36_864)
    expect(size.ratio).toBeLessThan(1)
  })

  it('reaches 1:1 in portrait where landscape could not', () => {
    // Same screenshot, same requirement, narrower canvas: far fewer total
    // pixels, so H.264 has no problem with it.
    const size = resolveExportSize({
      width: 1080,
      height: 1920,
      coverage: coverage(0.586, 1920), // 1920 * 0.586 -> ~1125px of 2622
      matchSource: true,
      gpuScaleLimit: 8,
      encoderLimited: true,
    })

    expect(size.limitedBy).toBe('none')
    expect(size.ratio).toBeCloseTo(1, 2)
  })

  it('reports the GPU as the limit when it binds before the encoder', () => {
    const size = resolveExportSize({
      width: 1920,
      height: 1080,
      coverage: coverage(0.1, 1080),
      matchSource: true,
      gpuScaleLimit: 1.5,
      encoderLimited: false,
    })

    expect(size.limitedBy).toBe('gpu')
  })
})

describe('encoderScaleLimit', () => {
  it('allows 4K, which is inside the ceiling', () => {
    // The measured wall sits just above 4K — that is why 4K MP4 encodes fine
    // and only larger frames do not.
    expect(encoderScaleLimit(3840, 2160)).toBeGreaterThan(1)
  })

  it('refuses to grow a frame already past the ceiling', () => {
    expect(encoderScaleLimit(3000, 3600)).toBeLessThan(1)
  })
})
