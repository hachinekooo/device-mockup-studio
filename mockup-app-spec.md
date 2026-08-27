# 3D Device Mockup Studio — Technical Specification

A browser-based tool that composites screenshots and screen recordings onto animated 3D device models and exports them as images or video with transparency. Feature-equivalent target: Rotato.

---

## 1. Product definition

**Core loop:** user drops in a screenshot or screen recording → picks a device → picks an angle and animation → picks a background → exports.

**Non-goals (deliberately out of scope):**
- Screen recording itself (use the OS or a companion app; browser `getDisplayMedia` output is low quality and can't capture cursor metadata)
- Video editing beyond trim
- Collaboration, cloud sync, accounts

**Design constraint that shapes everything:** the render must be a *pure function of time*. Nothing in the scene may depend on frame delta, wall clock, or user input during playback. Violate this and frame-accurate export becomes impossible — this is the single most common architectural mistake in this category of app.

---

## 2. Feature matrix

| Feature | v1 | v2 | v3 |
|---|:-:|:-:|:-:|
| Image on device screen | ✅ | | |
| Procedural phone geometry | ✅ | | |
| HDRI lighting + contact shadow | ✅ | | |
| Orbit camera + angle presets | ✅ | | |
| Gradient / solid / image background | ✅ | | |
| PNG export with alpha | ✅ | | |
| GLB device library (phone, tablet, laptop) | | ✅ | |
| Device color variants | | ✅ | |
| Video on device screen | | ✅ | |
| Keyframe timeline + easing | | ✅ | |
| Motion presets (spin, float, tilt-in) | | ✅ | |
| PNG sequence export | | ✅ | |
| WebM/VP9 alpha video export | | ✅ | |
| MP4 export | | ✅ | |
| Project save / load | | ✅ | |
| Aspect-ratio presets (1:1, 9:16, 16:9) | | ✅ | |
| Text / annotation layers | | | ✅ |
| Multi-device scenes | | | ✅ |
| Cursor track + auto-zoom | | | ✅ |
| Click highlight effects | | | ✅ |
| ProRes 4444 export | | | ✅ |
| GIF export | | | ✅ |

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite + TypeScript | Fast HMR; TS is load-bearing for the timeline/scene types |
| UI | React 19 | Required by R3F v9 |
| 3D | Three.js + @react-three/fiber + @react-three/drei | drei saves weeks on `Environment`, `ContactShadows`, controls |
| State | Zustand | Works with R3F without re-render storms; supports transient updates |
| Easing | `bezier-easing` | CSS-compatible cubic-bezier curves |
| Demux | `mp4box.js` | Browsers can't demux MP4 for WebCodecs; this is the standard answer |
| Mux | `webm-muxer`, `mp4-muxer` | Produce playable containers from `VideoEncoder` output |
| Zip | `fflate` | PNG sequence fallback export |
| Model compression | Draco (via `GLTFLoader` + `DRACOLoader`) | Device GLBs are 5–20MB uncompressed |
| Optional | `ffmpeg.wasm` | Only for ProRes / GIF; slow, lazy-load it |

**Explicitly rejected:**
- `MediaRecorder` for export — realtime-only, drops frames under load, no alpha, no control over bitrate or keyframe interval. It is the wrong tool and it will look like it.
- `CCapture.js` — abandoned, wraps `MediaRecorder` or produces huge intermediate files.
- WebGPU renderer — better long-term, but drei and the ecosystem still assume WebGL. Revisit at v3.

---

## 4. System architecture

```
┌─────────────────────────────────────────────────┐
│  UI Layer (React)                               │
│  inspector · device picker · timeline · export  │
└──────────────────┬──────────────────────────────┘
                   │ reads/writes
┌──────────────────▼──────────────────────────────┐
│  Project Store (Zustand)                        │
│  serialisable document — the source of truth    │
└──────────────────┬──────────────────────────────┘
                   │ sampleTimeline(project, t)
┌──────────────────▼──────────────────────────────┐
│  Scene State  (plain object, no React)          │
│  camera pose · device transform · material vals │
└──────────────────┬──────────────────────────────┘
        ┌──────────┴──────────┐
┌───────▼────────┐   ┌────────▼─────────┐
│ Preview Renderer│   │ Export Renderer  │
│ rAF-driven      │   │ clock-driven     │
│ canvas in DOM   │   │ offscreen, any px│
└─────────────────┘   └──────────────────┘
```

Both renderers consume the **same** `SceneState` from the **same** `sampleTimeline` function. The only difference is what drives `t` and where pixels go. If you find yourself writing export-specific animation logic, stop — the abstraction has broken.

---

## 5. Data model

The project document. Everything in it is JSON-serialisable; no `THREE.*` objects, no functions.

```ts
type Project = {
  version: 1
  duration: number            // seconds
  fps: 30 | 60
  output: { width: number; height: number }

  device: {
    id: string                // "iphone-15-pro"
    colorway: string          // "natural-titanium"
    screen: MediaRef | null
  }

  background:
    | { type: 'transparent' }
    | { type: 'solid'; color: string }
    | { type: 'gradient'; from: string; to: string; angle: number }
    | { type: 'image'; ref: MediaRef; fit: 'cover' | 'contain' }

  environment: {
    hdri: string              // "studio" | "city" | custom asset id
    intensity: number
    rotation: number          // radians, y-axis
    shadowOpacity: number
    shadowBlur: number
  }

  camera: {
    fov: number
    tracks: TrackSet          // position, target
  }

  deviceTransform: TrackSet   // position, rotation, scale

  layers: Layer[]             // v3: text, annotations
}

type MediaRef = {
  id: string
  kind: 'image' | 'video'
  width: number
  height: number
  duration?: number           // video only
  // blob lives in IndexedDB / OPFS, not in the JSON
}

type TrackSet = Record<string, Track>   // e.g. "rotation.y"

type Track = {
  keys: Keyframe[]            // sorted by t
}

type Keyframe = {
  t: number                   // seconds
  v: number
  ease: [number, number, number, number]   // cubic-bezier control points
}
```

**Media storage:** blobs go in **OPFS** (Origin Private File System) keyed by `MediaRef.id`, not in the project JSON and not in `localStorage`. A 30-second 4K screen recording is 100MB+; base64 in JSON will crash the tab.

**Save format:** `.mockup` = a zip containing `project.json` plus a `media/` folder. Use `fflate`.

---

## 6. Rendering specification

### 6.1 Color management

This is where most self-built mockup tools look wrong and the builder can't say why.

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
```

But: **the screen content must bypass tone mapping.** ACES desaturates and rolls off highlights, which is right for the aluminium body and wrong for a UI screenshot — it will make your app's brand colors look muddy and slightly grey.

- Screen material: `toneMapped: false`
- Every user-supplied texture: `texture.colorSpace = THREE.SRGBColorSpace`
- Data textures (roughness, normal, metalness maps): leave as `NoColorSpace`

### 6.2 Materials

| Part | Material | Key params |
|---|---|---|
| Body (aluminium/titanium) | `MeshPhysicalMaterial` | `metalness 0.9`, `roughness 0.25–0.35`, `envMapIntensity 1.1` |
| Body (matte glass back) | `MeshPhysicalMaterial` | `metalness 0.1`, `roughness 0.45`, `clearcoat 0.6` |
| Screen | `MeshBasicMaterial` | `map`, `toneMapped false` |
| Screen glass | `MeshPhysicalMaterial` | `transparent`, `opacity 0.10–0.15`, `roughness 0.05`, `envMapIntensity 1.6` |
| Camera lenses | `MeshPhysicalMaterial` | `roughness 0.02`, `metalness 0.5`, dark tint |

The glass layer is 3% of the code and a disproportionate share of the perceived quality. Keep it.

### 6.3 Lighting

Image-based lighting only. **Do not** add point lights or directional lights for illumination — an HDRI plus correct materials beats hand-placed lights every time, and hand-placed lights are what make renders read as amateur.

- `scene.environment` = HDRI (equirectangular `.hdr` or `.exr`, or drei preset)
- `scene.background` = `null` — background is a CSS/compositing layer, never scene geometry, or you lose alpha export
- One `DirectionalLight` **for shadow casting only**: `intensity: 0`, `castShadow: true`

Environment rotation should be user-exposed (`environment.rotation`) — rotating the HDRI moves the specular highlight along the device edge, which is the single most effective "make it look good" control you can give someone.

### 6.4 Shadows

`ContactShadows` and `AccumulativeShadows` from drei are **preview-only** — they bake, and they don't respond correctly to an animated device.

Production approach:
- Shadow-catcher plane below the device with `THREE.ShadowMaterial` (`transparent: true`, `opacity` from `environment.shadowOpacity`)
- `renderer.shadowMap.type = THREE.VSMShadowMap` for soft edges
- Shadow map 2048², `light.shadow.radius` mapped to `environment.shadowBlur`
- `ShadowMaterial` composites correctly onto `clearAlpha = 0`, so shadows survive transparent export

### 6.5 Anti-aliasing

MSAA (`antialias: true`) is fine for preview. For export, render at 2× target resolution and downsample — you get better edge quality on the device silhouette than MSAA gives, and the silhouette is what people notice.

---

## 7. Device asset pipeline

### 7.1 Manifest

Every device is a GLB plus a JSON descriptor:

```ts
type DeviceManifest = {
  id: string
  name: string
  category: 'phone' | 'tablet' | 'laptop' | 'desktop' | 'watch' | 'browser'
  glb: string                     // /devices/iphone-15-pro.glb
  screenMeshName: string          // "Screen" — must be exact
  screenAspect: number            // 19.5/9
  screenCornerRadius: number      // for masking the texture
  defaultCamera: { position: [number, number, number]; fov: number }
  colorways: {
    id: string
    name: string
    swatch: string                // hex, for the UI
    materials: Record<string, { color?: string; roughness?: number; metalness?: number }>
  }[]
}
```

### 7.2 GLB requirements

Enforce these on every model or the loader code becomes a pile of special cases:

- Screen is a **separate mesh**, named exactly per the manifest
- Screen mesh UVs: full 0–1 range, unrotated, origin bottom-left
- Model centred at origin, +Y up, screen facing +Z
- Scale: 1 unit = 10cm (an iPhone is ~1.47 units tall)
- Body materials named consistently (`Body`, `Frame`, `Lens`) so colorway overrides are generic
- Draco-compressed, target under 3MB

### 7.3 Sourcing

| Source | License | Notes |
|---|---|---|
| Sketchfab (CC0 filter) | CC0 | Quality varies wildly; check topology and UVs before committing |
| Poly Haven | CC0 | HDRIs only, but the best free HDRIs available |
| Blender + your own modelling | yours | A phone is 2–3 hours once you know Blender; a laptop is a day |
| Procedural (extruded rounded rect) | n/a | Genuinely fine for phones and tablets. Not for laptops. |

**Legal note:** Apple device designs are protected trade dress. For a personal tool this is irrelevant. If you ever distribute it, don't ship Apple-branded models or use "iPhone" in marketing copy — this is why several mockup tools ship "generic modern smartphone" as the label.

---

## 8. Animation system

### 8.1 Evaluation

One pure function, no side effects:

```ts
function sampleTimeline(project: Project, t: number): SceneState
```

Per track: binary-search the keyframes for the surrounding pair, normalise `t` between them, apply the cubic-bezier easing, lerp. Before the first key or after the last, hold the boundary value.

Rotations interpolate as **Euler angles per-axis**, not quaternions — users expect "rotate 720° on Y" to mean two full spins, and slerp will silently take the short path and give them zero.

### 8.2 Motion presets

Presets are just keyframe generators. `applyPreset(project, 'spin-360')` writes keys into the track set — they are not a separate runtime path. This keeps one code path and lets users edit any preset afterwards.

Ship at minimum: `float`, `spin-y-360`, `tilt-in`, `slide-in-left`, `hero-reveal`, `orbit`.

### 8.3 Screen video sync

Screen video time is **derived from timeline time**, never independently played:

```ts
const screenTime = clamp(t - clipOffset, 0, clipDuration)
```

In preview, this maps to `videoEl.currentTime` (accepting some slop). In export, it maps to a decoded frame index (exact). Same expression, two implementations.

---

## 9. Export pipeline

### 9.1 Still image

```
setClearAlpha(background.type === 'transparent' ? 0 : 1)
resize renderer to output.width × output.height × 2
sampleTimeline(project, currentTime) → apply to scene
render()
canvas.toBlob('image/png')
downsample if supersampled
```

Requires `preserveDrawingBuffer: true` on the WebGL context, or `toBlob` returns a blank image on some drivers. Set it at context creation; it cannot be changed later.

### 9.2 Video — the pipeline in full

```
                 ┌──────────────┐
  user's .mp4 ──▶│  mp4box.js   │ demux → EncodedVideoChunk[]
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │ VideoDecoder │ → VideoFrame (with timestamp)
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │ OffscreenCanvas ──▶ CanvasTexture ──▶ screen mesh
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │  Three.js    │ render at output resolution
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │ VideoEncoder │ → EncodedVideoChunk
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │ webm-muxer   │ → Blob
                 └──────────────┘
```

**Export loop, non-realtime:**

```ts
const frameCount = Math.round(project.duration * project.fps)

for (let i = 0; i < frameCount; i++) {
  const t = i / project.fps

  // 1. pull the decoded video frame nearest to t
  const frame = await frameSource.frameAt(t)
  ctx.drawImage(frame, 0, 0)
  frame.close()                       // MANDATORY — see traps
  screenTexture.needsUpdate = true

  // 2. deterministic scene state
  applySceneState(sampleTimeline(project, t))

  // 3. render
  renderer.render(scene, camera)

  // 4. encode
  const vf = new VideoFrame(renderer.domElement, {
    timestamp: Math.round(t * 1_000_000),   // microseconds
    duration: Math.round(1_000_000 / project.fps),
  })
  encoder.encode(vf, { keyFrame: i % (project.fps * 2) === 0 })
  vf.close()

  // 5. backpressure
  if (encoder.encodeQueueSize > 8) await waitForDrain(encoder)

  onProgress(i / frameCount)
}

await encoder.flush()
muxer.finalize()
```

### 9.3 Codec / container matrix

| Target | Codec string | Container | Alpha | Notes |
|---|---|---|---|---|
| Web, transparent | `vp09.00.10.08` + `alpha: 'keep'` | WebM | ✅ | Chromium only; **feature-detect** |
| Web, opaque | `vp09.00.10.08` or `avc1.640028` | WebM / MP4 | ❌ | Widest playback support |
| Social / general | `avc1.640028` | MP4 | ❌ | Safest deliverable |
| Editing software | ProRes 4444 | MOV | ✅ | `ffmpeg.wasm` only; very slow |
| Guaranteed fallback | PNG sequence | ZIP | ✅ | Always works; user runs ffmpeg |

**Always feature-detect before configuring:**

```ts
const support = await VideoEncoder.isConfigSupported({
  codec: 'vp09.00.10.08',
  width, height,
  bitrate: 20_000_000,
  framerate: fps,
  alpha: 'keep',
})
if (!support.supported) fallbackToPngSequence()
```

Alpha encode support is genuinely inconsistent across browsers and versions. Build the PNG-sequence path **first** — it is 30 lines, it never breaks, and it means the export feature is never fully blocked on a browser bug.

### 9.4 Bitrate guidance

`bitrate ≈ width × height × fps × 0.12`, clamped to 8–40 Mbps. Device mockups are mostly flat gradients with one high-detail region, so they compress well; erring high costs little.

---

## 10. Performance targets

| Metric | Target |
|---|---|
| Preview framerate | 60fps at 1080p canvas |
| Time to first render | < 1.5s (device GLB + HDRI loaded) |
| Device switch | < 400ms (preload adjacent manifests) |
| Export throughput | ≥ 8 frames/sec at 1080p30 |
| Peak memory during export | < 2GB |

**Preview optimisations:** `dpr={[1, 2]}`, drop to `dpr 1` while orbiting, half-resolution HDRI for preview and full for export, `frameloop="demand"` when the timeline is paused.

---

## 11. Browser requirements

| API | Used for | Fallback |
|---|---|---|
| WebGL2 | Everything | None — hard requirement |
| WebCodecs | Video decode/encode | PNG sequence + `<video>` preview |
| OPFS | Media storage | IndexedDB blobs |
| `OffscreenCanvas` | Frame staging | Regular canvas |
| `requestVideoFrameCallback` | Preview video sync | `timeupdate` (worse) |

Realistically: **Chromium-only for video export.** Say so in the UI rather than letting Safari users hit a wall at the last step.

---

## 12. Project structure

```
src/
  app/                 shell, layout, keyboard shortcuts
  store/
    project.ts         Zustand store, undo/redo
    schema.ts          types + zod validation + migrations
  scene/
    Stage.tsx          <Canvas> and scene root
    Device.tsx         GLB loader, screen material binding
    Backdrop.tsx       background compositing
    ShadowCatcher.tsx
    materials/
  timeline/
    sample.ts          sampleTimeline — pure, heavily unit-tested
    easing.ts
    presets.ts
  media/
    storage.ts         OPFS wrapper
    decode.ts          mp4box + VideoDecoder → frameAt(t)
    imageTexture.ts
  export/
    still.ts
    sequence.ts        PNG sequence + zip
    video.ts           encode + mux
    renderer.ts        offscreen renderer, shared with preview
  devices/
    manifests/*.json
  ui/
    Inspector/ Timeline/ DevicePicker/ ExportDialog/
public/
  devices/*.glb
  hdri/*.hdr
```

`timeline/sample.ts` is the one file that deserves real unit tests. If it's correct, preview and export agree. If it isn't, you'll spend days on "the export doesn't match the preview."

---

## 13. Build milestones

| # | Milestone | Deliverable | Rough effort |
|---|---|---|---|
| M0 | Scene foundation | R3F canvas, HDRI, orbit, procedural phone | 1 day |
| M1 | Screen content | Drop image, aspect-fit, corner mask | 1 day |
| M2 | Look development | Materials, glass, shadow catcher, backgrounds | 2 days |
| M3 | **PNG export** | Alpha PNG at arbitrary resolution | 1 day |
| M4 | Device system | Manifest schema, GLB loader, 3 devices, colorways | 3–4 days |
| M5 | Project store | Zustand, schema, save/load, undo | 2 days |
| M6 | Timeline | Keyframes, easing, scrubber UI, presets | 4–5 days |
| M7 | Video in | mp4box + VideoDecoder → texture, preview sync | 3–4 days |
| M8 | **PNG sequence export** | Deterministic loop, zip | 2 days |
| M9 | Video export | VideoEncoder + muxer, alpha, progress, cancel | 4–5 days |
| M10 | Polish | Presets, shortcuts, aspect presets, empty states | ongoing |

**M3 is a shippable tool.** M8 is a shippable video tool (users run one ffmpeg command). M9 is convenience. Sequence them in that order so you always have something that works.

---

## 14. Known traps

1. **`VideoFrame.close()`** — WebCodecs frames hold GPU memory that GC does not reclaim. Miss one `close()` in the export loop and the tab dies around frame 300. Every `VideoFrame` and every `EncodedVideoChunk` you construct must be explicitly closed.

2. **`preserveDrawingBuffer`** — must be set at context creation. Forgetting it produces a blank PNG *only on some GPUs*, which makes it a nightmare to debug remotely.

3. **Texture color space** — `SRGBColorSpace` on every user texture. Symptom: washed-out, slightly milky screenshots. Silent, no error.

4. **Tone mapping on screen content** — `toneMapped: false` on the screen material. Symptom: brand colors subtly wrong. Users notice; they just can't articulate it.

5. **rAF-driven animation** — if any animation reads frame delta, export output will be non-deterministic and won't match preview. Everything reads `t`.

6. **Encoder backpressure** — encoding is async and slower than rendering. Without an `encodeQueueSize` check you'll queue thousands of frames and OOM.

7. **`VideoDecoder` needs a demuxer** — you cannot feed it an MP4 file. `mp4box.js` extracts the samples and the `avcC` description you must pass in `VideoDecoder.configure`.

8. **Non-square pixel / rotation metadata** — phone screen recordings often carry a rotation matrix in the container. mp4box exposes it; honour it or exports come out sideways.

9. **HDRI size** — a 4K `.hdr` is 30MB+ and blocks first render. Ship 1K for preview, load 2K lazily for export.

10. **Zustand + R3F re-renders** — selectors must be narrow. Subscribing a scene component to the whole project object re-renders the tree on every timeline scrub.

11. **Euler vs quaternion** — see §8.1. Silent, and users report it as "my spin animation doesn't do anything."

12. **Screen texture aspect mismatch** — a 16:9 screenshot on a 19.5:9 phone must letterbox or crop, chosen by the user. Stretching by default is the mark of an amateur tool and it's a one-line fix.

---

## 15. Third-party assets

| Asset | Source | License |
|---|---|---|
| HDRIs | polyhaven.com | CC0 |
| Device models | Sketchfab (CC0 filter), or self-modelled | CC0 / yours |
| Fonts (UI) | Fontshare, Google Fonts | OFL |
| Icons | Lucide | ISC |

Audit every downloaded model's license individually. Sketchfab's CC0 filter is reliable, but "free" on other sites frequently means "free for personal use," which matters the moment you put it online.

---

## Appendix: minimum viable scope, restated

If you build only this, you have a tool worth using:

- One procedural phone
- Drop image → aspect-fit onto screen
- HDRI + rotation slider
- Shadow catcher
- Gradient or transparent background
- Six camera angle presets
- PNG export with alpha at 2× resolution

That's M0–M3. Roughly a week of evenings, and it covers about 80% of what anyone actually opens a mockup tool to do.
