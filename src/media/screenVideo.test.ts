import { describe, expect, it } from 'vitest'
import { screenTimeAt } from './screenVideo'

/*
 * The one expression the whole video feature rests on (§8.3):
 *
 *     screenTime = clamp(t - clipOffset, 0, clipDuration)
 *
 * Preview and export must both derive video time from timeline time this
 * way. A screen that played independently would render differently every
 * time the same project was exported, which is the failure the pure-function
 * -of-time rule exists to prevent.
 */
describe('screenTimeAt', () => {
  it('maps timeline time straight onto clip time', () => {
    expect(screenTimeAt(0, 10)).toBe(0)
    expect(screenTimeAt(2.5, 10)).toBe(2.5)
  })

  it('holds the last frame past the end of a short clip', () => {
    // A 3s clip on a 5s timeline must not restart or go black at 3s.
    expect(screenTimeAt(4, 3)).toBe(3)
    expect(screenTimeAt(100, 3)).toBe(3)
  })

  it('holds the first frame before the clip starts', () => {
    expect(screenTimeAt(0.5, 10, 2)).toBe(0)
  })

  it('shifts by the clip offset', () => {
    expect(screenTimeAt(3, 10, 2)).toBe(1)
  })

  it('never returns a negative time', () => {
    // A negative currentTime throws on assignment in some browsers, so this
    // would surface as an unrelated-looking error mid-scrub.
    expect(screenTimeAt(-5, 10)).toBe(0)
  })
})
