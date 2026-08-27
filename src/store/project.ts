import { create } from 'zustand'
import { createDefaultProject, createDevice } from './defaults'
import { applyTemplateToDevices, getTemplate, templateCamera } from '../timeline/templates'
import { emptyHistory, record, redo, resetCoalescing, undo, type History } from './history'
import type { ExportQuality } from '../export/frameRenderer'
import { deserializeProject, downloadProject, pruneUnreferencedMedia, serializeProject } from './persist'
import { applyCameraAngle, applyMotionPreset, type MotionPresetId } from '../timeline/presets'
import { setVec3At, setValueAt } from '../timeline/tracks'
import { getManifest } from '../devices/manifest'
import type {
  BackgroundConfig,
  CameraAnglePreset,
  DeviceId,
  DeviceInstance,
  DeviceOrientation,
  MediaRef,
  Project,
  ScreenFit,
  Vec3,
} from './schema'

type ProjectStore = {
  project: Project
  /** Playhead position in seconds. Transient UI state, not part of the document. */
  playhead: number
  playing: boolean
  motionPreset: MotionPresetId

  /** 'image' hides the timeline entirely — a still has no time axis. */
  editorMode: 'movie' | 'image'
  exportQuality: ExportQuality
  setExportQuality: (q: ExportQuality) => void
  /**
   * Size the export from the screenshot rather than from the chosen output
   * size. Opt-in: enabling it can create a much larger file, so the chosen
   * canvas dimensions remain authoritative unless the user asks otherwise.
   */
  matchSource: boolean
  setMatchSource: (on: boolean) => void
  history: History
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void
  newProject: () => void
  saveProject: () => Promise<void>
  openProject: (file: Blob) => Promise<void>
  setEditorMode: (mode: 'movie' | 'image') => void
  setName: (name: string) => void
  setPlayhead: (t: number) => void
  setPlaying: (playing: boolean) => void
  setDuration: (seconds: number) => void
  setFps: (fps: 30 | 60) => void

  /** Index of the device the inspector edits. Transient, not part of the doc. */
  activeDevice: number
  setActiveDevice: (index: number) => void
  addDevice: () => void
  duplicateDevice: (index: number) => void
  removeDevice: (index: number) => void
  applyTemplate: (templateId: string) => void

  setScreenMedia: (ref: MediaRef | null) => void
  setScreenFit: (fit: ScreenFit) => void
  setDeviceId: (id: DeviceId) => void
  setColorway: (id: string) => void
  setOrientation: (o: DeviceOrientation) => void

  setBackground: (bg: BackgroundConfig) => void
  setEnvironment: (patch: Partial<Project['environment']>) => void
  setOutput: (patch: Partial<Project['output']>) => void

  setCameraPreset: (preset: CameraAnglePreset) => void
  setCameraPosition: (v: Vec3) => void
  setCameraFov: (fov: number) => void
  setDeviceRotation: (v: Vec3) => void
  setDevicePosition: (v: Vec3) => void
  setDeviceScale: (v: number) => void
  setMotionPreset: (preset: MotionPresetId) => void
}

