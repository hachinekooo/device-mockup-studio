import { describe, expect, it } from 'vitest'
import {
  avcCodecString,
  bitrateFor,
  evenSize,
  VIDEO_FORMAT_EXTENSIONS,
  VIDEO_FORMAT_LABELS,
} from './video'

describe('bitrateFor', () => {
  it('follows §9.4 in the middle of the range', () => {
    // 1920x1080x60 x 0.12 -> 14.9 Mbps, inside the clamp.
    expect(bitrateFor(1920, 1080, 60)).toBe(14_929_920)
  })

  it('clamps small outputs up to 8 Mbps', () => {
    // A tiny export starved of bits is worse than a slightly large file, and
    // the screen region is the part that shows it first.
    expect(bitrateFor(320, 240, 30)).toBe(8_000_000)
  })

  it('clamps very large outputs down to the 80 Mbps ceiling', () => {
    // 4K60 at the top tier would ask for 2.4 Gbps unclamped, which no
    // encoder will honour and no player will stream.
    expect(bitrateFor(3840, 2160, 60, 'max')).toBe(80_000_000)
  })

  it('spends more per tier, which is the whole point of the control', () => {
    // The regression this guards: the tier used to scale only the render, so
    // a Max export was squeezed through the same 8 Mbps as Standard and the
    // extra render detail was thrown away at the last step.
    const standard = bitrateFor(1920, 1080, 30, 'standard')
    const high = bitrateFor(1920, 1080, 30, 'high')
    const max = bitrateFor(1920, 1080, 30, 'max')

    expect(standard).toBeLessThan(high)
    expect(high).toBeLessThan(max)
  })

  it('lifts 1080p30 off the floor at the higher tiers', () => {
    // 1080p30 lands under the floor unscaled — the formula gives 7.46 Mbps —
    // so before the tier scaled it, every ordinary export got the minimum.
    expect(bitrateFor(1920, 1080, 30, 'standard')).toBe(8_000_000)
    expect(bitrateFor(1920, 1080, 30, 'high')).toBe(14_929_920)
    expect(bitrateFor(1920, 1080, 30, 'max')).toBe(29_859_840)
  })
})

describe('avcCodecString', () => {
  it('uses level 4.0 for 1080p30, the case it was hardcoded for', () => {
    expect(avcCodecString(1920, 1080, 30)).toBe('avc1.640028')
  })

  it('climbs a level when the frame is bigger than 4.0 allows', () => {
    /*
     * The regression: this was pinned at level 4.0 (8192 macroblocks), and a
     * 1350x1600 portrait export is 85x100 = 8500. isConfigSupported said no,
     * MP4 silently vanished from the picker, and the only clip export left
     * was the PNG sequence — reported as "I exported and all I got was a
     * zip". Every phone-shaped canvas lands in this range.
     */
    expect(avcCodecString(1350, 1600, 30)).toBe('avc1.64002a') // 4.2
  })

  it('climbs for frame rate as well as frame size', () => {
    // 1080p60 exceeds level 4.0's macroblocks-per-second, not its frame size.
    expect(avcCodecString(1920, 1080, 30)).toBe('avc1.640028')
    expect(avcCodecString(1920, 1080, 60)).toBe('avc1.64002a')
  })

  it('reaches the high levels for oversized exports', () => {
    // The sharpness readout's resize suggestion routinely lands here.
    expect(avcCodecString(3000, 3600, 30)).toBe('avc1.64003c') // 6.0
  })

  it('never returns an empty level, however absurd the size', () => {
    // Past every level's limits it must still name one: the encoder rejecting
    // a valid string is a clean "unsupported", a malformed string is not.
    expect(avcCodecString(16000, 16000, 60)).toMatch(/^avc1\.6400[0-9a-f]{2}$/)
  })
})

describe('evenSize', () => {
  it('rounds odd dimensions down, never up', () => {
    // H.264 4:2:0 cannot encode an odd dimension. Rounding up would export
    // larger than the size the user asked for.
    expect(evenSize(1921, 1081)).toEqual({ width: 1920, height: 1080 })
  })

  it('leaves even dimensions alone', () => {
    expect(evenSize(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })
})

describe('format tables', () => {
  it('names and extensions cover every format', () => {
    // These are looked up by key at render time, so a format added without
    // its label shows as `undefined` in the picker rather than failing.
    expect(Object.keys(VIDEO_FORMAT_LABELS).sort()).toEqual(
      Object.keys(VIDEO_FORMAT_EXTENSIONS).sort(),
    )
  })

  it('keeps the transparent format on a WebM container', () => {
    // Alpha only survives in VP9-in-WebM; an MP4 extension here would hand
    // the user a file whose transparency was silently discarded.
    expect(VIDEO_FORMAT_EXTENSIONS['webm-alpha']).toBe('webm')
  })
})
