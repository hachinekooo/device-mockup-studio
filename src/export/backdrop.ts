import type { BackgroundConfig } from '../store/schema'

/**
 * Paints the project background into an export frame.
 *
 * The background is deliberately NOT scene geometry (§6.3) — it is a CSS
 * layer behind the canvas, which is what keeps alpha export possible. The
 * cost of that choice is that nothing composites the two at export time, so
 * every non-transparent export used to come out black: `exportStillPng` read
 * only the WebGL canvas, cleared over three's default black, and the
 * gradient the user picked never left the DOM.
 *
 * The fix belongs here rather than in the scene: fill the output canvas with
 * the backdrop, then draw the render over it. That keeps the render itself
 * transparent, so the same code path serves an alpha export (skip the fill)
 * and an opaque one.
 *
 * `loadBackdrop` resolves the async part — decoding a background image —
 * exactly once and hands back a synchronous painter. The frame loop of a
 * video export calls that painter hundreds of times; it must not await.
 */
export type BackdropPainter = (
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
) => void

/**
 * Endpoints of a CSS `linear-gradient(<angle>deg, ...)` on a width×height box.
 *
 * CSS angles are not canvas angles and the difference is silent: 0deg points
 * *up* (the gradient runs bottom-to-top) and angles increase clockwise, while
 * the canvas y axis points down. The gradient line is also longer than the
 * box for any angle off the axes — it is sized so the two corner tangents
 * touch its ends, which is what makes a 45° gradient reach full colour in
 * the corners rather than partway along the diagonal.
 */
export function gradientEndpoints(
  angleDeg: number,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const rad = (angleDeg * Math.PI) / 180
  const sin = Math.sin(rad)
  const cos = Math.cos(rad)

  // Canvas-space direction of increasing colour stop: up is -y.
  const dx = sin
  const dy = -cos
  const length = Math.abs(width * sin) + Math.abs(height * cos)

  const cx = width / 2
  const cy = height / 2
  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2,
  }
}

/**
 * Destination rect for a background image under `cover` or `contain`,
 * centred — the same geometry `background-size` gives in the preview.
 * Getting this wrong shows up as an export that is framed differently from
 * what the user was looking at, which reads as a rendering bug.
 */
export function backgroundImageRect(
  imageWidth: number,
  imageHeight: number,
  width: number,
  height: number,
  fit: 'cover' | 'contain',
): { x: number; y: number; width: number; height: number } {
  const scaleX = width / imageWidth
  const scaleY = height / imageHeight
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  const w = imageWidth * scale
  const h = imageHeight * scale
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }
}

/**
 * Resolve a background config into a synchronous painter, or null when the
 * export should stay transparent.
 *
 * Null is also the answer when a background image fails to decode. An export
 * that silently loses its backdrop is better than one that throws at the last
 * step, and the checkerboard the UI shows for transparency makes it obvious.
 */
export async function loadBackdrop(bg: BackgroundConfig): Promise<BackdropPainter | null> {
  switch (bg.type) {
    case 'transparent':
      return null

    case 'solid':
      return (ctx, width, height) => {
        ctx.fillStyle = bg.color
        ctx.fillRect(0, 0, width, height)
      }

    case 'gradient':
      return (ctx, width, height) => {
        const { x0, y0, x1, y1 } = gradientEndpoints(bg.angle, width, height)
        const grad = ctx.createLinearGradient(x0, y0, x1, y1)
        grad.addColorStop(0, bg.from)
        grad.addColorStop(1, bg.to)
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, width, height)
      }

    case 'image': {
      const bitmap = await fetch(bg.ref.url)
        .then((r) => r.blob())
        .then(createImageBitmap)
        .catch(() => null)
      if (!bitmap) return null

      return (ctx, width, height) => {
        // `contain` leaves bars; the preview paints black behind the image
        // for exactly this case, so match it rather than leaking transparency.
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, width, height)
        const rect = backgroundImageRect(bitmap.width, bitmap.height, width, height, bg.fit)
        ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height)
      }
    }
  }
}
