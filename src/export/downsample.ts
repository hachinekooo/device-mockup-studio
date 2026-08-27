/**
 * Exact box downsample of an RGBA buffer by an integer factor.
 *
 * This replaces a chain of `drawImage` halvings. The chain was measured as
 * near-exact against a true box average — but only at 4x, where every step is
 * an exact halving. The default quality tier renders at *3x*, and there the
 * chain runs 3 -> 1.5 -> 1: two bilinear resamples at non-integer ratios,
 * each applying its own reconstruction filter on top of the last.
 *
 * Measured in Chromium on a high-frequency test pattern, RMS error against
 * the exact box average by supersample factor:
 *
 *     2x -> 0.36    3x -> 27.67    4x -> 0.37
 *
 * with 11.8% of edge detail lost at 3x versus under 1% at either power of
 * two. The tier that exists to keep screenshots sharp was the one the
 * resampler handled worst, and the original measurement missed it because it
 * only ever tested 4x.
 *
 * A box average is the correct answer for supersampled AA at any integer
 * factor, so doing it directly removes both the special case and the
 * dependence on whatever kernel the browser happens to use.
 *
 * Averaging happens in *premultiplied* space. Canvas `drawImage` does this
 * internally; a naive average of unpremultiplied RGBA pulls the colour of
 * fully transparent pixels into the result, which fringes the device
 * silhouette on a transparent export. Values stay sRGB-encoded rather than
 * being linearised, matching the reference the downsampler was measured
 * against — switching to linear-light averaging is a visible change to edge
 * brightness, not a free improvement.
 */
export function boxDownsample(
  src: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  factor: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`boxDownsample: factor must be a positive integer, got ${factor}`)
  }
  if (srcWidth % factor !== 0 || srcHeight % factor !== 0) {
    throw new Error(
      `boxDownsample: ${srcWidth}x${srcHeight} is not divisible by ${factor}`,
    )
  }

  const width = srcWidth / factor
  const height = srcHeight / factor
  const data = new Uint8ClampedArray(width * height * 4)
  if (factor === 1) {
    data.set(src)
    return { data, width, height }
  }

  const samples = factor * factor

  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let dy = 0; dy < factor; dy++) {
        const rowStart = ((oy * factor + dy) * srcWidth + ox * factor) * 4
        for (let dx = 0; dx < factor; dx++) {
          const i = rowStart + dx * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += alpha
        }
      }

      const o = (oy * width + ox) * 4
      // A fully transparent block has no colour to recover, and dividing by
      // a zero alpha sum would write NaN straight into the output buffer.
      if (a > 0) {
        data[o] = r / a
        data[o + 1] = g / a
        data[o + 2] = b / a
      }
      data[o + 3] = (a / samples) * 255
    }
  }

  return { data, width, height }
}
