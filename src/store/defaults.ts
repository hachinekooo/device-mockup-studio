import { cameraTracksForAngle } from '../timeline/presets'
import { staticTrack, staticVec3 } from '../timeline/tracks'
import { DEFAULT_CAMERA_PRESET, type DeviceInstance, type Project } from './schema'

export function createDevice(overrides: Partial<DeviceInstance> = {}): DeviceInstance {
  return {
    instanceId: crypto.randomUUID(),
    id: 'procedural-phone',
    colorway: 'graphite',
    orientation: 'portrait',
    screen: null,
    screenFit: 'contain',
    transform: {
      ...staticVec3('position', [0, 0, 0]),
      ...staticVec3('rotation', [0, 0, 0]),
      scale: staticTrack(1),
    },
    ...overrides,
  }
}

// Lives outside schema.ts because building a default project needs the
// track helpers, and those import the schema's types — keeping the factory
// here is what stops that becoming a cycle.
export function createDefaultProject(): Project {
  const fov = 32
  return {
    version: 1,
    name: 'Untitled',
    duration: 4,
    fps: 30,
    output: { width: 1920, height: 1080 },
    devices: [createDevice()],
    background: { type: 'gradient', from: '#3a3f52', to: '#0e0f14', angle: 135 },
    environment: {
      hdri: 'studio',
      intensity: 1,
      rotation: 0,
      // A product shot's shadow is soft, light and sits UNDER the device.
      // At 0.55/2.2 this was a near-black hard-edged slab thrown off to one
      // side — the single biggest reason the scenes read as harsh CGI
      // rather than as a photograph.
      shadowOpacity: 0.3,
      shadowBlur: 14,
    },
    camera: {
      fov,
      preset: DEFAULT_CAMERA_PRESET,
      tracks: cameraTracksForAngle(DEFAULT_CAMERA_PRESET, fov),
    },
  }
}
