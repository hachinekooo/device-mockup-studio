import { describe, expect, it } from 'vitest'
import { TEMPLATES, applyTemplateToDevices, getTemplate, templateCamera } from './templates'
import { sampleTimeline } from './sample'
import { applyMotionPreset } from './presets'
import { createDefaultProject, createDevice } from '../store/defaults'
import { migrate } from '../store/persist'

describe('template catalogue', () => {
  it('has unique ids and at least one pose each', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of TEMPLATES) expect(t.poses.length).toBeGreaterThan(0)
  })

  it('keeps every device inside a sane working volume', () => {
    // A pose that flings a device out of frame is useless as a starting
    // point, and it is easy to do by mistyping a position.
    for (const t of TEMPLATES) {
      for (const pose of t.poses) {
        expect(Math.abs(pose.position[0])).toBeLessThan(3)
        expect(Math.abs(pose.position[1])).toBeLessThan(3)
        expect(Math.abs(pose.position[2])).toBeLessThan(3)
        expect(pose.scale).toBeGreaterThan(0.4)
        expect(pose.scale).toBeLessThanOrEqual(1.5)
      }
    }
  })

  it('never stacks two devices in exactly the same place', () => {
    for (const t of TEMPLATES) {
      const seen = new Set(t.poses.map((p) => p.position.join(',')))
      expect(seen.size).toBe(t.poses.length)
    }
  })

  it('puts the camera far enough back to see the arrangement', () => {
    for (const t of TEMPLATES) {
      const distance = Math.hypot(...t.camera.position)
      expect(distance).toBeGreaterThan(2)
      expect(t.camera.fov).toBeGreaterThan(10)
      expect(t.camera.fov).toBeLessThan(60)
    }
  })
})

describe('applyTemplateToDevices', () => {
  it('produces exactly the template\'s device count', () => {
    const duo = getTemplate('duo-offset')!
    expect(applyTemplateToDevices(duo, [createDevice()])).toHaveLength(2)
  })

  it('carries the existing model, finish and screen onto added devices', () => {
    // Switching to a multi-device template should re-pose what you set up,
    // not hand back an empty stage.
    const screen = { id: 'm1', kind: 'image' as const, width: 1206, height: 2622, url: 'blob:x' }
    const seed = createDevice({ id: 'iphone-17-pro', colorway: 'black-titanium', screen })
    const result = applyTemplateToDevices(getTemplate('trio-fan')!, [seed])

    expect(result).toHaveLength(3)
    for (const device of result) {
      expect(device.id).toBe('iphone-17-pro')
      expect(device.colorway).toBe('black-titanium')
      expect(device.screen).toBe(screen)
    }
  })

  it('keeps each existing device its own screen when there are enough', () => {
    const a = createDevice({ colorway: 'silver' })
    const b = createDevice({ colorway: 'graphite' })
    const result = applyTemplateToDevices(getTemplate('duo-flat')!, [a, b])
    expect(result[0].colorway).toBe('silver')
    expect(result[1].colorway).toBe('graphite')
    // Identity is preserved so React keys and undo stay stable.
    expect(result[0].instanceId).toBe(a.instanceId)
  })

  it('drops extras when moving to a smaller template', () => {
    const three = applyTemplateToDevices(getTemplate('trio-fan')!, [createDevice()])
    const one = applyTemplateToDevices(getTemplate('hero-straight')!, three)
    expect(one).toHaveLength(1)
  })

  it('resolves through sampleTimeline to the poses it declares', () => {
    const template = getTemplate('duo-offset')!
    const project = {
      ...createDefaultProject(),
      devices: applyTemplateToDevices(template, [createDevice()]),
      camera: templateCamera(template),
    }
    const state = sampleTimeline(project, 0)
    expect(state.devices).toHaveLength(2)
    expect(state.devices[0].position).toEqual(template.poses[0].position)
    expect(state.devices[1].position).toEqual(template.poses[1].position)
    expect(state.camera.position).toEqual(template.camera.position)
  })
})

describe('motion on a template', () => {
  it('animates every device, not only the first', () => {
    const project = {
      ...createDefaultProject(),
      devices: applyTemplateToDevices(getTemplate('trio-fan')!, [createDevice()]),
    }
    const spun = applyMotionPreset(project, 'spin-y-360')
    for (const device of spun.devices) {
      expect(device.transform['rotation.y'].keys.length).toBeGreaterThan(1)
    }
  })

  it('offsets motion by each device\'s pose instead of snapping to origin', () => {
    // The bug this guards: a float preset that resets a template's careful
    // placement, collapsing the whole arrangement onto the centre.
    const template = getTemplate('duo-offset')!
    const project = {
      ...createDefaultProject(),
      devices: applyTemplateToDevices(template, [createDevice()]),
    }
    const floated = applyMotionPreset(project, 'float')

    const state = sampleTimeline(floated, 0)
    expect(state.devices[0].position[0]).toBeCloseTo(template.poses[0].position[0], 6)
    expect(state.devices[1].position[0]).toBeCloseTo(template.poses[1].position[0], 6)
  })

  it('composes a spin onto the pose\'s own starting rotation', () => {
    const template = getTemplate('duo-offset')!
    const project = {
      ...createDefaultProject(),
      devices: applyTemplateToDevices(template, [createDevice()]),
    }
    const spun = applyMotionPreset(project, 'spin-y-360')
    const start = sampleTimeline(spun, 0).devices[0].rotation[1]
    const end = sampleTimeline(spun, project.duration).devices[0].rotation[1]
    expect(start).toBeCloseTo(template.poses[0].rotation[1], 6)
    expect(end - start).toBeCloseTo(Math.PI * 2, 4)
  })
})

