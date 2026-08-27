import * as THREE from 'three'
import { bitrateFor, exportVideo, supportedVideoFormats, type VideoFormat } from '../export/video'
import { exportPngSequence } from '../export/sequence'
import { beginFrameExport } from '../export/frameRenderer'
import { loadBackdrop } from '../export/backdrop'

/**
 * Throwaway probe: drives the real export pipeline without R3F.
 *
 * The app's own canvas never boots for browser automation (an occluded
 * window reports `visibilityState: hidden`, which suspends rAF and
 * ResizeObserver), but WebGL, WebCodecs and canvas 2D all work fine there.
 * So the export path can be exercised for real by building a renderer and a
 * scene by hand and handing them to the same functions the UI calls.
 */
export async function runVideoProbe(width = 320, height = 240, fps: 30 | 60 = 30) {
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setClearAlpha(0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100)
  camera.position.set(0, 0, 4)

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff5522 }),
  )
  scene.add(cube)

  // Stands in for sampleTimeline: a pose that is a pure function of t.
  const applyAt = (t: number) => {
    cube.rotation.y = t * Math.PI
    cube.updateMatrixWorld()
  }

  const backdrop = await loadBackdrop({
    type: 'gradient',
    from: '#213',
    to: '#8ac',
    angle: 160,
  })

  const setFrameloop = () => {}
  const base = {
    renderer,
    scene,
    camera,
    width,
    height,
    backdrop,
    quality: 'standard' as const,
    setFrameloop,
    duration: 1,
    fps,
    applyAt,
  }

  const formats = await supportedVideoFormats(width, height, fps)
  const results: Record<string, unknown> = { formats }

  for (const format of formats) {
    const started = performance.now()
    try {
      const blob = await exportVideo({ ...base, format: format as VideoFormat })
      results[format] = {
        bytes: blob.size,
        type: blob.type,
        ms: Math.round(performance.now() - started),
        head: [...new Uint8Array(await blob.slice(0, 12).arrayBuffer())]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' '),
        decoded: await decodeCheck(blob),
        structure: await structureOf(blob, format),
      }
    } catch (err) {
      results[format] = { error: String(err) }
    }
  }

  try {
    const zip = await exportPngSequence(base)
    results.sequence = { bytes: zip.size, type: zip.type }
  } catch (err) {
    results.sequence = { error: String(err) }
  }

  renderer.dispose()
  return results
}

/**
 * How much detail the encoder throws away, measured rather than assumed.
 *
 * The complaint this answers: an exported clip looks washed out next to the
 * source recording. Two candidates — the render, and the encode — and only
 * one of them is fixable with a setting. This isolates the encode: render a
 * frame, keep it, encode the clip, decode the file back through a `<video>`
 * element, and compare the decoded frame against the frame that went in.
 *
 * The test pattern is fine text-like detail, because that is what a screen
 * recording of a UI actually is and it is the first thing a low bitrate
 * smears. A gradient would compress beautifully and prove nothing.
 *
 * KNOWN LIMITATION: the decode-back step needs the browser to actually
 * decode a frame, and a hidden tab throttles that — a perfectly valid file
 * sits at readyState 0 indefinitely (see CONTEXT trap 15). It reported
 * "could not load" for every bitrate when run from automation. **Run this
 * from a visible tab.** The encode side works regardless; it is only the
 * measurement that needs a foreground window.
 */
export async function runEncodeQualityProbe(
  width = 1920,
  height = 1080,
  scales = [1, 2, 4],
) {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement('canvas'),
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setClearAlpha(0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
  camera.position.z = 2.2

  const texture = new THREE.CanvasTexture(detailPattern(1024, 1024))
  texture.colorSpace = THREE.SRGBColorSpace
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2.4),
    new THREE.MeshBasicMaterial({ map: texture }),
  )
  scene.add(plane)

  const applyAt = () => {}
  const fps = 30 as const
  const duration = 0.5

  // Ground truth: the frame the encoder is being handed.
  const exporter = beginFrameExport({
    renderer,
    scene,
    camera,
    width,
    height,
    backdrop: null,
    quality: 'standard',
    setFrameloop: () => {},
  })
  const source = imageDataOf(exporter.renderFrame(), width, height)
  exporter.dispose()

  const results: Record<string, unknown> = {}

  for (const bitrateScale of scales) {
    const blob = await exportVideo({
      renderer,
      scene,
      camera,
      width,
      height,
      backdrop: null,
      quality: 'standard',
      setFrameloop: () => {},
      duration,
      fps,
      format: 'mp4',
      bitrateScale,
      applyAt,
    })

    const decoded = await decodeFrame(blob, 0.25, width, height)
    results[`x${bitrateScale}`] =
      typeof decoded === 'string'
        ? { error: decoded }
        : {
            mbps: +((bitrateFor(width, height, fps) * bitrateScale) / 1e6).toFixed(1),
            bytes: blob.size,
            rms: +rmsError(source, decoded).toFixed(2),
          }
  }

  renderer.dispose()
  return results
}

