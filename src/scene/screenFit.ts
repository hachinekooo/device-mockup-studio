/**
 * Spec §14 trap 12: stretching a mismatched-aspect image onto the screen by
 * default is the amateur-tool tell. We never stretch — instead we size the
 * image plane itself relative to the screen's rect:
 *  - "contain": image plane shrinks to fit fully inside the screen (letterbox)
 *  - "cover": image plane grows to fill the screen, image gets center-cropped
 *    via texture repeat/offset
 */
export function fitPlaneSize(
  screenWidth: number,
  screenHeight: number,
  imageAspect: number,
  fit: 'cover' | 'contain',
): { width: number; height: number } {
  const screenAspect = screenWidth / screenHeight
  const imageWider = imageAspect > screenAspect
  const shrinkToWidth = fit === 'contain' ? imageWider : !imageWider

  if (shrinkToWidth) {
    return { width: screenWidth, height: screenWidth / imageAspect }
  }
  return { width: screenHeight * imageAspect, height: screenHeight }
}

export function coverCropRepeatOffset(
  screenWidth: number,
  screenHeight: number,
  imageAspect: number,
): { repeat: [number, number]; offset: [number, number] } {
  const screenAspect = screenWidth / screenHeight
  if (imageAspect > screenAspect) {
    const repeatX = screenAspect / imageAspect
    return { repeat: [repeatX, 1], offset: [(1 - repeatX) / 2, 0] }
  }
  const repeatY = imageAspect / screenAspect
  return { repeat: [1, repeatY], offset: [0, (1 - repeatY) / 2] }
}

/**
 * Fit-inside (letterbox) counterpart to coverCropRepeatOffset, for a screen
 * whose geometry is a fixed shape. `repeat` comes out >= 1, which shrinks the
 * image so all of it lands inside the opening; whatever the shader samples
 * outside 0..1 is the letterbox and gets painted black.
 */
export function containFitRepeatOffset(
  screenWidth: number,
  screenHeight: number,
  imageAspect: number,
): { repeat: [number, number]; offset: [number, number] } {
  const screenAspect = screenWidth / screenHeight
  if (imageAspect > screenAspect) {
    const repeatY = imageAspect / screenAspect
    return { repeat: [1, repeatY], offset: [0, (1 - repeatY) / 2] }
  }
  const repeatX = screenAspect / imageAspect
  return { repeat: [repeatX, 1], offset: [(1 - repeatX) / 2, 0] }
}

/**
 * Compose a fit transform with the bezel inset (see DeviceManifest's
 * `screenVisibleFraction`).
 *
 * The inset term depends on the fit's own scale, which is easy to get wrong:
 * mapping mesh UV `u` onto opening-local `s = (u - (1-vis)/2) / vis` and then
 * through the fit gives `t = u * (r/vis) + (o - (1-vis)/2 * r/vis)`. Dropping
 * the `r` from that second term happens to be correct only while `r` is 1 —
 * i.e. for a natively-sized screenshot — and silently mis-centres every
 * cropped or letterboxed image.
 */
export function composeInset(
  fit: { repeat: [number, number]; offset: [number, number] },
  visibleFraction: [number, number],
): { repeat: [number, number]; offset: [number, number] } {
  const axis = (r: number, o: number, vis: number): [number, number] => {
    const scale = r / vis
    return [scale, o - ((1 - vis) / 2) * scale]
  }
  const [rx, ox] = axis(fit.repeat[0], fit.offset[0], visibleFraction[0])
  const [ry, oy] = axis(fit.repeat[1], fit.offset[1], visibleFraction[1])
  return { repeat: [rx, ry], offset: [ox, oy] }
}
