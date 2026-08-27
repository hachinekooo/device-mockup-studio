# Context for a new agent

Handoff notes for `mockup-web`. Read `mockup-app-spec.md` for the product
spec and milestones — this file covers what the spec *doesn't* tell you:
current state, decisions that are load-bearing, and traps that cost real
time to find.

---

## What this is

A browser tool that composites screenshots and screen recordings onto 3D
device models and exports them as images, PNG sequences or video. Feature
target: Rotato.

Vite + React 19 + Three.js via `@react-three/fiber` + Zustand. Tests are
vitest (`npm test`), 163 passing. `npm run build` typechecks and builds;
`npm run lint` is oxlint and should report **0 errors** (warnings are
pre-existing and fine).

## Where the project stands

| Spec milestone | State |
|---|---|
| M0 Scene foundation | done |
| M1 Screen content | done |
| M2 Look development | done |
| M3 **PNG export** | done — the spec's "shippable tool" line |
| M4 Device system | done (manifests, colorways, **four** GLBs) |
| M5 Project store | done (OPFS, `.mockup` save/load, undo/redo) |
| M6 Timeline | **display only** — keyframes render, nothing is draggable |
| M7 Video in | done (screen recordings play on the device) |
| M8 PNG sequence export | done |
| M9 Video export | done (WebM/MP4; alpha feature-detected and absent today) |

Beyond the spec: a Rotato-style 4-zone UI and a **multi-device scene model**
with a showcase template library.

Not built, and visible as placeholder text in the inspector: Labels
(text/annotation layers) and Effects (depth of field, motion blur).

---

## Architecture: the parts that matter

### Everything flows through `sampleTimeline`

`src/timeline/sample.ts` holds `sampleTimeline(project, t) -> SceneState`.
It is pure: no frame delta, no wall clock, no reads of live scene objects.
Preview and export must both consume it; the only difference between them is
what drives `t`. If you find yourself writing export-specific animation
logic, the abstraction has broken (spec §4).

`src/scene/SceneDriver.tsx` is the **only** place scene objects are written
per frame. It uses `delta` solely to advance the playhead — to choose *which*
`t` to ask for — never to compute a pose. It reads the store via
`getState()` rather than a hook, so it never re-renders.

### One frame loop, three exports

`export/frameRenderer.ts` owns setup, capture, downsample, backdrop
composite and restore. A still runs it once; a PNG sequence and a video run
it hundreds of times. There is no second render path anywhere — if you find
yourself writing one, that is the broken abstraction the spec names (§4).

The loop needs two things React cannot hand it, because it runs with R3F's
loop stopped and outside the tree:

- `applyAt(t)` — poses the whole scene. `SceneDriver` publishes it (it owns
  the device refs) and both it and the export call the same
  `applySceneState(sampleTimeline(project, t), …)`.
- `seekScreenVideos(t)` — seeks every screen recording exactly, awaited.

The intermediate canvases are allocated once per export, not per frame: at
4x on a 1080p export each is 32MB, which is how a long export walks into the
2GB memory target.

### A single-keyframe track is a static value

Deliberate and load-bearing. `{ keys: [oneKey] }` means "a number in the
inspector"; two or more keys means "animated". Same data structure, so the
animate toggle only has to add a second key — no migration between two
representations, and the inspector and timeline read the same tracks with no
code connecting them.

Rotations are per-axis Euler scalars, never quaternions. Slerp takes the
short path, so a 720° spin silently becomes no spin (spec §14.11). Tested.

### Scenes are always a list of devices

`project.devices: DeviceInstance[]`. A single phone is the one-element case.
Each instance owns its screen, transform, colorway and orientation.
`store.activeDevice` is transient UI state (which one the inspector edits),
not part of the document.

`migrate()` in `src/store/persist.ts` folds pre-multi-device files (a single
`device` plus a separate `deviceTransform`) into a one-element list. It runs
on **every** load, not only on version mismatch, so files written by
half-finished builds still open.

### Templates are data

`src/timeline/templates.ts`. A template is poses + camera + backdrop +
shadow. Poses are expressed as each device's own transform with the camera
left head-on — that is what makes multi-device arrangements composable
rather than special cases. Motion presets compose *onto* a template's pose
rather than replacing it, so a float doesn't collapse an arrangement onto
the origin.

Angle convention, screen facing +Z, camera on +Z:
- `rotation.y > 0` reveals the phone's **left** side
- `rotation.z < 0` leans it **clockwise** on screen
- `rotation.x > 0` tips the top away

### A template is a starting point, not a fixed arrangement

`TransformSection` edits position, rotation and scale for whichever device
the Devices list has selected — **the same channels a template writes**. So
picking a template and hand-arranging are one operation on one set of tracks;
there is no "custom" mode to fall out of, and no reconciliation to do. Pick
the nearest template, then slide devices until they sit right.

The consequence to remember: **applying a template overwrites manual
placement**, because it rewrites every device's transform. Arrange after
choosing, not before. A test pins this.

Two things that look like bugs and are not:

- Nudging a device never starts an animation. `setValueAt` replaces while a
  track has `keys.length <= 1`, so a static channel stays static however far
  the playhead has been scrubbed; only the animate toggle adds the second key.
  (This was asserted backwards first — the code was right.)
- Device *rotation* used to live under the Camera heading, which read as a
  camera control. It now sits with position and scale in the Device section.
  The Camera section's Pos x/y/z is still the camera.

---

## Traps that cost real time

All fixed. Recorded because each was invisible until measured, and each
could easily be reintroduced.

### 1. The GLB screen mesh runs *under* the bezel

