import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { beginFrameExport, type ExportQuality, type FrameExportParams } from './frameRenderer'
import { frameTimes } from './sequence'
import type { SceneApplier } from './renderer'
import { hasScreenVideos, seekScreenVideos } from '../media/screenVideo'

/**
 * Video export (M9, §9.2–9.3).
 *
 * Same deterministic loop as the PNG sequence — `t = i / fps`, the same
 * `sampleTimeline` behind `applyAt`, the same renderer — with a
 * `VideoEncoder` and a muxer on the end instead of a zip. Nothing about the
 * animation knows which one it is feeding.
 *
 * `MediaRecorder` is deliberately not used (§3): it is realtime-only, drops
 * frames under load, has no alpha and no control over bitrate or keyframe
 * interval. An export that runs slower than realtime — which every 4x
 * supersampled render does — is exactly the case it handles worst.
 */

export type VideoFormat = 'webm-alpha' | 'webm' | 'mp4'

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = {
  'webm-alpha': 'WebM (transparent)',
  webm: 'WebM',
  mp4: 'MP4 (H.264)',
}

export const VIDEO_FORMAT_EXTENSIONS: Record<VideoFormat, string> = {
  'webm-alpha': 'webm',
  webm: 'webm',
  mp4: 'mp4',
}

/**
 * Bitrate multiplier per export quality tier.
 *
 * The tier already means "how much do we spend to keep detail" on the render
 * side — 2x/3x/4x supersampling. It should mean the same thing at the
 * encoder, because the two losses are indistinguishable to the person
 * looking at the result: a screen softened by minification and a screen
 * softened by a starved encoder both just look soft.
 *
 * Without this the tier was half a control. Someone who picked Max got a 4x
 * render and then watched it squeezed through the same 8 Mbps as Standard,
 * which at 1080p30 is where §9.4's formula lands for *every* export below 4K.
 */
const QUALITY_BITRATE_SCALE: Record<ExportQuality, number> = {
  standard: 1,
  high: 2,
  max: 4,
}

/**
 * §9.4: `width × height × fps × 0.12`, scaled by the quality tier.
 *
 * Device mockups are mostly flat gradient with one high-detail region, so
 * they compress well and erring high costs little — a soft screen is the
 * thing this whole app fights, and it would be absurd to reintroduce it in
 * the encoder after supersampling the render to avoid it.
 *
 * Two deliberate departures from the spec's numbers, both because its
 * coefficient is tuned for general video and ours is a screen recording of
 * UI text — the content a low bitrate destroys first and the content the
 * whole app exists to show:
 *
 * - the ceiling is 80 Mbps, not 40, so the top tier is not clipped;
 * - the tier scales it, so High and Max actually buy something.
 *
 * The 8 Mbps floor stays. It is what a small export gets, and starving a
 * small export is how you get a soft thumbnail.
 */
export function bitrateFor(
  width: number,
  height: number,
  fps: number,
  quality: ExportQuality = 'standard',
): number {
  const wanted = width * height * fps * 0.12 * QUALITY_BITRATE_SCALE[quality]
  return Math.round(Math.min(80_000_000, Math.max(8_000_000, wanted)))
}

/**
 * Encoded dimensions must be even.
 *
 * H.264 with 4:2:0 chroma cannot represent an odd dimension at all — the
 * encoder either rejects the config or, worse, silently produces a file one
 * pixel narrower than the frames being fed to it, which shows as a shear
 * that grows down the image. Rounding down rather than up keeps the output
 * inside the size the user asked for.
 */
export function evenSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.floor(width / 2) * 2, height: Math.floor(height / 2) * 2 }
}

/**
 * H.264 levels, as (max frame size in macroblocks, max macroblocks/second).
 *
 * Ordered low to high; the lowest level that fits is the right one, because
 * a level is a promise about decoder requirements and overstating it can
 * lock out playback on modest hardware.
 */
