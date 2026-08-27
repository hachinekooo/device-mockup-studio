import * as THREE from 'three'

/**
 * Screen video: playing a recording on a device's display (M7, §8.3).
 *
 * The rule the whole design follows: **video time is derived from timeline
 * time, never played independently.**
 *
 *     screenTime = clamp(t - clipOffset, 0, clipDuration)
 *
 * One expression, two implementations. In preview it maps to
 * `videoEl.currentTime` and accepts some slop — a video element playing at
 * its own rate is smoother than one seeked 60 times a second, and nobody can
 * see 80ms of drift. In export it maps to an exact seek, awaited, so frame
 * `i` of the export shows the frame at `i / fps` no matter how long the
 * render took.
 */

/** Preview drift, in seconds, before the element is seeked back into line. */
const SYNC_TOLERANCE = 0.12

/** Time into the clip shown at timeline time `t`. */
export function screenTimeAt(t: number, clipDuration: number, offset = 0): number {
  return Math.min(Math.max(t - offset, 0), clipDuration)
}

export type ScreenVideo = {
  el: HTMLVideoElement
  texture: THREE.VideoTexture
  /** Clip length in seconds — what the screen time is clamped to. */
  duration: number
  dispose: () => void
}

/**
 * Build a video element and its texture for a screen.
 *
 * `muted` and `playsInline` are not cosmetic: without both, autoplay is
 * blocked and the element never produces a frame, so the screen renders
 * black with no error anywhere.
 *
 * Mipmaps stay OFF here, unlike a still screenshot. Regenerating a mip chain
 * on every uploaded frame costs more than the sharpness it buys, and the
 * export renders the screen at or above 1:1 anyway (see `frameRenderer.ts`),
 * which is the case mipmaps do nothing for.
 */
export function createScreenVideo(
  url: string,
  duration: number,
  renderer: THREE.WebGLRenderer,
): ScreenVideo {
  const el = document.createElement('video')
  el.src = url
  el.muted = true
  el.playsInline = true
  el.loop = false // looping is the timeline's job, not the element's
  el.preload = 'auto'
  el.crossOrigin = 'anonymous'

  const texture = new THREE.VideoTexture(el)
  texture.colorSpace = THREE.SRGBColorSpace // §14 trap 3
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()

  const entry: ScreenVideo = {
    el,
    texture,
    duration,
    dispose: () => {
      registry.delete(entry)
      el.pause()
      el.removeAttribute('src')
      el.load()
      texture.dispose()
    },
  }

  registry.add(entry)
  return entry
}

/**
 * Every screen video currently in the scene.
 *
 * A registry rather than props threaded through the scene tree because the
 * two consumers are in different worlds: SceneDriver runs inside the R3F
 * loop, and the export loop runs outside React entirely. Both need "all the
 * videos, now", and neither should have to know how many devices there are.
 */
const registry = new Set<ScreenVideo>()

/**
 * Preview sync. Cheap, called every frame, never awaits.
 *
 * While the timeline plays, the element plays too and is only nudged when it
 * drifts past the tolerance — seeking every frame gives visibly worse
 * playback than letting the decoder run. While the timeline is paused or
 * being scrubbed, the element is paused and follows the playhead exactly,
 * which is what makes scrubbing feel connected to the screen content.
 */
export function syncScreenVideos(t: number, playing: boolean) {
  for (const { el, texture, duration } of registry) {
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) continue

    const want = screenTimeAt(t, duration)
    const drifted = Math.abs(el.currentTime - want) > SYNC_TOLERANCE

    // Past the end of a clip shorter than the timeline, the last frame holds
    // — so stop the element rather than letting it sit in an ended state
    // that a later wrap has to recover from.
    const shouldPlay = playing && want < duration

    if (shouldPlay) {
      if (drifted) el.currentTime = want
      if (el.paused) void el.play().catch(() => {})
    } else {
      if (!el.paused) el.pause()
      if (drifted) {
        el.currentTime = want
        // A paused element uploads nothing on its own; without this the
        // screen keeps showing the frame it was stopped on while the
        // scrubber moves.
        texture.needsUpdate = true
      }
    }
  }
}

/**
 * Export sync: seek every screen video to exactly `t` and wait for the frame.
 *
 * This is the difference between preview and export. `beginFrameExport`
 * renders synchronously, so the awaiting has to happen before it — a render
 * fired without waiting for `seeked` shows whatever frame the decoder
 * happened to have, which is how an export ends up with the same frame
 * repeated a dozen times and then a jump.
 *
 * A seek that never completes must not hang the export, so each one races a
 * timeout: a stale frame is a far better outcome than a progress bar that
 * stops at 40%.
 */
export async function seekScreenVideos(t: number, timeoutMs = 2000): Promise<void> {
  await Promise.all([...registry].map((entry) => seekOne(entry, t, timeoutMs)))
}

function seekOne({ el, texture, duration }: ScreenVideo, t: number, timeoutMs: number) {
  const want = screenTimeAt(t, duration)

  return new Promise<void>((resolve) => {
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) return resolve()
    if (!el.paused) el.pause()

    // Already there — seeking to the current time fires no event, so this
    // would otherwise wait for the timeout on every duplicated frame.
    if (Math.abs(el.currentTime - want) < 1e-4) {
      texture.needsUpdate = true
      return resolve()
    }

    const done = () => {
      clearTimeout(timer)
      el.removeEventListener('seeked', done)
      texture.needsUpdate = true
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    el.addEventListener('seeked', done, { once: true })
    el.currentTime = want
  })
}

/** True when the scene has any video screen — lets callers skip the await. */
export function hasScreenVideos(): boolean {
  return registry.size > 0
}