In `iphone-17-pro.glb`, the `Screen` mesh is a full rounded rect sharing its
**exact** outer bbox with a separate `Screen_Rim` bezel that covers the outer
~3% on every side. Mapping a screenshot across UV 0–1 buries 6.5% of its
width and 3.1% of its height — the image reads as zoomed in, and anything
pinned to an edge (a status bar clock, a right-hand carousel) is eaten.

`screenVisibleFraction` in the manifest insets the texture onto the rim's
inner opening. Mesh bbox aspect is 0.479; the visible opening is 0.4624,
matching Apple's published 0.460 to within 0.5%.

Use `node scripts/measure-device.mjs <file.glb>` for new devices. Decodes
Draco automatically, prints paste-ready manifest numbers. **It measures the
side bezels and assumes uniform thickness** — measuring top/bottom directly
catches the Dynamic Island and reports ~13% hidden instead of 3%.

Not every model has a bezel over its screen. The three added later do not:
their screen mesh IS the display, so they run `screenVisibleFraction: [1, 1]`.
See trap 9 for the rest of the device-adding workflow.

### 2. The inset must scale with the fit

`composeInset()` in `screenFit.ts`. The inset term depends on the fit's own
repeat: `t = u * (r/vis) + (o - (1-vis)/2 * r/vis)`. Dropping the `r` from
that second term is correct **only when `r` is 1** — a natively sized
screenshot — and silently mis-centres every cropped or letterboxed image.
It shipped broken for exactly that reason. Tested with a 16:9 image, the
only case that exposes it.

### 3. Colorways must clone materials before writing

A GLTF's materials are shared across every clone of the scene *and* cached
by the loader. Mutating in place repaints other instances and leaks into the
next mount. `applyColorway` clones; a test asserts the shared source
material stays untouched.

### 4. Screen letterboxing needs a shader

`MeshBasicMaterial` cannot letterbox. `repeat > 1` samples outside the image
and every wrap mode is wrong there — ClampToEdge smears the edge pixel into
a streak, Repeat tiles the UI. There is no border colour in WebGL, so
`createScreenShaderMaterial` paints black outside 0–1 in the fragment
shader. Keeps `#include <colorspace_fragment>` for consistency, and is
deliberately unlit (screen content bypasses ACES, spec §6.1).

### 5. Export sharpness: three compounding losses

Symptom: "screenshots are clearer going in than coming out."

- **The downsample was destroying the render.** One `drawImage` collapsing
  4× uses a fixed small kernel and aliases badly. Measured against an exact
  box average of the supersampled buffer (the correct answer for SSAA):
  one-shot = **12.22 RMS error**, stepped halving = **0.13**. ~98× closer.
  `imageSmoothingQuality: 'high'` made **no** measurable difference on
  Chromium — the stepping does the work.
  **Superseded — see trap 8. The stepping was only ever measured at 4×, and
  it is badly wrong at the 3× default.**
- **The screenshot was sampled below its own resolution.** At 2× on a
  1350×1600 export, a 1206×2622 screenshot lands on ~800×1900 render pixels,
  so it is minified and sampled from a half-resolution mip. Default is now 3×.
- **No anisotropy anywhere.** Both texture sites were bare
  `TextureLoader().load()`. Now hardware max in `materials/screenTexture.ts`.

Physical limit: in a Duo template the screen fills ~60% of frame height, so
**a 2622px screenshot needs a ~4400px-tall export** to appear at true 1:1.
Below that it is scaled down and no filtering recovers it.

### 6. Export tearing: the R3F loop keeps running

`toBlob` read the drawing buffer **asynchronously**. With R3F's default
`frameloop: 'always'`, its rAF fired during the readback, `SceneDriver`
writes new poses, and R3F renders another frame into the same canvas — you
capture a torn composite of two frames.

`exportStillPng` takes a **required** `setFrameloop` and pauses the loop,
restoring in a `finally` so a failed export can't leave the preview frozen
at export resolution with a dead loop. Required, not optional, because
forgetting it produces a torn image only *sometimes*.

This race predates the supersampling change — 2× was just fast enough to
usually win it.

The capture is a synchronous `drawImage` off the WebGL canvas now (trap 8),
which removes the async readback entirely. **`setFrameloop` is still
required**: the resize → render pair must run uninterrupted, or the export
renders at the wrong size or with a pose from the wrong `t`.

### 7. `aspect-ratio` does not size a box

`aspect-ratio` plus `max-width`/`max-height` does **not** letterbox a
container: with a definite width the ratio loses to the max-height clamp.
Container query units express it correctly but resolve over two layout
passes, so the box is 0×0 on the first — and **R3F measures its container
once, on mount**, latched onto that zero, and never created a renderer at all.

`Artboard.tsx` takes the first measurement synchronously in a layout effect
and uses ResizeObserver only for later changes. Do not seed from the
observer: RO callbacks are delivered during the rendering step, which
browsers skip entirely for hidden tabs.

---

### 8. Export sharpness, part two: the stepped downsample, and arithmetic

Same symptom as trap 5, reported again after those fixes landed. Two causes,
both measured.

**a. The stepped downsample is broken at 3× — the default tier.** Trap 5
recorded stepped halving at 0.13 RMS, but that was only ever measured at 4×,
where every step is an exact halving. At 3× the chain runs 3 → 1.5 → 1: two
bilinear resamples at non-integer ratios, the second refiltering the output
of the first. Measured in Chromium against an exact box average:

| supersample | RMS vs. box | edge detail lost |
|---|---|---|
| 2× | 0.36 | 0.8% |
| **3× (default)** | **27.67** | **11.8%** |
| 4× | 0.37 | 0.6% |

The tier that exists to keep screenshots sharp was the one the resampler
handled worst, and the original measurement missed it by testing only 4×.
`boxDownsample` in `export/downsample.ts` now does an exact integer box
average, which is correct at every factor. It runs banded — one strip at a
time — because a whole-image `ImageData` at 4× on a 1920×1080 export is
320MB. A test asserts rows are independent, which is what makes banding
sound; a browser probe confirmed the banded result is **byte-identical** to
the unbanded one.