const AVC_LEVELS: { id: number; maxFrameMbs: number; maxMbsPerSecond: number }[] = [
  { id: 0x28, maxFrameMbs: 8192, maxMbsPerSecond: 245_760 }, // 4.0
  { id: 0x29, maxFrameMbs: 8192, maxMbsPerSecond: 245_760 }, // 4.1
  { id: 0x2a, maxFrameMbs: 8704, maxMbsPerSecond: 522_240 }, // 4.2
  { id: 0x32, maxFrameMbs: 22_080, maxMbsPerSecond: 589_824 }, // 5.0
  { id: 0x33, maxFrameMbs: 36_864, maxMbsPerSecond: 983_040 }, // 5.1
  { id: 0x34, maxFrameMbs: 36_864, maxMbsPerSecond: 2_073_600 }, // 5.2
  { id: 0x3c, maxFrameMbs: 139_264, maxMbsPerSecond: 4_177_920 }, // 6.0
  { id: 0x3d, maxFrameMbs: 139_264, maxMbsPerSecond: 8_355_840 }, // 6.1
  { id: 0x3e, maxFrameMbs: 139_264, maxMbsPerSecond: 16_711_680 }, // 6.2
]

/**
 * Pick the H.264 codec string for a given output, level included.
 *
 * This was hardcoded to `avc1.640028` — High profile, **level 4.0**, which
 * tops out around 1920x1088. Every portrait phone export exceeds it: a
 * 1350x1600 canvas is 8500 macroblocks against level 4.0's 8192. So
 * `isConfigSupported` said no, MP4 vanished from the format picker, and the
 * only clip export left on screen was the PNG sequence — which is exactly
 * what "I exported and all I got was a zip" looks like from the outside.
 *
 * Worse, the app pushes people straight into that range: the sharpness
 * readout's "Resize to..." button routinely suggests 3000px+ to reach 1:1.
 * The feature that fixes soft screens was disabling the format most people
 * want.
 */
export function avcCodecString(width: number, height: number, fps: number): string {
  const frameMbs = Math.ceil(width / 16) * Math.ceil(height / 16)
  const level =
    AVC_LEVELS.find((l) => frameMbs <= l.maxFrameMbs && frameMbs * fps <= l.maxMbsPerSecond) ??
    AVC_LEVELS[AVC_LEVELS.length - 1]

  // High profile (0x64), constraint flags 0, then the level.
  return `avc1.6400${level.id.toString(16).padStart(2, '0')}`
}

function encoderConfig(
  format: VideoFormat,
  width: number,
  height: number,
  fps: number,
  quality: ExportQuality,
  bitrateScale = 1,
): VideoEncoderConfig {
  const base = {
    width,
    height,
    bitrate: Math.round(bitrateFor(width, height, fps, quality) * bitrateScale),
    framerate: fps,
  }
  // Profile choices, not arbitrary strings: vp09.00.10.08 is VP9 profile 0,
  // 8-bit — the only profile with broad alpha support. Its level field is
  // left at 1.0 because Chrome demonstrably ignores it (it encodes 4000x4800
  // happily); H.264's level is enforced, so that one is computed.
  return format === 'mp4'
    ? { ...base, codec: avcCodecString(width, height, fps) }
    : {
        ...base,
        codec: 'vp09.00.10.08',
        ...(format === 'webm-alpha' ? { alpha: 'keep' as const } : {}),
      }
}

/**
 * Which formats this browser will actually encode, best first.
 *
 * Feature detection is not optional here (§9.3): alpha encode support is
 * genuinely inconsistent across browsers and versions, and a config that is
 * unsupported throws at `configure` — i.e. after the user has committed to
 * an export. Asking first is the difference between a greyed-out option and
 * a failed export.
 */
export async function supportedVideoFormats(
  width: number,
  height: number,
  fps: number,
  quality: ExportQuality = 'standard',
): Promise<VideoFormat[]> {
  if (typeof VideoEncoder === 'undefined') return []

  const size = evenSize(width, height)
  const formats: VideoFormat[] = ['webm-alpha', 'webm', 'mp4']
  const checks = await Promise.all(
    formats.map(async (format) => {
      try {
        const support = await VideoEncoder.isConfigSupported(
          encoderConfig(format, size.width, size.height, fps, quality),
        )
        return support.supported ? format : null
      } catch {
        // Chrome throws rather than returning `supported: false` for some
        // malformed-for-this-build configs.
        return null
      }
    }),
  )
  return checks.filter((f): f is VideoFormat => f !== null)
}