// Narrow selectors are used at call sites (§14 trap 10) — components should
// subscribe to the slice they need, not the whole project object, or every
// timeline scrub re-renders the scene tree.
export const useProjectStore = create<ProjectStore>((set, get) => {
  /**
   * Every document mutation goes through here, so undo coverage can't drift
   * out of sync with the set of actions. `label` groups a continuous gesture
   * (a field drag, a slider) into one history entry.
   */
  const edit = (label: string, update: (p: Project) => Project) =>
    set((s) => ({
      project: update(s.project),
      history: record(s.history, s.project, label),
    }))

  /** Edit one device instance in place, leaving the rest of the list alone. */
  const editDevice = (label: string, update: (d: DeviceInstance) => DeviceInstance) =>
    edit(label, (p) => ({
      ...p,
      devices: p.devices.map((d, i) => (i === get().activeDevice ? update(d) : d)),
    }))

  const replace = (project: Project) => {
    resetCoalescing()
    set({ project, history: emptyHistory, playhead: 0, playing: false, activeDevice: 0 })
  }

  return {
  project: createDefaultProject(),
  history: emptyHistory,

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,
  undo: () => {
    const s = get()
    const result = undo(s.history, s.project)
    if (result) set({ project: result.project, history: result.history })
  },
  redo: () => {
    const s = get()
    const result = redo(s.history, s.project)
    if (result) set({ project: result.project, history: result.history })
  },

  newProject: () => replace(createDefaultProject()),
  saveProject: async () => {
    const project = get().project
    downloadProject(await serializeProject(project), project.name)
  },
  openProject: async (file) => {
    const project = await deserializeProject(file)
    replace(project)
    void pruneUnreferencedMedia(project)
  },

  playhead: 0,
  playing: false,
  motionPreset: 'none',
  editorMode: 'image',
  activeDevice: 0,
  exportQuality: 'high',
  matchSource: false,

  setExportQuality: (exportQuality) => set({ exportQuality }),

  // Opt-in because matching a tall source can multiply both output axes.
  // Typing a size also turns it off, keeping the dimensions authoritative.
  setMatchSource: (matchSource: boolean) => set({ matchSource }),

  setEditorMode: (editorMode) => set({ editorMode }),
  setName: (name) => edit('name', (p) => ({ ...p, name })),

  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setDuration: (seconds) =>
    edit('duration', (p) => ({ ...p, duration: Math.max(0.1, seconds) })),
  // Frame rate is a document property, not an export setting: it decides
  // which times the timeline is sampled at, so changing it changes the clip
  // rather than just the file.
  setFps: (fps) => edit('fps', (p) => ({ ...p, fps })),

  setActiveDevice: (index) => set({ activeDevice: index }),

  addDevice: () => {
    // New devices land beside the current one rather than on top of it —
    // an added device you cannot see reads as nothing having happened.
    const source = get().project.devices[get().activeDevice]
    edit('addDevice', (p) => ({
      ...p,
      devices: [...p.devices, createDevice({ id: source?.id, colorway: source?.colorway })],
    }))
    set({ activeDevice: get().project.devices.length - 1 })
  },

  duplicateDevice: (index) => {
    edit('duplicateDevice', (p) => {
      const source = p.devices[index]
      if (!source) return p
      const copy = { ...source, instanceId: crypto.randomUUID() }
      return { ...p, devices: [...p.devices.slice(0, index + 1), copy, ...p.devices.slice(index + 1)] }
    })
    set({ activeDevice: index + 1 })
  },

  removeDevice: (index) => {
    // A scene with no devices has nothing to show and no way back, so the
    // last one can't be removed.
    if (get().project.devices.length <= 1) return
    edit('removeDevice', (p) => ({ ...p, devices: p.devices.filter((_, i) => i !== index) }))
    set({ activeDevice: Math.max(0, Math.min(index, get().project.devices.length - 1)) })
  },

  applyTemplate: (templateId) => {
    const template = getTemplate(templateId)
    if (!template) return
    edit('template', (p) => ({
      ...p,
      devices: applyTemplateToDevices(template, p.devices),
      camera: templateCamera(template),
      output: template.suggestedOutput ?? p.output,
      // Backdrop and shadow carry the look as much as the pose does.
      background: template.background ?? p.background,
      environment:
        template.shadowOpacity === undefined
          ? p.environment
          : { ...p.environment, shadowOpacity: template.shadowOpacity },
    }))
    set({ activeDevice: 0 })
  },

  setScreenMedia: (ref) => editDevice('screen', (d) => ({ ...d, screen: ref })),
  setScreenFit: (fit) => editDevice('fit', (d) => ({ ...d, screenFit: fit })),
  setDeviceId: (id) =>
    // A colorway id is only meaningful within its own manifest, so reset to
    // the incoming device's first swatch rather than carrying a stale one.
    editDevice('device', (d) => ({ ...d, id, colorway: getManifest(id).colorways[0].id })),
  setColorway: (colorway) => editDevice('colorway', (d) => ({ ...d, colorway })),
  setOrientation: (orientation) => editDevice('orientation', (d) => ({ ...d, orientation })),

  setBackground: (bg) => edit('background', (p) => ({ ...p, background: bg })),
  setEnvironment: (patch) =>
    edit('environment', (p) => ({ ...p, environment: { ...p.environment, ...patch } })),
  setOutput: (patch) => edit('output', (p) => ({ ...p, output: { ...p.output, ...patch } })),

  setCameraPreset: (preset) => edit('cameraPreset', (p) => applyCameraAngle(p, preset)),
  setCameraPosition: (v) =>
    edit('cameraPosition', (p) => ({
      ...p,
      camera: {
        ...p.camera,
        preset: null, // a free move is no longer any named angle
        tracks: setVec3At(p.camera.tracks, 'position', get().playhead, v),
      },
    })),
  setCameraFov: (fov) =>
    edit('fov', (p) => ({
      ...p,
      camera: {
        ...p.camera,
        fov,
        tracks: { ...p.camera.tracks, fov: setValueAt(p.camera.tracks.fov, get().playhead, fov) },
      },
    })),
  setDeviceRotation: (v) =>
    editDevice('deviceRotation', (d) => ({
      ...d,
      transform: setVec3At(d.transform, 'rotation', get().playhead, v),
    })),
  setDevicePosition: (v) =>
    editDevice('devicePosition', (d) => ({
      ...d,
      transform: setVec3At(d.transform, 'position', get().playhead, v),
    })),
  // Uniform, like every other scale in the document — a non-uniform device is
  // a distorted device, which is never what a mockup wants.
  setDeviceScale: (v) =>
    editDevice('deviceScale', (d) => ({
      ...d,
      transform: { ...d.transform, scale: setValueAt(d.transform.scale, get().playhead, v) },
    })),
  setMotionPreset: (preset) => {
    set({ motionPreset: preset })
    edit('motionPreset', (p) => applyMotionPreset(p, preset))
  },
  }
})