The capture is also now a synchronous `drawImage` off the WebGL canvas
instead of `toBlob`, which drops a full-resolution PNG encode/decode and
closes most of the tearing window from trap 6 (the frameloop pause is still
required — the resize/render pair must not be interrupted).

**b. The output canvas, not the filtering.** With the filtering losses gone,
what remains is arithmetic and no setting can fix it. A phone fills ~80% of
frame height, so at the default **1920×1080 a 2622px screenshot is
reproduced on about 860 pixels** — two thirds of its rows discarded before
any filter runs. Supersampling fixes how the screen is *sampled*; it cannot
put pixels into an output that has none.

Nothing in the UI said so. `export/screenCoverage.ts` measures it from the
live scene — it projects the screen mesh's uv.y axis through the camera and
divides by the texture rows mapped across it, so it stays correct under
bezel inset, crop and letterbox — and the export panel now states it in
pixels with a one-click resize to reach 1:1. **If someone reports soft
exports again, read that number first.**

### 9. Adding a device: address the screen by MATERIAL, never mesh name

Adding the 17 Pro Max, Pixel 9 Pro XL and Galaxy S26 Ultra surfaced four
things, all of which would silently reappear on the next model.

**a. Mesh names are not stable identifiers.** GLTFLoader sanitises them and
de-duplicates against a counter shared with nodes: dots are stripped, spaces
become underscores, and every primitive after the first takes a `_1`, `_2` …
suffix. Confirmed in the browser with the real loader:

| in the file | loads as |
|---|---|
| `Screen` | `Screen` |
| `Circle.001` (3rd primitive) | `Circle001_2` |
| `iPhone 17 Pro.001` (16th primitive) | `iPhone_17_Pro001_15` |
| `Geometry.004` | `Geometry004` |

Material names are assigned verbatim, no sanitising and no counter
(`GLTFLoader.js`: `if ( materialDef.name ) material.name = materialDef.name`).
So the manifest carries `screenMaterialName` and `findScreenMesh` matches on
it. `applyColorway` skips the screen the same way.

**b. Three of the four models are ONE mesh with 18–19 primitives.** The
measure script used to read `primitives[0]` only, so it saw one primitive in
nineteen and printed "no screen mesh found" — which reads as a broken model
rather than a broken script. It now walks every primitive, in world space
(it also ignored node transforms).

**c. Models disagree about UV rect, v direction AND winding — all three.**
Each is an authoring accident nothing in the file records, and each produces
a different wrong-looking screen:

| model | UV rect | v runs up | faces viewer |
|---|---|---|---|
| iPhone 17 Pro | 0–1 | yes | yes |
| iPhone 17 Pro Max | 0–1 | **no** | **no** |
| Pixel 9 Pro XL | **u[0.27, 0.73]** | **no** | yes |
| Galaxy S26 Ultra | 0–1 | **no** | yes |

- **UV rect** — the Pixel's screen is unwrapped aspect-preserving and centred,
  so a screenshot on raw UVs lands in the middle 46% of the display.
- **v direction** — inverted on all three new models: the screenshot renders
  upside down, every letter mirrored top-to-bottom.
- **winding** — the 17 Pro Max's OLED plane is wound facing INTO the body.
  With the default `FrontSide` material it was culled outright: no screenshot
  at all, the black `Display Frame` visible behind it, and the phone's
  interior through any gap. Making the material `DoubleSide` (which every one
  of these GLBs declares for its own materials anyway) draws it — but as its
  BACK face, i.e. mirrored left-to-right.

`resolveScreenUv` measures all three off the geometry and folds the
corrections into the UV rect as negative spans, so nothing downstream — fit,
bezel inset, letterbox — knows it happened. Measured at runtime rather than
stored as manifest flags on purpose: nobody can check a `flipV: true` field
without looking at the screen, and this is self-correcting for the next model.

The orientation checks run **after** the manifest's corrective rotation but
**not** the landscape turn, since in landscape the screenshot is meant to
rotate with the hardware.

**d. `modelTransform` applies innermost-first** — position, then rotation,
then scale — because a single Object3D applies `T * R * S`, which would mean
hand-pre-rotating every offset. Nested groups in `DeviceInstanceView` let
`position` be exactly the negated bbox centre the script prints. The
landscape turn sits *outside* the recentring group, or it pivots about the
model's authored origin, which for the Pixel is six units away.

Workflow for a new model:

```
DEVICE_HEIGHT_MM=163.4 node scripts/measure-device.mjs public/devices/x.glb
```

It prints a paste-ready manifest block. Two things it guesses and you should
check: the screen primitive (it takes the largest *perfectly flat* one —
tolerance is tight because the 17 Pro Max's cover glass is bigger than its
display and only 0.55% of body height deep) and the bezel (it compares
leading edges, not bbox centres — a bezel is a shell whose centre sits behind
the flat screen while its front face still covers it). Pass the screen's
material name as a second argument to override.

Compress before committing — these models are texture-heavy, not
geometry-heavy. `webp --lossless` then `draco` took the three from 42MB to
27MB with no quality change; Draco alone saved almost nothing. Re-run the
measure script afterwards: quantisation moved every number by under 0.006%,
but confirm rather than assume.

### 10. Screen orientation is three independent authoring accidents

Symptom: "the 17 Pro Max renders no screenshot at all and I can see the
insides; the Pixel and Samsung are inverted."