export type VideoExportParams = Omit<FrameExportParams, 'width' | 'height'> & {
  width: number
  height: number
  duration: number
  fps: number
  format: VideoFormat
  /** Multiplier on the §9.4 bitrate. See the quality tiers in the UI. */
  bitrateScale?: number
  applyAt: SceneApplier
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Frames queued in the encoder before the loop waits for it to catch up. */
const MAX_QUEUE = 8

export async function exportVideo({
  duration,
  fps,
  format,
  bitrateScale = 1,
  applyAt,
  onProgress,
  signal,
  width,
  height,
  ...frameParams
}: VideoExportParams): Promise<Blob> {
  const size = evenSize(width, height)
  const times = frameTimes(duration, fps)
  const alpha = format === 'webm-alpha'

  const target = format === 'mp4' ? new Mp4Target() : new WebmTarget()
  const muxer =
    format === 'mp4'
      ? new Mp4Muxer({
          target: target as Mp4Target,
          video: { codec: 'avc', width: size.width, height: size.height, frameRate: fps },
          // The whole file is in memory anyway, so move the index to the
          // front: without it the result will not start playing until it has
          // fully downloaded, which is the difference between a file that
          // looks broken in a browser and one that does not.
          fastStart: 'in-memory',
        })
      : new WebmMuxer({
          target: target as WebmTarget,
          video: {
            codec: 'V_VP9',
            width: size.width,
            height: size.height,
            frameRate: fps,
            alpha,
          },
        })

  let encoderError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e
    },
  })
  encoder.configure(
    encoderConfig(format, size.width, size.height, fps, frameParams.quality ?? 'high', bitrateScale),
  )

  const exporter = beginFrameExport({ ...frameParams, width: size.width, height: size.height })

  try {
    for (let i = 0; i < times.length; i++) {
      signal?.throwIfAborted()
      if (encoderError) throw encoderError

      applyAt(times[i])
      if (hasScreenVideos()) await seekScreenVideos(times[i])

      const rendered = exporter.renderFrame()

      /*
       * Every VideoFrame must be closed explicitly (§14 trap 1). They hold
       * GPU memory that GC does not reclaim, so a single missed `close()`
       * takes the tab down somewhere around frame 300 — far enough in to
       * look like a mysterious failure of long exports rather than a leak.
       */
      const frame = new VideoFrame(rendered, {
        timestamp: Math.round(times[i] * 1_000_000), // microseconds
        duration: Math.round(1_000_000 / fps),
        alpha: alpha ? 'keep' : 'discard',
      })
      try {
        // A keyframe every two seconds: seeking in the result stays usable
        // without paying for an all-intra file.
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      } finally {
        frame.close()
      }

      // Encoding is async and slower than rendering. Without this the loop
      // queues every frame in the clip and runs the tab out of memory long
      // before the encoder catches up.
      while (encoder.encodeQueueSize > MAX_QUEUE && !encoderError) {
        await waitForDequeue(encoder)
      }

      onProgress?.((i + 1) / times.length)
    }

    await encoder.flush()
    if (encoderError) throw encoderError
    muxer.finalize()

    const buffer = (target as WebmTarget | Mp4Target).buffer
    return new Blob([buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' })
  } finally {
    exporter.dispose()
    // `close()` on an already-closed encoder throws, and a cancelled export
    // reaches here with one that was never flushed.
    if (encoder.state !== 'closed') encoder.close()
  }
}

/**
 * Wait for the encoder to drain one frame.
 *
 * `dequeue` is the event the spec provides for exactly this; the timeout is
 * a floor, not the mechanism — a browser that never fires it would otherwise
 * hang the export forever rather than merely running it slowly.
 */
function waitForDequeue(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      encoder.removeEventListener('dequeue', done)
      resolve()
    }
    const timer = setTimeout(done, 100)
    encoder.addEventListener('dequeue', done, { once: true })
  })
}
