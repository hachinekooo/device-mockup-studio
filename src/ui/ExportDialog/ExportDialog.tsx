import { useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../store/project'
import type { BackgroundConfig } from '../../store/schema'
import { exportStillPng } from '../../export/still'
import { exportPngSequence, frameTimes } from '../../export/sequence'
import {
  bitrateFor,
  exportVideo,
  supportedVideoFormats,
  VIDEO_FORMAT_EXTENSIONS,
  VIDEO_FORMAT_LABELS,
  type VideoFormat,
} from '../../export/video'
import {
  maxOutputScale,
  resolveSupersample,
  type ExportQuality,
} from '../../export/frameRenderer'
import { loadBackdrop } from '../../export/backdrop'
import { resolveExportSize } from '../../export/exportSize'
import { worstCaseScreenCoverage } from '../../export/screenCoverage'
import { getExportContext } from '../../export/renderer'
import { hasScreenVideos, seekScreenVideos } from '../../media/screenVideo'
import { Segmented } from '../controls/Segmented'

export async function runExport(
  width: number,
  height: number,
  background: BackgroundConfig,
  quality: ExportQuality = 'high',
) {
  const ctx = getExportContext()
  if (!ctx) return
  // Decode the backdrop before touching the renderer: exportStillPng stops
  // the preview loop for its whole duration, and awaiting an image decode
  // inside that window freezes the viewport for no reason.
  const backdrop = await loadBackdrop(background)
  // A still of a video screen must show the frame at the playhead, not
  // whichever one the decoder was resting on.
  if (hasScreenVideos()) await seekScreenVideos(useProjectStore.getState().playhead)
  const blob = await exportStillPng({
    renderer: ctx.renderer,
    scene: ctx.scene,
    camera: ctx.camera,
    width,
    height,
    backdrop,
    quality,
    setFrameloop: ctx.setFrameloop,
  })
  download(blob, 'mockup.png')
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** What an export of the whole clip needs, whichever container it ends in. */
type ClipExportOptions = {
  width: number
  height: number
  background: BackgroundConfig
  quality: ExportQuality
  duration: number
  fps: 30 | 60
  name: string
  onProgress: (fraction: number) => void
  signal: AbortSignal
}

/** Everything both clip exports need from the live scene. */
async function clipParams({ width, height, background, quality, ...rest }: ClipExportOptions) {
  const ctx = getExportContext()
  if (!ctx) return null
  return {
    renderer: ctx.renderer,
    scene: ctx.scene,
    camera: ctx.camera,
    width,
    height,
    backdrop: await loadBackdrop(background),
    quality,
    setFrameloop: ctx.setFrameloop,
    duration: rest.duration,
    fps: rest.fps,
    // The same function the preview loop calls, at times derived from the
    // frame index instead of a clock (§4).
    applyAt: ctx.applyAt,
    onProgress: rest.onProgress,
    signal: rest.signal,
  }
}

/**
 * PNG sequence export (M8). The guaranteed path: no codec support to detect
 * and nothing a browser bug can block — the user runs one ffmpeg command on
 * the result, and the command is in the hint beside the button.
 */
export async function runSequenceExport(options: ClipExportOptions) {
  const params = await clipParams(options)
  if (!params) return
  const blob = await exportPngSequence(params)
  download(blob, `${options.name || 'mockup'}-frames.zip`)
}

/**
 * Video export (M9). Convenience over the sequence path, not a replacement
 * for it: the codec support matrix is real and the sequence is what stays
 * available when a browser says no.
 */
export async function runVideoExport(options: ClipExportOptions & { format: VideoFormat }) {
  const params = await clipParams(options)
  if (!params) return
  const blob = await exportVideo({ ...params, format: options.format })
  download(blob, `${options.name || 'mockup'}.${VIDEO_FORMAT_EXTENSIONS[options.format]}`)
}

export function ExportControls() {
  const output = useProjectStore((s) => s.project.output)
  const background = useProjectStore((s) => s.project.background)
  const setOutput = useProjectStore((s) => s.setOutput)
  const quality = useProjectStore((s) => s.exportQuality)
  const setExportQuality = useProjectStore((s) => s.setExportQuality)
  const editorMode = useProjectStore((s) => s.editorMode)
  const name = useProjectStore((s) => s.project.name)
  const duration = useProjectStore((s) => s.project.duration)
  const fps = useProjectStore((s) => s.project.fps)
  const setFps = useProjectStore((s) => s.setFps)
  const matchSource = useProjectStore((s) => s.matchSource)
  const setMatchSource = useProjectStore((s) => s.setMatchSource)
  // The detail readout applies to a recording exactly as it does to a
  // screenshot; calling a video a screenshot just makes it look like the
  // number is about something else.
  const screenKind = useProjectStore((s) => s.project.devices[s.activeDevice]?.screen?.kind)
  const screenNoun = screenKind === 'video' ? 'recording' : 'screenshot'
  const [busy, setBusy] = useState(false)
  // null when idle. 0 is a real value — the first frame has not finished —
  // so this cannot be a plain number defaulting to zero.
  const [progress, setProgress] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  /*
   * Which codecs this browser will actually encode (§9.3). Detected rather
   * than assumed: alpha support in particular varies by browser *and*
   * version, and an unsupported config throws at `configure` — i.e. after
   * the user has committed to the export. `null` while the check is in
   * flight, so the picker doesn't flash a wrong answer.
   */
  const [formats, setFormats] = useState<VideoFormat[] | null>(null)
  const [format, setFormat] = useState<VideoFormat | null>(null)

  const ctx = getExportContext()

  /*
   * Relate the output size back to the screenshot's own resolution.
   *
   * Quality tiers fix how the screen is *sampled*; they cannot add pixels the
   * output canvas does not have. At 1920x1080 a phone screenshot is
   * reproduced at roughly a third of its height no matter which tier is
   * chosen, which is the whole of the remaining "crisp going in, soft coming
   * out" complaint — and nothing here said so. Read live from the scene, so
   * it reflects the actual pose rather than an assumed framing.
   */
  /*
   * Worst case over the whole clip, memoised.
   *
   * The sweep samples the timeline and every device, which is cheap
   * (sub-millisecond) but not free, and this component re-renders on every
   * keystroke in the size fields. Keyed on the project and the size so it
   * runs once per edit rather than once per render.
   */
  const project = useProjectStore((s) => s.project)
  const coverage = useMemo(
    () => (ctx ? worstCaseScreenCoverage(ctx.scene, project, output.width, output.height) : null),
    [ctx, project, output.width, output.height],
  )

  /*
   * The size every export below actually uses.
   *
   * Resolved here rather than written into the document: `output` is the
   * user's *composition* (its aspect is what the artboard letterboxes to),
   * and rewriting it on every device nudge would fill the undo stack with
   * size changes nobody made. Both axes scale together, so the framing is
   * identical — only the pixel count differs.
   */
  const exportSize = resolveExportSize({
    width: output.width,
    height: output.height,
    coverage,
    matchSource,
    gpuScaleLimit: ctx
      ? maxOutputScale(output.width, output.height, ctx.renderer.capabilities.maxTextureSize)
      : 1,
    // Only H.264 carries the macroblock ceiling; WebM and the PNG sequence
    // have no equivalent, so they must not be shrunk for it.
    encoderLimited: format === 'mp4',
  })

  const resized = exportSize.width !== output.width || exportSize.height !== output.height

  // Show the resolution actually rendered, since the GPU can clamp it — and
  // it is the resolved size that gets rendered, not the composition size.
  const supersample = ctx
    ? resolveSupersample(ctx.renderer, exportSize.width, exportSize.height, quality)
    : 1

  const frameCount = frameTimes(duration, fps).length

  useEffect(() => {
    let live = true
    void supportedVideoFormats(output.width, output.height, fps, quality).then((supported) => {
      if (!live) return
      setFormats(supported)
      // Keep the user's pick if this size still supports it; otherwise fall
      // back to the best available rather than leaving a dead selection.
      setFormat((current) =>
        current && supported.includes(current) ? current : (supported[0] ?? null),
      )
    })
    return () => {
      live = false
    }
  }, [output.width, output.height, fps, quality])

  // Transparency survives only in the alpha-capable format; everywhere else
  // the encoder discards it and the result is black where the backdrop
  // would have been. Say so before the export, not after.
  const alphaWillBeLost =
    background.type === 'transparent' && format !== null && format !== 'webm-alpha'

  async function handleExport() {
    setBusy(true)
    try {
      await runExport(exportSize.width, exportSize.height, background, quality)
    } finally {
      setBusy(false)
    }
  }

  async function runClipExport(run: (options: ClipExportOptions) => Promise<void>) {
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setProgress(0)
    try {
      await run({
        width: exportSize.width,
        height: exportSize.height,
        background,
        quality,
        duration,
        fps,
        name,
        onProgress: setProgress,
        signal: controller.signal,
      })
    } catch (err) {
      // Cancelling is a normal outcome, not a failure to report.
      if (!controller.signal.aborted) throw err
    } finally {
      abortRef.current = null
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="control-group">
      <div className="row">
        <input
          type="number"
          value={matchSource ? exportSize.width : output.width}
          onChange={(e) => {
            // Typing a size is the override. No separate toggle to find:
            // the moment you set one, it is yours.
            setMatchSource(false)
            setOutput({ width: Number(e.target.value) })
          }}
        />
        <span>×</span>
        <input
          type="number"
          value={matchSource ? exportSize.height : output.height}
          onChange={(e) => {
            setMatchSource(false)
            setOutput({ height: Number(e.target.value) })
          }}
        />
      </div>
      <div className="control-group">
        <label>Quality</label>
        <Segmented<ExportQuality>
          value={quality}
          onChange={setExportQuality}
          options={[
            { id: 'standard', label: 'Standard', title: 'Renders at 2× — fastest' },
            { id: 'high', label: 'High', title: 'Renders at 3× — screenshots stay crisp' },
            { id: 'max', label: 'Max', title: 'Renders at 4× — slowest, sharpest' },
          ]}
        />
        <p className="hint">
          Renders at {exportSize.width * supersample} × {exportSize.height * supersample}, then
          downsamples. Higher settings keep the {screenNoun} from being sampled below its own
          resolution, and give the video encoder more bitrate to keep it there.
        </p>
      </div>

      {coverage && (
        <div className="control-group">
          <label>Screen detail</label>
          {matchSource ? (
            <p className="hint">
              {exportSize.limitedBy === 'none' ? (
                <>
                  Sized to your {coverage.sourceHeight}px {screenNoun}: every pixel of it
                  survives{resized ? ` at ${exportSize.width} × ${exportSize.height}` : ''}.
                </>
              ) : exportSize.limitedBy === 'encoder' ? (
                <>
                  Capped at {exportSize.width} × {exportSize.height} by the H.264 encoder, which
                  stops just above 4K. Your {coverage.sourceHeight}px {screenNoun} lands on{' '}
                  <strong>{Math.round(exportSize.ratio * coverage.sourceHeight)}px</strong>. Switch
                  to WebM or the PNG sequence to go larger — or use a portrait canvas, which needs
                  far fewer pixels for the same device.
                </>
              ) : (
                <>
                  Capped at {exportSize.width} × {exportSize.height} by this GPU. Your{' '}
                  {coverage.sourceHeight}px {screenNoun} lands on{' '}
                  <strong>{Math.round(exportSize.ratio * coverage.sourceHeight)}px</strong>.
                </>
              )}
            </p>
          ) : (
            <p className="hint">
              Your {coverage.sourceHeight}px {screenNoun} is reproduced on{' '}
              <strong>{coverage.renderedHeight}px</strong> ({Math.round(coverage.ratio * 100)}%) at
              the size you set. Quality settings cannot recover the rest — only more pixels can.
            </p>
          )}
          {!matchSource && (
            <button className="ghost-btn" onClick={() => setMatchSource(true)}>
              Match export to source
            </button>
          )}
        </div>
      )}

      <button className="export-btn" onClick={handleExport} disabled={busy}>
        {busy && progress === null
          ? 'Exporting…'
          : `Export PNG (${supersample}×${background.type === 'transparent' ? ', alpha' : ''})`}
      </button>

      {/* A still has no time axis, so the sequence controls only exist in
          Movie mode — the same rule the timeline zone follows. */}
      {editorMode === 'movie' && (
        <div className="control-group">
          <label>Frame rate</label>
          <Segmented<30 | 60>
            value={fps}
            onChange={setFps}
            options={[
              { id: 30, label: '30 fps', title: 'Smaller export, the usual choice' },
              { id: 60, label: '60 fps', title: 'Twice the frames, twice the export time' },
            ]}
          />
          <p className="hint">{frameCount} frames over {duration}s.</p>

          {formats !== null && formats.length > 0 && format !== null && (
            <>
              <label>Video format</label>
              <Segmented<VideoFormat>
                value={format}
                onChange={setFormat}
                options={formats.map((f) => ({ id: f, label: VIDEO_FORMAT_LABELS[f] }))}
              />
              {!formats.includes('mp4') && (
                <p className="hint">
                  MP4 isn't available at {output.width} × {output.height} — this machine's H.264
                  encoder won't go that large. WebM plays everywhere except older Safari, or
                  reduce the export size to get MP4 back.
                </p>
              )}
              {alphaWillBeLost && (
                <p className="hint">
                  Your background is transparent, but {VIDEO_FORMAT_LABELS[format]} cannot carry
                  alpha — those areas will export black. Use WebM (transparent) or the PNG
                  sequence.
                </p>
              )}
            </>
          )}

          {formats?.length === 0 && (
            <p className="hint">
              This browser can't encode video — video export is Chromium-only for now (§11). The
              PNG sequence below always works.
            </p>
          )}

          {progress !== null && (
            <div className="export-progress">
              <div className="export-progress-bar" style={{ width: `${progress * 100}%` }} />
            </div>
          )}

          {progress !== null ? (
            <button className="export-btn" onClick={() => abortRef.current?.abort()}>
              Cancel — {Math.round(progress * frameCount)} / {frameCount}
            </button>
          ) : (
            <>
              {format !== null && (
                <button
                  className="export-btn"
                  disabled={busy}
                  onClick={() =>
                    void runClipExport((o) => runVideoExport({ ...o, format }))
                  }
                >
                  Export video ({VIDEO_FORMAT_LABELS[format]})
                </button>
              )}
              <button
                className="ghost-btn"
                disabled={busy}
                onClick={() => void runClipExport(runSequenceExport)}
              >
                Export PNG sequence ({frameCount} frames)
              </button>
              <p className="hint">
                Both render identical frames. The video encodes them at{' '}
                <strong>{(bitrateFor(output.width, output.height, fps, quality) / 1e6).toFixed(0)}{' '}
                Mbps</strong> — raise Quality above for more. The sequence keeps every frame
                lossless and never depends on a codec, for when you want to encode it yourself:{' '}
                <code>ffmpeg -framerate {fps} -i frame_%04d.png -crf 16 out.mp4</code>.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
