import { describe, expect, it } from 'vitest'
import { coverageFrom } from './screenCoverage'

// The bezel inset alone: iPhone 17 Pro's screen mesh runs under a rim that
// covers ~3% of its height, so a natively-sized screenshot maps with a
// repeat slightly above 1.
const BEZEL_REPEAT_Y = 159.514 / 154.568

describe('coverageFrom', () => {
  it('reports the shortfall at the default 1080p export', () => {
    // A 2622px screenshot on a phone filling ~80% of a 1080-tall frame.
    const coverage = coverageFrom(2622, BEZEL_REPEAT_Y, 0.8 * 1080, 1080)

    expect(coverage.renderedHeight).toBeLessThan(900)
    expect(coverage.ratio).toBeLessThan(0.35)
  })

  it('names an output height that actually reaches 1:1', () => {
    const renderedSpan = 0.8 * 1080
    const coverage = coverageFrom(2622, BEZEL_REPEAT_Y, renderedSpan, 1080)

    // Re-measure at the suggested height: the mesh covers the same fraction
    // of the frame, so the rendered span scales with it.
    const scaled = (coverage.heightFor1to1 / 1080) * renderedSpan
    const after = coverageFrom(2622, BEZEL_REPEAT_Y, scaled, coverage.heightFor1to1)

    expect(after.ratio).toBeGreaterThanOrEqual(1)
    expect(after.renderedHeight).toBeGreaterThanOrEqual(2622)
  })

  it('counts letterbox bars on both sides so they cancel', () => {
    // 'contain' on a 16:9 screenshot pushes repeat well above 1. The bars are
    // part of the mapped span and part of the rendered span alike, so the
    // sampling ratio must not change when only the fit does.
    const native = coverageFrom(1000, 1, 500, 1080)
    const letterboxed = coverageFrom(1000, 2, 1000, 1080)

    expect(letterboxed.ratio).toBeCloseTo(native.ratio, 10)
  })

  it('does not claim 1:1 is reached when the screen is oversampled', () => {
    // Rendered larger than the source: nothing to recover, and the suggested
    // height must not grow the export pointlessly.
    const coverage = coverageFrom(1000, 1, 2000, 1080)
    expect(coverage.ratio).toBe(2)
    expect(coverage.heightFor1to1).toBe(540)
  })

  it('degrades to a no-op rather than dividing by zero', () => {
    const coverage = coverageFrom(2622, 0, 800, 1080)
    expect(coverage.ratio).toBe(1)
    expect(coverage.heightFor1to1).toBe(1080)
    expect(Number.isFinite(coverage.renderedHeight)).toBe(true)
  })
})
