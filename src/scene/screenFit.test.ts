import { describe, expect, it } from 'vitest'
import { composeInset, containFitRepeatOffset, coverCropRepeatOffset } from './screenFit'

// The iPhone 17 Pro's real numbers: the screen mesh runs under a bezel that
// leaves ~93.5% of its width and ~96.9% of its height visible.
const VIS: [number, number] = [71.465 / 76.413, 154.568 / 159.514]
const SCREEN_ASPECT = 71.465 / 154.568
const IDENTITY = { repeat: [1, 1] as [number, number], offset: [0, 0] as [number, number] }

/** Where mesh UV `u` samples the image, under a composed transform. */
const sample = (t: { repeat: [number, number]; offset: [number, number] }, u: number, axis: 0 | 1) =>
  u * t.repeat[axis] + t.offset[axis]

/** UV bounds of the visible opening on each axis. */
const openingLo = (vis: number) => (1 - vis) / 2
const openingHi = (vis: number) => 1 - (1 - vis) / 2

describe('composeInset', () => {
  it('lands an unscaled image exactly on the bezel opening', () => {
    const t = composeInset(IDENTITY, VIS)
    for (const axis of [0, 1] as const) {
      expect(sample(t, openingLo(VIS[axis]), axis)).toBeCloseTo(0, 6)
      expect(sample(t, openingHi(VIS[axis]), axis)).toBeCloseTo(1, 6)
    }
  })

  it('keeps a cropped image centred in the opening', () => {
    // The regression this guards: omitting the fit's own scale from the inset
    // term. It cancels out at repeat 1, so only a cropped image exposes it.
    const cover = coverCropRepeatOffset(SCREEN_ASPECT, 1, 16 / 9)
    const t = composeInset(cover, VIS)
    for (const axis of [0, 1] as const) {
      const mid = (openingLo(VIS[axis]) + openingHi(VIS[axis])) / 2
      expect(sample(t, mid, axis)).toBeCloseTo(0.5, 6)
    }
  })

  it('keeps a letterboxed image centred in the opening', () => {
    const contain = containFitRepeatOffset(SCREEN_ASPECT, 1, 16 / 9)
    const t = composeInset(contain, VIS)
    for (const axis of [0, 1] as const) {
      const mid = (openingLo(VIS[axis]) + openingHi(VIS[axis])) / 2
      expect(sample(t, mid, axis)).toBeCloseTo(0.5, 6)
    }
  })

  it('is identity when nothing is hidden behind a bezel', () => {
    const t = composeInset(IDENTITY, [1, 1])
    expect(t.repeat).toEqual([1, 1])
    expect(t.offset[0]).toBeCloseTo(0, 9)
    expect(t.offset[1]).toBeCloseTo(0, 9)
  })
})

describe('contain vs cover', () => {
  it('contain shows the whole image, cover fills the whole screen', () => {
    const wide = 16 / 9
    const contain = containFitRepeatOffset(SCREEN_ASPECT, 1, wide)
    const cover = coverCropRepeatOffset(SCREEN_ASPECT, 1, wide)
    // Shrinking to fit means sampling beyond the image (repeat > 1); filling
    // means sampling a subset of it (repeat < 1).
    expect(Math.max(...contain.repeat)).toBeGreaterThan(1)
    expect(Math.min(...cover.repeat)).toBeLessThan(1)
  })

  it('contain reaches outside 0..1 so the letterbox has somewhere to draw', () => {
    const contain = containFitRepeatOffset(SCREEN_ASPECT, 1, 16 / 9)
    const t = composeInset(contain, VIS)
    const anyOutside = [0, 1].some((axis) => sample(t, 0.5 as number, axis as 0 | 1) !== undefined)
    expect(anyOutside).toBe(true)
    // On the constrained axis the image occupies less than the full opening.
    expect(sample(t, openingLo(VIS[1]), 1)).toBeLessThan(0)
  })

  it('both fits agree when the image already matches the screen', () => {
    const contain = containFitRepeatOffset(SCREEN_ASPECT, 1, SCREEN_ASPECT)
    const cover = coverCropRepeatOffset(SCREEN_ASPECT, 1, SCREEN_ASPECT)
    expect(contain.repeat[0]).toBeCloseTo(cover.repeat[0], 9)
    expect(contain.repeat[1]).toBeCloseTo(cover.repeat[1], 9)
  })
})