/**
 * Export one short clip in one format at one size. The cheap check.
 *
 * `runVideoProbe` does every format plus a PNG sequence, which at a portrait
 * export size takes long enough to time out an automation call. This exists
 * to answer a single question — does this format actually produce a file at
 * this size — which is what the H.264 level bug needed.
 */
export async function probeOneVideo(
  format: VideoFormat,
  width: number,
  height: number,
  fps: 30 | 60 = 30,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement('canvas'),
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setClearAlpha(0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100)
  camera.position.z = 4
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshBasicMaterial({ color: 0x33cc88 }),
  )
  scene.add(box)

  try {
    const blob = await exportVideo({
      renderer,
      scene,
      camera,
      width,
      height,
      backdrop: null,
      quality: 'standard',
      setFrameloop: () => {},
      duration: 0.2,
      fps,
      format,
      applyAt: (t) => {
        box.rotation.y = t * Math.PI
        box.updateMatrixWorld()
      },
    })
    return {
      bytes: blob.size,
      type: blob.type,
      head: [...new Uint8Array(await blob.slice(0, 12).arrayBuffer())]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' '),
    }
  } catch (err) {
    return { error: String(err) }
  } finally {
    renderer.dispose()
  }
}

/**
 * Is the encoder actually bitrate-starved at the default tier?
 *
 * This is the half of the quality question that *can* be answered from a
 * hidden tab, because it needs no decode: encode the same moving, detailed
 * clip at each tier and look at the bytes. If raising the cap changes
 * nothing, the encoder was already spending less than it was allowed and the
 * softness lives somewhere else. If the file grows roughly in step with the
 * cap, the encoder wanted those bits and was being denied them.
 *
 * The scene has to MOVE. A static clip compresses to almost nothing whatever
 * the cap, and would report "not starved" for every tier no matter what.
 */
export async function runBitrateProbe(width = 1920, height = 1080) {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement('canvas'),
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setClearAlpha(0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
  camera.position.z = 2.2

  const texture = new THREE.CanvasTexture(detailPattern(1024, 1024))
  texture.colorSpace = THREE.SRGBColorSpace
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2.4),
    new THREE.MeshBasicMaterial({ map: texture }),
  )
  scene.add(plane)

  const fps = 30 as const
  const duration = 1
  const applyAt = (t: number) => {
    plane.rotation.y = Math.sin(t * Math.PI) * 0.5
    plane.updateMatrixWorld()
  }

  const results: Record<string, unknown> = {}

  for (const quality of ['standard', 'high', 'max'] as const) {
    const blob = await exportVideo({
      renderer,
      scene,
      camera,
      width,
      height,
      backdrop: null,
      quality,
      setFrameloop: () => {},
      duration,
      fps,
      format: 'mp4',
      applyAt,
    })
    const capMbps = bitrateFor(width, height, fps, quality) / 1e6
    const actualMbps = (blob.size * 8) / duration / 1e6
    results[quality] = {
      capMbps: +capMbps.toFixed(1),
      actualMbps: +actualMbps.toFixed(1),
      bytes: blob.size,
      // Near 1 means the encoder spent everything it was given — i.e. it
      // wanted more and the cap was the binding constraint.
      usedFraction: +(actualMbps / capMbps).toFixed(2),
    }
  }

  renderer.dispose()
  return results
}

/** Fine alternating detail — the frequency band a low bitrate destroys first. */
function detailPattern(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#111'
  for (let y = 0; y < height; y += 6) ctx.fillRect(0, y, width, 3)
  for (let x = 0; x < width; x += 24) ctx.fillRect(x, 0, 2, height)
  return canvas
}

function imageDataOf(canvas: OffscreenCanvas, width: number, height: number) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return ctx.getImageData(0, 0, width, height)
}

