import { describe, expect, it } from 'vitest'
import { backgroundImageRect, gradientEndpoints } from './backdrop'

/*
 * The regression these guard: the export composites the background itself,
 * so its geometry has to reproduce what CSS painted in the preview. An
 * inverted gradient or a differently-cropped photo is not an error anyone
 * sees until they compare the export with the artboard.
 */
describe('gradientEndpoints', () => {
  it('runs 0deg bottom to top, not top to bottom', () => {
    // CSS 0deg means "to top" and the canvas y axis points down, so the
    // naive reading of the angle inverts every default gradient.
    const { x0, y0, x1, y1 } = gradientEndpoints(0, 100, 200)
    expect([x0, y0]).toEqual([50, 200])
    expect([x1, y1]).toEqual([50, 0])
  })

  it('runs 90deg left to right', () => {
    const g = gradientEndpoints(90, 100, 200)
    expect(g.x0).toBeCloseTo(0)
    expect(g.x1).toBeCloseTo(100)
    expect(g.y0).toBeCloseTo(100)
    expect(g.y1).toBeCloseTo(100)
  })

  it('runs 180deg top to bottom', () => {
    const g = gradientEndpoints(180, 100, 200)
    expect(g.y0).toBeCloseTo(0)
    expect(g.y1).toBeCloseTo(200)
  })

  it('reaches the corners on a diagonal', () => {
    // The gradient line is longer than the box off-axis. Sizing it to the
    // box instead leaves the corners short of the end colour.
    const g = gradientEndpoints(45, 100, 100)
    expect(g.x0).toBeCloseTo(0)
    expect(g.y0).toBeCloseTo(100)
    expect(g.x1).toBeCloseTo(100)
    expect(g.y1).toBeCloseTo(0)
  })
})

describe('backgroundImageRect', () => {
  it('covers by overflowing the short axis, centred', () => {
    // 200x100 image into a 100x100 box: scale to height, overflow width.
    const r = backgroundImageRect(200, 100, 100, 100, 'cover')
    expect(r.height).toBeCloseTo(100)
    expect(r.width).toBeCloseTo(200)
    expect(r.x).toBeCloseTo(-50)
    expect(r.y).toBeCloseTo(0)
  })

  it('contains by letterboxing, centred', () => {
    const r = backgroundImageRect(200, 100, 100, 100, 'contain')
    expect(r.width).toBeCloseTo(100)
    expect(r.height).toBeCloseTo(50)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(25)
  })

  it('agrees on both fits when the aspect already matches', () => {
    const cover = backgroundImageRect(50, 50, 100, 100, 'cover')
    const contain = backgroundImageRect(50, 50, 100, 100, 'contain')
    expect(cover).toEqual(contain)
    expect(cover).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })
})