Covered in trap 9c — UV rect, v direction and winding all vary per model, all
three were wrong on the new devices, and all three are now measured off the
geometry by `resolveScreenUv`. Recorded separately because of *how* it was
found: every one of these had passed the numeric checks. The screen mesh was
located, its aspect matched the published spec to 0.04%, the device was
centred and facing +Z at the right physical size — and it still looked wrong
in three different ways.

**Render it and look.** See the Verification section: WebGL works in a hidden
tab. A test screenshot with `TOP`/`BOTTOM`, an up arrow and four distinctly
coloured corners tells you instantly which of the three is wrong:

- corners swap top-for-bottom, left-right intact -> v is inverted
- corners swap left-for-right, top-bottom intact -> winding is reversed
- image squeezed into a central strip -> UV rect is not 0-1
- flat dark panel where the screen should be -> the plane is being culled

### 11. The shadow catcher was fixed at a height only one phone cleared

Symptom: "a line that cuts through at the base of the phone; it appears on
all devices, never on the iPhone 17 Pro, and not every time."

`ShadowCatcher` was a 12x12 plane hardcoded at `y = -0.76`. That number is
exactly the iPhone 17 Pro's half-height (0.735) plus 25mm of clearance — it
was tuned when that was the only model. Every device added since is 16.3cm
tall, reaching to about -0.815, so the plane sat **55mm inside them**.

The plane is `ShadowMaterial`, i.e. transparent, so it draws in the
transparent pass *after* the opaque body. Wherever it passed in front of the
phone it was drawn over it, and the intersection showed as a hard diagonal
line across the lower screen.

Why "not every time", and never on the 17 Pro: the intersection is a line
across the device's face, and where it lands depends on the pose. Tilted into
the Hero Tilt pose the 17 Pro's lowest corner reaches -0.7645, so the plane
cut it too — but only 4.5mm up, inside the black bottom frame where nothing
shows. On a 16.3cm phone the same plane lands ~9mm up, which is onto the
screen. Templates that lift a device (Duo slot 2 sits at +0.20) clear the
plane entirely, which is why pairing hid it.

`projectGroundY` now derives the height from the devices actually in the
scene: `bodySize` from each manifest, the resolved pose, minus the same 25mm.
Two things it must keep doing:

- **Account for rotation.** Half the height is not enough — every showcase
  template rolls its devices, and a rolled phone drops a corner. The 17 Pro
  Max reaches 0.854 below centre at Hero Tilt against a flat half-height of
  0.817. `verticalHalfExtent` takes the second row of the rotation matrix.
- **Stay static.** It samples across the whole timeline and takes the lowest,
  rather than reading t=0, so an animated float cannot sink into it — and it
  resolves once per document edit, never per frame. A ground sliding under a
  moving phone reads as the camera drifting.

A test asserts the computed height still lands on exactly -0.76 for an
upright iPhone 17 Pro, so that device's shadow did not move.

### 12. The background was a CSS layer that never reached the export

Symptom: "my exported render came back black."

`Backdrop.tsx` paints the background *behind* the canvas, deliberately, so
alpha export keeps working (§6.3). But `exportStillPng` read only the WebGL
canvas and cleared with `setClearAlpha(transparent ? 0 : 1)` — and clearing
to alpha 1 means clearing to three's default **black**. Nothing composited
the two, so every non-transparent export came out black whatever gradient or
image was set.

Fixed in the export, not in the scene: the render now always clears to
transparent and `export/backdrop.ts` paints the backdrop under it on the
output canvas. `loadBackdrop` resolves the async part — an image decode —
once and hands back a *synchronous* painter, because the video frame loop
calls it hundreds of times and must not await.

Two things there are easy to get wrong and are pinned by tests:

- **CSS gradient angles are not canvas angles**, twice over: CSS 0deg means
  "to top" while the canvas y axis points down, and the gradient line is
  longer than the box off-axis (sized so the corner tangents touch its ends).
  Miss the first and every default gradient exports upside down; miss the
  second and the corners stop short of the end colour.
- **Order.** Backdrop first, render over it. `destination-over` gives the
  same picture on a hard silhouette but not through a soft shadow, whose
  alpha is exactly what lets the background show through.

### 13. Video export: what is real, and what this browser will not do

All three of these were measured in Chrome 151, not assumed.

**a. Alpha encode is unavailable, for every codec.** `isConfigSupported`
with `alpha: 'keep'` returns `supported: false` for `vp09.00.10.08`, `vp8`
*and* `av01.0.04M.08`. The spec warned this varies by browser and version; it
turns out the answer today is "no" across the board. `supportedVideoFormats`
is what keeps that from becoming a failed export — an unsupported config
throws at `configure()`, i.e. after the user has committed.

**b. Encoded dimensions must be even.** H.264 4:2:0 cannot represent an odd
dimension. `evenSize` rounds *down*, so the export never exceeds the size the
user asked for.

**c. The export is byte-deterministic.** The same project exported twice
produced identical file sizes (22,414 bytes WebM; 34,272 MP4) across separate
runs. That is the pure-function-of-time rule (§4, §14 trap 5) showing up as a
measurable property rather than an aspiration — worth re-checking if anything
in the frame loop ever starts reading a clock.

The pipeline was exercised end to end by hand (see Verification): both
containers were produced, structurally parsed (`ftyp moov mdat`, with `moov`
first from `fastStart`) and decoded by a real `<video>` element at
320x240 — 0.97s WebM, 1.0s MP4.

### 14. The reused capture canvas accumulated every frame

Symptom, reported off a 360° spin: "it's leaving stuff I don't understand"
— the phone's body fringed with a fan of thin repeated edges, like motion
blur that never resolves.

Every pose the device had already passed through was still in the frame.
`beginFrameExport` allocates its capture canvas **once** and reuses it for
the whole clip — deliberately, because at 4x on a 1080p export it is 32MB
and reallocating per frame is how an export blows the memory target. But the
capture was a plain `drawImage`, which composites **source-over**, and the
render is transparent everywhere the device is not. So each frame was drawn
*on top of* its predecessors and the silhouettes stacked up.

