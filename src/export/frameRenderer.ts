import * as THREE from 'three'
import { boxDownsample } from './downsample'
import type { BackdropPainter } from './backdrop'

export type ExportQuality = 'standard' | 'high' | 'max'

/** Supersample factor per quality tier. See `resolveSupersample` for why. */
const QUALITY_SUPERSAMPLE: Record<ExportQuality, number> = {
  standard: 2,
  high: 3,
  max: 4,
}

/**
 * Pixel ceiling for the supersampled render buffer, ~8900 square.
 *
 * Sized to sit just above a 8192x8192 allocation, which is the practical
 * limit on a lot of hardware, while still leaving every quality tier usable
 * at normal export sizes. Tightening this much further makes 'max'
 * indistinguishable from 'high' and quietly removes the control.
 */
const MAX_RENDER_PIXELS = 80_000_000

/**
 * Pick the supersample factor, clamped to what the GPU will actually allocate.
 *
 * Supersampling is doing two jobs here, and the second is the one that
 * governs screenshot sharpness. Edge quality on the device silhouette (§6.5)
 * only needs 2x. But the screen texture is a ~1206x2622 screenshot mapped
 * onto a region that, at 2x on a 1350x1600 export, covers roughly 800x1900
 * render pixels — so it is *minified*, and a minified texture is sampled
 * from a half-resolution mip. That is why exports came out softer than the
 * screenshot that went in: detail was being discarded before the downsample
 * ever ran. Rendering at 3-4x puts the screen back at or above 1:1, so the
 * full-resolution mip is used and the only resampling left is the final,
 * high-quality downsample.
 */
export function resolveSupersample(
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  quality: ExportQuality,
): number {
  const wanted = QUALITY_SUPERSAMPLE[quality]
  const maxTexture = renderer.capabilities.maxTextureSize
  const edgeLimit = Math.floor(maxTexture / Math.max(width, height))

  // Also cap total pixels. The canvas is multisampled and, because
  // `preserveDrawingBuffer` is on, the browser keeps an extra copy — so the
  // real cost is several bytes per pixel, and the edge limit alone happily
  // allows allocations that make drivers fail in ways that look like
  // corruption rather than a clean error.
  const areaLimit = Math.floor(Math.sqrt(MAX_RENDER_PIXELS / (width * height)))

  // Never drop below 1 — a tiny GPU limit should still produce an image.
  return Math.max(1, Math.min(wanted, edgeLimit, areaLimit))
}

/**
 * Largest factor an output size can be scaled by and still render.
 *
 * Growing the export is the only real fix for a screenshot reproduced below
 * its own resolution (see `screenCoverage.ts`), so the UI has to offer it —
 * but an unbounded suggestion is worse than none: past `maxTextureSize` the
 * render fails, and past the pixel budget drivers fail in ways that look
 * like corruption rather than an error. Same two ceilings as
 * `resolveSupersample`, since at scale the buffer is the output size.
 */
export function maxOutputScale(width: number, height: number, maxTextureSize: number): number {
  const edgeLimit = maxTextureSize / Math.max(width, height)
  const areaLimit = Math.sqrt(MAX_RENDER_PIXELS / (width * height))
  // Never below 1: an already-oversized output must not be shrunk by this.
  return Math.max(1, Math.min(edgeLimit, areaLimit))
}

export type FrameExportParams = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  width: number
  height: number
  /**
   * Painter for the project background, or null for a transparent export.
   * The render itself is always transparent; this is composited underneath
   * it (see `backdrop.ts`) rather than put into the scene, which is what
   * keeps §6.3's alpha export working.
   */
  backdrop: BackdropPainter | null
  quality?: ExportQuality
  /**
   * Pauses R3F's render loop for the duration. Required, not optional: a
   * caller that forgets it gets a torn image only sometimes, which is far
   * worse to diagnose than a compile error.
   */
  setFrameloop: (mode: 'always' | 'never' | 'demand') => void
}

export type FrameExporter = {
  /** Resolved supersample factor — may be below the requested tier. */
  supersample: number
  /**
   * Render the scene *as currently posed* and return the finished frame at
   * output resolution. The canvas is reused between calls, so a caller that
   * needs to hold on to a frame must encode or copy it before the next one.
   */
  renderFrame(): OffscreenCanvas
  /** Restore the renderer and restart the preview loop. Always call it. */
  dispose(): void
}

/**
 * Put the renderer into export configuration and hand back a frame source.
 *
 * A still export renders once; a sequence or video export renders hundreds
 * of times. Both want the same setup, the same capture, the same downsample
 * and the same restore — the only difference is how many times the middle
 * part runs, so the setup and teardown live here and the loop lives in the
 * caller. The intermediate canvases are allocated once for the same reason:
 * at 4x on a 1080p export each is 32MB, and reallocating per frame is how an
 * export walks into the 2GB memory target.
 *
 * Requires `preserveDrawingBuffer: true` set at context creation (§9.1,
 * §14 trap 2) — it cannot be toggled after the fact.
 */
