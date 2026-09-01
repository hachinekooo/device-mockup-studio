import { describe, expect, it } from 'vitest'
import { snapTimeToFrame, timelineTimeAtPointer } from './timelineMath'

describe('timeline pointer geometry', () => {
  it('maps the visible lane rather than the row including its label', () => {
    const laneLeft = 174
    const laneWidth = 826

    expect(timelineTimeAtPointer(laneLeft, laneLeft, laneWidth, 4, 30)).toBe(0)
    expect(timelineTimeAtPointer(laneLeft + laneWidth / 2, laneLeft, laneWidth, 4, 30)).toBe(2)
    expect(timelineTimeAtPointer(laneLeft + laneWidth, laneLeft, laneWidth, 4, 30)).toBe(4)
  })

  it('clamps outside clicks and snaps edits to exportable frames', () => {
    expect(timelineTimeAtPointer(50, 100, 600, 4, 30)).toBe(0)
    expect(timelineTimeAtPointer(800, 100, 600, 4, 30)).toBe(4)
    expect(snapTimeToFrame(1.019, 30, 4)).toBeCloseTo(1.033333, 6)
  })
})