`capturedCtx.globalCompositeOperation = 'copy'` replaces the destination
outright — correct, and cheaper than clearing before every draw. The
composite canvas takes a `clearRect` for the same reason; every backdrop
painter fills the whole rect today, so it is redundant *now* and exists so a
future one that doesn't cannot bring the ghosting back.

Two things worth keeping in mind:

- **A still export could never show this**, because a still allocates the
  canvas and throws it away. Anything that only bites on frame 2+ needs a
  multi-frame check, and the numeric tests all passed throughout.
- **The bug made files smaller.** Accumulating frames differ from each other
  far less than real ones do, so inter-frame compression loved them: the
  same probe clip went 22KB -> 43KB (WebM) and 34KB -> 94KB (MP4) once the
  frames became genuinely independent. A suspiciously small export is a
  symptom, not a win.

`runGhostingProbe()` in `src/devtools/videoProbe.ts` guards it: render an
object, move it out of frame, assert the second frame is empty. Validated by
reverting the fix — 2304 ghost pixels with it removed, 0 with it in place. A
probe that has never been seen to fail is not evidence of anything.

### 15. A hidden tab throttles media loading, not just rAF

A `<video>` in a hidden tab sits at `readyState 0`, `networkState 2`
(loading) forever if the element is detached or left at default preload. The
first decode check reported "timeout" for both containers and looked exactly
like the muxer had written a broken file.

It had not. `preload = 'auto'`, appending the element to the document and
calling `load()` makes metadata arrive normally. This is the same species as
the rAF limitation below: **the tab denies you the loop and the lazy paths,
not the capability.**

The consequence for M7: the *preview* of a screen recording is the one part
of this work an agent cannot observe, because it depends on both R3F
mounting and media playback. Its arithmetic is unit-tested and its export
path is verified; the moving picture is not.

**And it is flaky, not merely slow.** The same `preload='auto'` + attach +
`load()` recipe that produced metadata for one probe returned
`readyState 0, networkState 2` — loading, forever — for a later one on a
perfectly valid 119KB file. Anything needing a *decoded frame* (as opposed
to metadata) should be assumed unavailable from automation.

That is what blocked `runEncodeQualityProbe`: measuring how much detail the
H.264 encode discards needs the file decoded back and compared against the
frame that went in, and the decode never happens. The probe is written and
correct; **run it from a visible tab** if you ever need the RMS number.

### 16. The encoder was bitrate-starved, and the quality tier was half a control

The decode-back measurement above was blocked, but the question — is the
encoder starved at the default? — turned out not to need a decode at all.
`runBitrateProbe` encodes the same *moving*, high-detail clip at each tier
and compares bytes against the cap. Measured at 1080p30:

| tier | cap | actual | used |
|---|---|---|---|
| standard | 8.0 Mbps | 9.1 | **1.14** |
| high | 14.9 Mbps | 16.1 | **1.08** |
| max | 29.9 Mbps | 31.7 | **1.06** |

