import { describe, expect, it } from 'vitest'
import { boxDownsample } from './downsample'

function buffer(pixels: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat())
}

describe('boxDownsample', () => {
  it('averages an opaque block exactly', () => {
    // 2x2 -> 1x1, values chosen so a mean that drops a sample is visible.
    const src = buffer([
      [0, 0, 0, 255],
      [100, 100, 100, 255],
      [200, 200, 200, 255],
      [255, 255, 255, 255],
    ])
    const { data, width, height } = boxDownsample(src, 2, 2, 2)
    expect([width, height]).toEqual([1, 1])
    expect(Array.from(data)).toEqual([139, 139, 139, 255]) // (0+100+200+255)/4
  })

  it('collapses 3x in one pass — the default quality tier', () => {
    // Every source pixel must contribute. A resampler that skips pixels (or
    // filters twice, via an intermediate 1.5x step) will not land on the
    // exact mean. 3x is the factor the old stepped chain handled worst.
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90]
    const src = buffer(values.map((v) => [v, v, v, 255]))
    const { data, width, height } = boxDownsample(src, 3, 3, 3)
    expect([width, height]).toEqual([1, 1])
    expect(data[0]).toBe(50) // mean of 10..90
  })

  it('does not pull transparent pixels into the colour average', () => {
    // The classic unpremultiplied-average bug: a transparent black pixel
    // beside an opaque white one must not darken the result. It stays white
    // at half alpha. This is the device silhouette on a transparent export.
    const src = buffer([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { data } = boxDownsample(src, 2, 2, 2)
    expect(Array.from(data)).toEqual([255, 255, 255, 128])
  })

  it('writes zero, not NaN, for a fully transparent block', () => {
    const src = buffer([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { data } = boxDownsample(src, 2, 2, 2)
    expect(Array.from(data)).toEqual([0, 0, 0, 0])
  })

  it('keeps rows independent so band-wise calls match a whole-image call', () => {
    // still.ts feeds this one strip at a time to keep peak memory bounded;
    // that is only valid while no output row reads outside its own block.
    const px: number[][] = []
    for (let i = 0; i < 4 * 4; i++) px.push([i * 8, i * 4, i * 2, 255])
    const src = buffer(px)

    const whole = boxDownsample(src, 4, 4, 2)
    const top = boxDownsample(src.slice(0, 4 * 2 * 4), 4, 2, 2)
    const bottom = boxDownsample(src.slice(4 * 2 * 4), 4, 2, 2)

    expect(Array.from(whole.data)).toEqual([...top.data, ...bottom.data])
  })

  it('rejects a size the factor does not divide', () => {
    const src = new Uint8ClampedArray(5 * 4 * 4)
    expect(() => boxDownsample(src, 5, 4, 2)).toThrow(/divisible/)
  })
})
