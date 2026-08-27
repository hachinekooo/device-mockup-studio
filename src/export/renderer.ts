import * as THREE from 'three'

// Preview and export share the same renderer/scene/camera instances — the
// spec is explicit (§4) that both must consume the same scene, and writing
// export-specific rendering logic is a sign the abstraction has broken.
// This module is a plain-object bridge populated by <ExportBridge/> inside
// the R3F <Canvas>, and read by the export dialog outside it.
type CanvasContext = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  /**
   * R3F's loop control. Export MUST be able to stop it: a running loop
   * renders new frames into the same canvas between the export resize and
   * the export render, tearing the result.
   */
  setFrameloop: (mode: 'always' | 'never' | 'demand') => void
}

/** Poses the whole scene at timeline time `t`. See `SceneDriver`. */
export type SceneApplier = (t: number) => void

export type ExportContext = CanvasContext & { applyAt: SceneApplier }

let canvas: CanvasContext | null = null
let applier: SceneApplier | null = null

export function registerExportContext(ctx: CanvasContext) {
  canvas = ctx
  // Dev-only handle so the scene can be inspected from the console (and by
  // browser automation) without wiring a debug panel. Stripped in prod.
  if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__mockup = ctx
}

export function clearExportContext() {
  canvas = null
}

/**
 * Registered by SceneDriver, which is the only thing that holds the device
 * refs. Kept in its own slot rather than folded into the canvas context
 * because the two are published by different components; `getExportContext`
 * hands back a context only once both have arrived.
 */
export function registerSceneApplier(fn: SceneApplier): () => void {
  applier = fn
  return () => {
    if (applier === fn) applier = null
  }
}

export function getExportContext(): ExportContext | null {
  return canvas && applier ? { ...canvas, applyAt: applier } : null
}