The encoder spends everything it is given at every tier — slightly over, from
container overhead and VBR. It wanted more bits and the cap was the binding
constraint, so raising it buys real detail rather than just a bigger file.
(The clip must MOVE: a static one compresses to nothing and reports "not
starved" whatever the cap.)

Two things came out of that:

- **§9.4's formula lands under its own floor for every export below 4K.**
  1080p30 asks for 7.46 Mbps and gets clamped up to 8. So *every* ordinary
  export was running at the minimum, whatever the user chose.
- **The quality tier only scaled the render.** Someone picking Max got a 4x
  supersampled frame and then watched it squeezed through the same 8 Mbps as
  Standard — the extra detail thrown away at the last step. The tier now
  scales bitrate too (1x/2x/4x, ceiling raised to 80 Mbps), which is what it
  always implied.

Deliberate departure from the spec's numbers, and the justification is the
content: §9.4's coefficient is tuned for general video, and ours is a screen
recording of UI text — the first thing a starved encoder destroys.

### 17. MP4 vanished from the picker at every phone-shaped export size

Symptom: "I exported as PNG sequence and all I still got was the zip."

Not a misread button. `avc1.640028` — the hardcoded codec string — is H.264
High profile at **level 4.0**, which allows 8192 macroblocks per frame,
about 1920x1088. A 1350x1600 portrait canvas is 85x100 = **8500**. So
`isConfigSupported` returned false, MP4 was filtered out of the format list,
and at some sizes the user was left looking at a panel whose only obvious
clip export was the PNG sequence.

Measured across the sizes people actually use, before the fix:

| export | formats offered |
|---|---|
| 1920x1080 | webm, mp4 |
| 1350x1600 | webm only |
| 3000x3600 | webm only |

The app pushed people straight into that range too: the sharpness readout's
"Resize to…" button routinely suggests 3000px+ to reach 1:1. The feature for
fixing soft screens was disabling the format most people want.

`avcCodecString` now picks the lowest level that fits the frame size *and*
the macroblock rate — frame rate matters independently, 1080p60 needs 4.2
where 1080p30 needs 4.0. Verified end to end: real `ftypisom` files now come
out at 1350x1600 and 1080x1920, which produced nothing before.

Above roughly 3000x3600 this machine's encoder still refuses at any level.
That is a hardware limit rather than a bug, so the panel now *says so* and
points at WebM. **Silently dropping an option is the actual defect here** —
the user cannot tell "unsupported" from "broken" when the button is simply
absent.

`probeOneVideo(format, w, h)` in devtools is the cheap check: one format,
one size, 0.2s. `runVideoProbe` does every format plus a PNG sequence and
takes long enough at portrait sizes to time out an automation call.

### 18. The export is sized from the source, not from a preset

The reframing that settles the whole "soft screen" saga: **everything in the
scene except the screenshot is synthetic.** Geometry, shadows, gradient,
HDRI — all render at any resolution with no loss. The screenshot is the one
fixed-resolution asset, so it is the thing that should decide the pixel
count. Picking 1920x1080 from a menu and then being told the screenshot
didn't fit is backwards, and that is what the app did for months.

`matchSource` is **on by default**. `resolveExportSize` grows the export
until the worst-observed screen coverage reaches 1:1; typing a size turns it
off, and there is no separate toggle to discover.

Three things it must keep doing:

- **Scale both axes.** The artboard letterboxes to `output`'s aspect, so
  scaling one axis re-frames the shot. Same framing, more pixels.
- **Never shrink.** An over-served screenshot is not a reason to quietly
  reduce an export the user chose, and the extra pixels still buy edge
  quality on the silhouette.
- **Not write to the document.** `output` is the *composition*; the resolved
  size is derived at export time. Writing it back would put a size change in
  the undo stack on every device nudge.

**Worst case, not current case.** `worstCaseScreenCoverage` sweeps every
device and 96 instants across the clip, because a spin brings the device
closer at some `t` and *that* frame sets the requirement. It is pure maths
off `sampleTimeline` — posing the live scene here would fight `SceneDriver`
and twitch the preview while the panel re-renders. Memoised on the project
and size, since the panel re-renders per keystroke.

**What it can actually reach**, measured, for a 2622px screenshot:

| canvas | 1:1 size | MP | outcome |
|---|---|---|---|
| 9:16 portrait | 1852x3294 | 6.1 | 1:1 on MP4 |
| 3:4 portrait | 2470x3294 | 8.1 | 1:1 on MP4 |
| 16:9 landscape | 5854x3294 | 19.3 | 1:1 on WebM only |
| 16:9 landscape, MP4 | capped 4080x2296 | 9.4 | 70% of source |

The rule is **canvas aspect, not screenshot size**. A landscape frame pays
for wide empty background either side of a tall phone, so it needs three
times the pixels of a portrait frame showing the same device at the same
detail. All four sizes above were confirmed against the real encoder.

### 19. The scene lighting config never ran, so every shadow used three's defaults

Symptom: "the lighting of our scenes is too much, can we get something more
natural?"

`Stage` configures the shadow light in an effect that starts
`const light = lightRef.current; if (!light) return`. The light lives inside
`<Suspense>`, whose fallback is null, so on the first commit the ref was
null and the effect took its early return — and its deps
(`[environment.shadowBlur]`) never changed again, so it never re-ran once
the environment finished loading and the light actually mounted.

Read back off the live scene, the light was running three's **defaults**:

| | code intends | actually was |
|---|---|---|
| shadow map | 2048x2048 | **512x512** |
| VSM radius | `shadowBlur` (2.2) | **1** |
| frustum | +/-1.5 | **+/-5** |

So the contact shadow was a hard, near-black slab with a straight edge where
the shadow map ran out. On a light background it is the first thing you see,
and it is what reads as harsh CGI rather than as a photograph.

Three separate things had to change, and only the first is the bug:

1. **Hold the light in state, not a ref.** A `useState` setter passed as the
   ref callback re-runs the effect on the commit that mounts the light. A
   ref cannot notify.
2. **`shadow.camera.updateProjectionMatrix()`** — it was never called, so
   every frustum value would have been inert even with a mounted light.
3. **`blurSamples` must scale with `radius`.** VSM blurs with a fixed number
   of taps; a large radius over the default 8 bands into rings instead of
   softening.

The defaults then changed to what a product shot actually looks like:
`shadowOpacity` 0.55 -> 0.3, `shadowBlur` 2.2 -> 14 (slider max raised 6 ->
24), and the light moved from `[2, 4, 3]` to `[1.2, 6, 2]` — a low light
throws a long shadow off to one side, which reads as afternoon sun rather
than as an object resting on a surface.

Tone mapping moved with it: **`NeutralToneMapping`, not `ACESFilmic`**. ACES
is a film transform — it crushes shadows, desaturates as it rolls off, and
turns the titanium rail's specular into a blown white streak. Khronos PBR
Neutral exists for product renders: material colour survives, so a colourway
stays the colour of its swatch, and highlights roll off instead of clipping.
Screen content is unaffected either way; it bypasses tone mapping on its own
unlit material (§6.1).

**Changing the HDRI preset blanks the scene while it loads.** `<Environment>`
suspends and the Suspense fallback is null, so every device unmounts for the
duration. Not fixed; noted because it looks like a crash and because it made
an automated lighting sweep silently render empty frames.

## Verification: read this before trusting anything visual

**Throughout this work the browser window was occluded, so every automation
tab reported `visibilityState: hidden`.** That suspends rAF *and*
ResizeObserver delivery, so **R3F never booted** — the app's own canvas
stayed at its default 300x150 and never rendered for the agent.

That is a limit on the *app*, not on the GPU. Read point 2 below before
concluding anything cannot be checked: driving three.js by hand renders
perfectly well in a hidden tab, and that is how the orientation bugs were
found after they had passed every numeric check.

Practically:

- Everything is verified as **data and maths** — resolved poses, texture
  transforms, framing geometry, resampling error — via 137 unit tests and
  live DOM/state probes.
- Pixels are verified by **hand-driven offscreen renders**, not by observing
  the app. Anything that depends on R3F actually mounting — the artboard
  sizing, the preview loop, `window.__mockup` — is still unobserved.

Still true as of the trap 8 work: the canvas element existed but stayed at
its default 300×150, i.e. R3F had not sized it, so nothing rendered.

The trap 8 resampling numbers *are* real browser measurements, obtained by
running the algorithms over a synthetic high-frequency pattern on an
`OffscreenCanvas` in the page — which needs no rAF and no WebGL. What it does
not cover is `drawImage(renderer.domElement)` off a live WebGL canvas, which
remains unverified at runtime.

**THE APP ITSELF CAN NOW BE DRIVEN IN A HIDDEN TAB.** Everything above about
R3F never booting is worked around by two lines in the page, and this is the
single biggest verification unlock in the project:

```js
// 1. rAF is suspended in a hidden tab; a timer is not.
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16)
// 2. ResizeObserver delivery is suspended too, so nudge the measurement.
window.dispatchEvent(new Event('resize'))
```

Within ~2s R3F mounts, the canvas sizes correctly (2312x1300 rather than the
default 300x150), `window.__mockup` appears and the real preview loop runs.
From there the actual app can be driven — store actions, template picks,
device swaps — and `exportStillPng` called against the live context to POST a
PNG to a local sink. That is how the lighting in trap 19 was diagnosed and
fixed: render, look, change, look again.

Two things to know when driving it this way:

- **A bare `three` specifier will not resolve** from a page-context dynamic
  import. Use the numeric constants (`ACESFilmic = 4`, `AgX = 6`,
  `Neutral = 7`) or import a module under `/src/`.
- **Model swaps and HDRI changes need seconds, not milliseconds.** Suspense
  keeps the *old* content on screen while the new one loads, so a shot taken
  too early silently captures the previous device and looks like the change
  did nothing. Assert on the scene (mesh count, `light.shadow.mapSize`), not
  on the store, before believing a render.

**Two further workarounds make a hidden tab far less limiting than it looks**,
and both are worth reaching for before giving up on verification:

1. Anything expressible as canvas 2D or pure maths runs fine in the page.
   That is where the resampling table came from.
2. **WebGL itself works in a hidden tab — only rAF is suspended.** This is
   the big one, and it was missed for far too long. `new WebGLRenderer(...)`
   plus a manual `renderer.render(scene, camera)` renders fine with the tab
   hidden; what a hidden tab denies you is the *loop*, not the GPU. So you
   can build a scene by hand, render it, and look at the result.

   Getting the image out: `toDataURL` comes back **blocked** by a content
   filter (it scans like credential data). Instead `canvas.toBlob` and POST
   it to a tiny local HTTP sink that writes a PNG to disk, then read the file.
   That is how the trap 10 orientation bugs were found and fixed — three
   rounds of render, look, fix. Nothing short of pixels would have caught
   them, and every one had passed the numeric checks.

   Import the loaders through a throwaway module under `src/` (Vite
   transforms it; a bare `three` specifier will not resolve from
   `/node_modules/...` directly). Add `?t=<now>` to dynamic imports after
   editing, or you silently get the previous module.

   The same approach also confirmed, without rendering: loaded mesh names,
   the Pixel's non-0–1 UV rect, and — by rebuilding `DeviceInstanceView`'s
   nesting in a detached `Group` — that each device ends up centred at the
   origin, facing +Z, at its real physical size:

   | device | measured | real |
   |---|---|---|
   | iPhone 17 Pro | 7.2 × 14.7 cm | 71.9 × 149.6 mm |
   | iPhone 17 Pro Max | 7.9 × 16.3 cm | 78.0 × 163.4 mm |
   | Pixel 9 Pro XL | 7.7 × 16.3 cm | 76.6 × 162.8 mm |
   | Galaxy S26 Ultra | 7.8 × 16.3 cm | 77.6 × 162.8 mm |

**Confirmed by the user, in the real app:**

- spin animation and playback, and the export sharpness improvement
- a two-device render with a real screenshot landing the right way up and
  unmirrored on an iPhone 17 Pro Max beside a Pixel 9 Pro XL — which also
  covers a multi-device template pose, colorways rendering their finish, and
  the export path producing a clean untorn frame. Its black background is
  what surfaced the export-background gap.
- the per-device transform controls ("done and works!")
- the shadow-catcher line, reported and then confirmed fixed

**Confirmed as pixels by the agent:** all four devices render a marked test
screenshot identically and correctly via the offscreen render above. That
check is cheap to repeat and worth repeating whenever a device is added.

**Confirmed as real files by the agent:** the whole clip export pipeline.
`src/devtools/videoProbe.ts` builds a renderer, scene and camera by hand and
hands them to the *same* `exportVideo` / `exportPngSequence` the UI calls —
no R3F involved, so it runs in a hidden tab. Run it from the dev server with

```js
const m = await import('/src/devtools/videoProbe.ts?t=' + Date.now())
await m.runVideoProbe(320, 240, 30)
```

It reports which formats the browser will encode, the bytes produced, the
container structure and a real `<video>` decode of each. Keep it: it is the
cheapest way to tell "the encoder is misconfigured" from "this browser said
no", and those look identical from the UI.

**Not visually confirmed for video:** a screen recording playing on a device
in the preview, scrub sync, and what an exported clip actually looks like in
a player. The frame timing, the seek-and-await, the containers and the
decode are all verified; the moving picture is not.

**Not yet visually confirmed:** template poses matching their *reference
images* (they render, but nobody has compared them side by side), Contain vs
Cover letterboxing, and transparent-background export.

With a foreground tab, `window.__mockup` exposes
`{ renderer, scene, camera, setFrameloop }` in dev builds — useful for
driving renders manually and reading back state.

---

## Known gaps

- **Timeline is display-only.** Presets write keyframes and the UI renders
  them, but nothing is draggable and there is no easing editor. Largest
  Rotato gap that isn't video.
- **No alpha video export, and it is not our bug.** Chrome 151 answers
  `supported: false` to `alpha: 'keep'` for VP9, VP8 *and* AV1 — measured, see
  trap 13. The format picker therefore never offers it today. The PNG
  sequence is the only clip export that preserves transparency, which is
  precisely why the spec says build that path first.
- **No trim, no clip offset.** `screenTimeAt` takes an `offset` and nothing
  passes one: a screen recording always starts at timeline 0. Adding a
  per-device `screenOffset` to `DeviceInstance` is the whole change on the
  document side.
- **No audio.** The muxers support an audio track; nothing feeds one. A
  screen recording's audio is silently dropped on export.
- **The video export resizes the visible canvas for its whole duration.**
  Fine for a still, odd to watch for a 10-second clip. Rotato shows a modal
  over it; we show a progress bar beside a live viewport that is briefly the
  wrong size.
- **No viewport gizmo.** Devices are positioned with the numeric fields
  (which scrub on drag), not by dragging the device itself. Whoever builds
  that must write back to the store on release, the way `OrbitControls` does
  for the camera in `Stage.tsx` — `SceneDriver` rewrites every device's pose
  each frame from `sampleTimeline`, so a drag that only mutates the object
  snaps back on the next frame.
- **Labels and Effects are placeholder text** in the inspector.
- **`screenCornerRadius` and `category` are dead manifest fields** — defined,
  never read. Same species as the colorway bug: data with no consumer.
  (`category` is now read by a manifest test, but still not by the app.)
- **The Galaxy S26 Ultra has one placeholder colorway.** Its model is
  texture-driven — nearly every material is white with a baseColor texture —
  so a colour override would tint the texture rather than repaint the finish.
  It ships one "as authored" swatch until someone can look at it.
- **Device GLBs are ~27MB total** and the bulk is 2048² PNG normal maps, now
  lossless WebP. Halving them to 1024² would roughly halve the payload again,
  but that is a visual-quality call nobody has made yet.
- **`pruneUnreferencedMedia` only runs on open.** Drop five screenshots in
  one session and four blobs linger in OPFS.
- **Template numbers are eyeball-calibrated** from reference images. Plain
  data; expect tuning requests.

## Natural scenes (a person holding the device): what it would take

Asked for, not built. Recorded because the answer is counter-intuitive and
because one architectural fact decides it.

**The realistic route is a photo plate, not a 3D person.** What Rotato,
Smartmockups and Placeit ship as "hand holding phone" is a photograph with a
screenshot warped into it. A plate is four things:

- a background **photograph** of a real hand holding a real device
- an **occlusion mask** — a PNG whose alpha is the thumb and fingertips that
  cross in front of the screen
- the screen's **four corners** in that photo
- optionally a **gloss / reflection** overlay

Warp the screenshot into the corners, draw the mask over it. Skin, cloth,
depth of field, contact shadow and grain all come free from the photograph;
none of it is renderer work.

**The fact that decides it:** the background is a CSS layer behind the
canvas and does not reach the export (see Known gaps). Anything scene-like
has to live *in* the render. So a plate cannot be "just set a background
image" — that path is already broken for export.

What it needs here:

1. Move the background into the render. Needed anyway; fixes the export bug.
2. A **projective** warp on the screen shader. The current one is affine
   (`vUv * uRepeat + uOffset`); corner-pinning is a homography, ~15 more
   lines. The alternative — pose a real 3D quad and let the GPU's
   perspective-correct interpolation do it for free — is elegant but four
   corners are far easier to author than a 3D pose.
3. A plate asset type and a layer order: plate -> screen -> mask -> gloss.
   Structurally a sibling of the device manifest: data, not code branches.
4. Corners as tracks like everything else, which is what later makes video
   plates (a person scrolling) possible — gated behind M7/M8/M9.

A rigged 3D hand is the worse trade: the grip does not generalise across
device sizes, convincing skin needs subsurface scattering the IBL+ACES
pipeline does not do, and the result reads as 3D rather than photographic.

Traps to expect, all rhyming with ones already hit:

- **The plate's own resolution is the export ceiling** — exactly the
  `screenCoverage` arithmetic of trap 8b. A 4K export needs a ~4000px plate;
  a 1500px stock photo caps you whatever the quality tier says.
- **The screen quad's aspect must match the real device's**, or the
  screenshot skews — the same family as `screenAspect` in trap 1.
- **Grade matching is the tell.** A razor-sharp screenshot on a soft photo
  looks pasted on. Matched blur, grain and exposure plus a reflection layer
  are where the cheap-mockup look actually comes from, not the geometry.

Scale: roughly the size of the device system — a milestone, not an
afternoon. The long pole is **assets**, not code: well-shot photos with
hand-authored masks, licensed or shot yourself.

## Conventions

- Comments explain *why*, especially where a naive approach is wrong. Match
  the surrounding density.
- Tests guard specific regressions, and the test name says what breaks.
  Prefer a test that fails loudly over a comment saying "don't do X".
- Measure before claiming an improvement. Two diagnoses this session were
  wrong and only caught by measuring — anisotropy was blamed for a blur that
  turned out to be isotropic minification, and a first sharpness metric
  reported stepped downsampling as *worse* because it counted aliasing as
  detail.
- The repo is on `main` with substantial uncommitted work. The user manages
  git; ask before committing.
- **Work happens in a worktree under `.claude/worktrees/`, which the user
  does not run.** Changes must be copied into `/Users/binaryy/Documents/mockup-web`
  or the user sees nothing — this cost a whole round trip once ("it's just
  the generic phone and the iPhone 17 Pro that are listed"). Check the
  checkout, not the worktree, before reporting something as working.
  While such a worktree exists, `npm test` in the checkout collects it too
  and reports double the tests; `--exclude '**/.claude/**'` gives the real
  number.