export function beginFrameExport({
  renderer,
  scene,
  camera,
  width,
  height,
  backdrop,
  quality = 'high',
  setFrameloop,
}: FrameExportParams): FrameExporter {
  const prevSize = new THREE.Vector2()
  renderer.getSize(prevSize)
  const prevPixelRatio = renderer.getPixelRatio()
  const prevAspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : null

  const supersample = resolveSupersample(renderer, width, height, quality)

  /*
   * Stop the preview loop before touching the renderer.
   *
   * With R3F's default frameloop of 'always', its rAF keeps firing
   * throughout: SceneDriver writes a new pose and R3F renders into the same
   * canvas between the resize and the export render, so the capture picks up
   * a torn mix of two frames — vertical smears through the image and
   * geometry from the wrong camera position. The resize observer can also
   * snap the canvas back to preview size mid-export.
   *
   * The capture below is synchronous, which closes the widest part of that
   * window, but the resize/render pair still has to run uninterrupted.
   */
  setFrameloop('never')

  // Always clear to transparent, even for an opaque export. Clearing to 1
  // meant clearing to three's default *black*, which is why every
  // non-transparent export came out black whatever background was set — the
  // backdrop is composited under the render instead.
  renderer.setClearAlpha(0)
  renderer.setPixelRatio(1)
  renderer.setSize(width * supersample, height * supersample, false)

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  // `willReadFrequently` picks the software backend: every pixel of the
  // capture is read back exactly once below, so the readback cost dominates
  // the draw.
  const captured = new OffscreenCanvas(width * supersample, height * supersample)
  const capturedCtx = captured.getContext('2d', { willReadFrequently: true })!

  /*
   * REPLACE the capture each frame, never draw over it.
   *
   * This canvas is allocated once and reused for every frame of a clip. The
   * render is transparent everywhere the device isn't, so a default
   * `source-over` drawImage leaves the previous frame showing through — and
   * over a 360° spin that accumulates into a fan of every pose the device
   * has already passed through, fringing the body like a motion blur that
   * will not go away. A still export never showed it, because a still
   * allocates this canvas and throws it away.
   *
   * `copy` discards the destination entirely, which is both correct and
   * cheaper than clearing before every draw.
   */
  capturedCtx.globalCompositeOperation = 'copy'

  const resolved = supersample === 1 ? null : new OffscreenCanvas(width, height)
  const resolvedCtx = resolved?.getContext('2d') ?? null

  const composited = backdrop ? new OffscreenCanvas(width, height) : null
  const compositedCtx = composited?.getContext('2d') ?? null

  return {
    supersample,

    renderFrame() {
      renderer.render(scene, camera)

      if (renderer.getContext().isContextLost()) {
        throw new Error('WebGL context lost during export — try a lower quality setting')
      }

      /*
       * Copy the drawing buffer out *synchronously*.
       *
       * `toBlob` reads it asynchronously, which is what made the tearing race
       * above possible in the first place; a `drawImage` off the WebGL canvas
       * completes within this tick, so there is no window for another frame
       * to land in the buffer. It also skips encoding and re-decoding a
       * full-resolution PNG purely to hand pixels to the downsampler.
       */
      capturedCtx.drawImage(renderer.domElement, 0, 0)

      let frame = captured
      if (resolved && resolvedCtx) {
        downsampleInto(captured, capturedCtx, resolvedCtx, supersample, width, height)
        frame = resolved
      }

      if (composited && compositedCtx && backdrop) {
        /*
         * Order matters and there is only one that works: the backdrop is
         * opaque, so it has to be painted first and the render drawn over it
         * with its own alpha. Painting the backdrop over the render with
         * `destination-over` gives the same picture on a hard silhouette but
         * not through a soft shadow, whose alpha is exactly what lets the
         * background show through it.
         */
        // Reused canvas, same hazard as the capture above. Every painter
        // currently fills the whole rect opaquely, so this clear is
        // redundant *today* — it is here so that a future painter which
        // doesn't cannot silently reintroduce ghosting.
        compositedCtx.clearRect(0, 0, width, height)
        backdrop(compositedCtx, width, height)
        compositedCtx.drawImage(frame, 0, 0)
        frame = composited
      }

      return frame
    },

    dispose() {
      // Restore unconditionally: a thrown export must not leave the preview
      // frozen at export resolution with its loop stopped.
      renderer.setPixelRatio(prevPixelRatio)
      renderer.setSize(prevSize.x, prevSize.y, false)
      if (camera instanceof THREE.PerspectiveCamera && prevAspect !== null) {
        camera.aspect = prevAspect
        camera.updateProjectionMatrix()
      }
      setFrameloop('always')
    },
  }
}

/** Output rows resolved per pass. See the memory note in `downsampleInto`. */
const BAND_ROWS = 64

/**
 * Collapse the supersampled capture by an exact integer box average.
 *
 * This used to be a chain of `drawImage` halvings, near-exact at 4x but
 * measured at 27.67 RMS and 11.8% lost edge detail at 3x — the default tier.
 * See `downsample.ts` for the numbers and why the shape of the chain causes
 * it. `boxDownsample` is the exact answer at every factor, so both the
 * special case and the dependence on the browser's kernel disappear.
 *
 * The work is banded because the alternative is a second full-resolution
 * RGBA copy: at 4x on a 1920x1080 export that is a 320MB `ImageData` on top
 * of the capture. A band holds `BAND_ROWS * supersample` source rows, and
 * banding is only sound because no output row reads outside its own block —
 * asserted by a test rather than trusted.
 */
function downsampleInto(
  captured: OffscreenCanvas,
  srcCtx: OffscreenCanvasRenderingContext2D,
  outCtx: OffscreenCanvasRenderingContext2D,
  factor: number,
  width: number,
  height: number,
) {
  const outImage = outCtx.createImageData(width, height)

  for (let y = 0; y < height; y += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - y)
    const band = srcCtx.getImageData(0, y * factor, captured.width, rows * factor)
    const { data } = boxDownsample(band.data, captured.width, rows * factor, factor)
    outImage.data.set(data, y * width * 4)
  }

  outCtx.putImageData(outImage, 0, 0)
}