describe('legacy single-device documents', () => {
  it('folds an old device + deviceTransform pair into the device list', () => {
    const legacy = {
      version: 1,
      name: 'Old file',
      device: { id: 'iphone-17-pro', colorway: 'white-titanium', screenFit: 'cover' },
      deviceTransform: { 'position.x': { keys: [{ t: 0, v: 0.5, ease: [0, 0, 1, 1] }] } },
    }
    const migrated = migrate(legacy)
    expect(migrated.devices).toHaveLength(1)
    expect(migrated.devices[0].id).toBe('iphone-17-pro')
    expect(migrated.devices[0].colorway).toBe('white-titanium')
    expect(migrated.devices[0].screenFit).toBe('cover')
    expect(sampleTimeline(migrated, 0).devices[0].position[0]).toBeCloseTo(0.5, 6)
  })

  it('still yields a usable project when the legacy device is absent', () => {
    expect(migrate({ version: 1, name: 'Bare' }).devices.length).toBeGreaterThan(0)
  })
})

describe('reference-matched showcase templates', () => {
  const showcase = ['duo-offset', 'trio-set', 'trio-fan']

  it('exist and carry the studio look, not just poses', () => {
    for (const id of showcase) {
      const t = getTemplate(id)!
      expect(t).toBeDefined()
      expect(t.background).toBeDefined()
      // These float — a heavy contact shadow is the wrong look for them.
      expect(t.shadowOpacity).toBeLessThan(0.2)
    }
  })

  it('turn every device far enough to reveal its side edge', () => {
    // A near-zero y-rotation reads as a flat screenshot on a rectangle,
    // which is the exact failure these layouts exist to avoid.
    for (const id of showcase) {
      for (const pose of getTemplate(id)!.poses) {
        expect(Math.abs(pose.rotation[1])).toBeGreaterThan(5 * (Math.PI / 180))
      }
    }
  })

  it('duo staggers in all three axes so the pair overlaps', () => {
    const [a, b] = getTemplate('duo-offset')!.poses
    expect(a.position[0]).toBeLessThan(b.position[0]) // left / right
    expect(a.position[1]).toBeLessThan(b.position[1]) // lower / higher
    expect(a.position[2]).toBeGreaterThan(b.position[2]) // nearer / further
    // Closer together than two phone widths, so they actually overlap.
    expect(b.position[0] - a.position[0]).toBeLessThan(1.44)
  })

  it('trio set pushes the centre device forward and down', () => {
    const [left, centre, right] = getTemplate('trio-set')!.poses
    expect(centre.position[2]).toBeGreaterThan(left.position[2])
    expect(centre.position[2]).toBeGreaterThan(right.position[2])
    expect(centre.position[1]).toBeLessThan(left.position[1])
    // One shared rotation is what makes the three read as a single set.
    expect(left.rotation[1]).toBeCloseTo(right.rotation[1], 6)
    expect(centre.rotation[1]).toBeCloseTo(left.rotation[1], 6)
  })

  it('trio fan leans the outer devices apart around an upright centre', () => {
    const [left, centre, right] = getTemplate('trio-fan')!.poses
    expect(left.rotation[2]).toBeGreaterThan(0)
    expect(right.rotation[2]).toBeLessThan(0)
    expect(centre.rotation[2]).toBeCloseTo(0, 6)
  })

  it('frames each arrangement without clipping its outermost device', () => {
    // A leaning phone sweeps much wider than its own width — the height term
    // dominates once there is any z-rotation — so the guard has to use the
    // rotated bounding box, not the upright one.
    const PHONE_W = 0.72
    const PHONE_H = 1.47

    // Every template with a head-on camera. The off-axis ones (flat lay,
    // low hero) need a real projection rather than this flat approximation,
    // so they are checked by eye instead.
    const headOn = TEMPLATES.filter(
      (t) => t.camera.position[0] === 0 && t.camera.position[1] === 0 && t.suggestedOutput,
    )
    expect(headOn.length).toBeGreaterThan(5)

    for (const t of headOn) {
      const halfHeight = Math.tan((t.camera.fov / 2) * (Math.PI / 180)) * t.camera.position[2]
      const halfWidth = halfHeight * (t.suggestedOutput!.width / t.suggestedOutput!.height)

      for (const pose of t.poses) {
        const [, ry, rz] = pose.rotation
        const w = PHONE_W * Math.abs(Math.cos(ry)) // y-rotation foreshortens
        const halfW = ((w * Math.abs(Math.cos(rz)) + PHONE_H * Math.abs(Math.sin(rz))) / 2) * pose.scale
        const halfH = ((PHONE_H * Math.abs(Math.cos(rz)) + w * Math.abs(Math.sin(rz))) / 2) * pose.scale

        expect(
          Math.abs(pose.position[0]) + halfW,
          `${t.id} overruns the frame horizontally`,
        ).toBeLessThan(halfWidth)
        expect(
          Math.abs(pose.position[1]) + halfH,
          `${t.id} overruns the frame vertically`,
        ).toBeLessThan(halfHeight)
      }
    }
  })
})
