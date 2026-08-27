import type { ScreenCoverage } from './screenCoverage'

/**
 * Resolving the export size from the source, rather than from a preset.
 *
 * The insight this rests on: everything in the scene except the screenshot is
 * **synthetic**. Geometry, shadows, the gradient, the HDRI — all of it renders
 * at any resolution with no loss. The screenshot is the single fixed-resolution
 * asset, so it is the one thing that should decide how many pixels the export
 * has. Picking 1920x1080 from a menu and then being told the screenshot didn't
 * fit is backwards.
 *
 * Both axes scale together, so the composition is untouched — same framing,
 * more pixels. Only the pixel count changes.
 */

/**
 * H.264 frame-size ceiling, in macroblocks: level 5.2's MaxFS.
 *
 * Measured against Chrome's encoder rather than read off the spec, because
 * what matters is what it will actually accept. Everything up to 36,636
 * macroblocks encoded; 3000x3600 (42,300) was refused at **every** level,
 * including 6.0 — the encoder simply does not implement level 6, so asking
 * for a higher one changes nothing.
 *
 * In practice this sits just *above* 4K (8.3MP), which is why 4K MP4 is fine
 * and only larger frames are not. A tall phone at 1:1 stays inside it on any
 * portrait canvas; a landscape canvas pays for wide empty background either
 * side of the device and crosses it.
 */
export const AVC_MAX_MACROBLOCKS = 36_864

export type ExportSize = {
  width: number
  height: number
  /** Coverage actually achieved: 1 means the source survives intact. */
  ratio: number
  /** What stopped it reaching 1:1, when something did. */
  limitedBy: 'none' | 'gpu' | 'encoder'
}

export function macroblocksFor(width: number, height: number): number {
  return Math.ceil(width / 16) * Math.ceil(height / 16)
}

/** Largest uniform scale of `width`x`height` that H.264 will still encode. */
export function encoderScaleLimit(width: number, height: number): number {
  // Macroblocks grow with area, so the scale limit goes as the square root.
  return Math.sqrt(AVC_MAX_MACROBLOCKS / macroblocksFor(width, height))
}

export type ResolveExportSizeParams = {
  width: number
  height: number
  coverage: ScreenCoverage | null
  matchSource: boolean
  /** Ceiling from `maxOutputScale` — GPU texture size and the pixel budget. */
  gpuScaleLimit: number
  /** Only H.264 has the macroblock ceiling; WebM and PNG do not. */
  encoderLimited: boolean
}

/**
 * The size an export should actually use.
 *
 * Never *shrinks* below the chosen size, even when the screenshot is
 * comfortably over-served. Growing an export to preserve detail is what the
 * user asked for; quietly shrinking one they picked is a surprise, and the
 * extra pixels still buy edge quality on the device silhouette.
 */
export function resolveExportSize({
  width,
  height,
  coverage,
  matchSource,
  gpuScaleLimit,
  encoderLimited,
}: ResolveExportSizeParams): ExportSize {
  if (!matchSource || !coverage) {
    return { width, height, ratio: coverage?.ratio ?? 1, limitedBy: 'none' }
  }

  const wanted = Math.max(1, coverage.heightFor1to1 / height)
  const encoderLimit = encoderLimited ? encoderScaleLimit(width, height) : Infinity
  const allowed = Math.min(gpuScaleLimit, encoderLimit)
  const scale = Math.min(wanted, allowed)

  // Name the binding constraint, and only when it actually binds — reporting
  // a limit on an export that reached 1:1 anyway is noise.
  const limitedBy: ExportSize['limitedBy'] =
    scale >= wanted - 1e-6 ? 'none' : encoderLimit < gpuScaleLimit ? 'encoder' : 'gpu'

  return {
    // Even dimensions: H.264 4:2:0 cannot encode an odd one, and rounding
    // here rather than at the encoder keeps the number the UI shows honest.
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
    ratio: coverage.ratio * scale,
    limitedBy,
  }
}