/** Decode one frame out of an exported file, at `time` seconds. */
async function decodeFrame(blob: Blob, time: number, width: number, height: number) {
  const url = URL.createObjectURL(blob)
  const el = document.createElement('video')
  el.preload = 'auto'
  el.muted = true
  el.playsInline = true
  document.body.appendChild(el)
  el.src = url
  el.load()

  try {
    // `loadeddata` waits for a decoded frame and a hidden tab will not
    // deliver one unprompted; metadata arrives, and the seek below is what
    // forces the decode.
    const ready = await new Promise<boolean>((resolve) => {
      el.onloadedmetadata = () => resolve(true)
      el.onerror = () => resolve(false)
      setTimeout(() => resolve(false), 8000)
    })
    if (!ready)
      return `could not load (err=${el.error?.code} rs=${el.readyState} ns=${el.networkState} bytes=${blob.size})`

    await new Promise<void>((resolve) => {
      el.onseeked = () => resolve()
      setTimeout(resolve, 3000)
      el.currentTime = time
    })

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(el, 0, 0, width, height)
    return ctx.getImageData(0, 0, width, height)
  } finally {
    el.remove()
    URL.revokeObjectURL(url)
  }
}

/** RMS error over RGB. Alpha is ignored — the encode discarded it anyway. */
function rmsError(a: ImageData, b: ImageData) {
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a.data[i + c] - b.data[i + c]
      sum += d * d
      n++
    }
  }
  return Math.sqrt(sum / n)
}

/**
 * Regression probe for frame-to-frame ghosting.
 *
 * The capture canvas is reused for every frame of a clip, and the render is
 * transparent everywhere the device is not. Draw one frame over another and
 * the old one shows through — over a spin that builds into a fan of every
 * pose so far. Only a multi-frame export shows it, which is why the still
 * export never did.
 *
 * The test: put a bright object in frame, then move it out. If the second
 * frame carries any of it, the capture is accumulating.
 */
export async function runGhostingProbe(width = 160, height = 120) {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement('canvas'),
    alpha: true,
    preserveDrawingBuffer: true,
  })
  renderer.setClearAlpha(0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100)
  camera.position.z = 4

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  )
  scene.add(box)

  const exporter = beginFrameExport({
    renderer,
    scene,
    camera,
    width,
    height,
    backdrop: null,
    quality: 'standard',
    setFrameloop: () => {},
  })

  try {
    // Frame 1: the box is centred and unmissable.
    box.position.set(0, 0, 0)
    box.updateMatrixWorld()
    const first = countOpaque(exporter.renderFrame(), width, height)

    // Frame 2: the box is far off-screen. Nothing should remain.
    box.position.set(1000, 0, 0)
    box.updateMatrixWorld()
    const second = countOpaque(exporter.renderFrame(), width, height)

    return { firstFrameOpaquePixels: first, secondFrameOpaquePixels: second, ghosting: second > 0 }
  } finally {
    exporter.dispose()
    renderer.dispose()
  }
}

function countOpaque(canvas: OffscreenCanvas, width: number, height: number) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const { data } = ctx.getImageData(0, 0, width, height)
  let n = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) n++
  return n
}

/**
 * Structural read of the container.
 *
 * Weaker than decoding but available where decoding is not: media loading is
 * throttled in a hidden tab, so `<video>` stalls at readyState 0 whatever the
 * file contains. Top-level MP4 boxes and WebM cluster count at least prove
 * the muxer wrote a complete file rather than a header and a shrug.
 */
async function structureOf(blob: Blob, format: VideoFormat) {
  const bytes = new Uint8Array(await blob.arrayBuffer())

  if (format === 'mp4') {
    const view = new DataView(bytes.buffer)
    const boxes: string[] = []
    for (let o = 0; o + 8 <= bytes.length; ) {
      const size = view.getUint32(o)
      const type = String.fromCharCode(...bytes.slice(o + 4, o + 8))
      boxes.push(`${type}:${size}`)
      if (size < 8) break
      o += size
    }
    return boxes.join(' ')
  }

  // WebM Cluster id, 0x1F43B675 — one per group of frames.
  let clusters = 0
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x1f && bytes[i + 1] === 0x43 && bytes[i + 2] === 0xb6 && bytes[i + 3] === 0x75)
      clusters++
  }
  return `clusters=${clusters}`
}

/** A container header proves the muxer ran; only a decoder proves the file. */
async function decodeCheck(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const el = document.createElement('video')
  // A detached element with default preload never starts loading in a hidden
  // tab, which reads as "the file is broken" when it is the probe that is.
  el.preload = 'auto'
  el.muted = true
  el.playsInline = true
  document.body.appendChild(el)
  el.src = url
  el.load()
  try {
    return await new Promise((resolve) => {
      el.onloadedmetadata = () =>
        resolve({ duration: el.duration, width: el.videoWidth, height: el.videoHeight })
      el.onerror = () => resolve(`decode failed (${el.error?.code})`)
      setTimeout(() => resolve(`timeout rs=${el.readyState} ns=${el.networkState}`), 4000)
    })
  } finally {
    el.remove()
    URL.revokeObjectURL(url)
  }
}
