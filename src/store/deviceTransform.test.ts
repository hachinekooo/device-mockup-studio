import { describe, expect, it, beforeEach } from 'vitest'
import { useProjectStore } from './project'
import { createDefaultProject, createDevice } from './defaults'
import { resetCoalescing } from './history'
import { sampleTimeline } from '../timeline/sample'

/**
 * Per-device transform editing — what turns the eleven templates from a fixed
 * menu into a starting point.
 */
function twoDeviceProject() {
  const project = createDefaultProject()
  useProjectStore.setState({
    project: { ...project, devices: [createDevice(), createDevice({ id: 'pixel-9-pro-xl' })] },
    activeDevice: 0,
    playhead: 0,
  })
}

const resolved = (index: number) => {
  const { project, playhead } = useProjectStore.getState()
  return sampleTimeline(project, playhead).devices[index]
}

describe('device transform actions', () => {
  beforeEach(() => {
    resetCoalescing()
    twoDeviceProject()
  })

  it('moves the device the Devices list has selected, and only that one', () => {
    // The whole point of a multi-device scene: sliding one must not drag the
    // other along with it.
    useProjectStore.setState({ activeDevice: 1 })
    useProjectStore.getState().setDevicePosition([0.6, -0.2, 0.3])

    expect(resolved(1).position).toEqual([0.6, -0.2, 0.3])
    expect(resolved(0).position).toEqual([0, 0, 0])
  })

  it('writes position as three separate scalar channels', () => {
    // Every animatable value is a scalar channel, never a packed vector —
    // that is what lets the timeline render one kind of row (§8.1).
    useProjectStore.getState().setDevicePosition([1, 2, 3])
    const { transform } = useProjectStore.getState().project.devices[0]

    expect(transform['position.x'].keys[0].v).toBe(1)
    expect(transform['position.y'].keys[0].v).toBe(2)
    expect(transform['position.z'].keys[0].v).toBe(3)
  })

  it('scales the active device uniformly', () => {
    useProjectStore.getState().setDeviceScale(0.8)
    expect(resolved(0).scale).toBeCloseTo(0.8, 6)
    expect(resolved(1).scale).toBeCloseTo(1, 6)
  })

  it('keeps a single keyframe static rather than animated', () => {
    // One key means "a number in the inspector"; two or more means animated.
    // Nudging a device at t=0 must not silently create an animation.
    useProjectStore.getState().setDevicePosition([0.5, 0, 0])
    useProjectStore.getState().setDeviceScale(0.9)
    const { transform } = useProjectStore.getState().project.devices[0]

    expect(transform['position.x'].keys).toHaveLength(1)
    expect(transform.scale.keys).toHaveLength(1)
  })

  it('does NOT start animating just because the playhead has moved', () => {
    // A static track stays static however far the playhead has been scrubbed
    // (`setValueAt` replaces while keys.length <= 1). Nudging a device to
    // line it up must never silently turn the pose into an animation — the
    // animate toggle is what adds the second key.
    useProjectStore.getState().setDevicePosition([0, 0, 0])
    useProjectStore.setState({ playhead: 1.5 })
    useProjectStore.getState().setDevicePosition([1, 0, 0])

    const track = useProjectStore.getState().project.devices[0].transform['position.x']
    expect(track.keys).toHaveLength(1)
    expect(track.keys[0].v).toBe(1)
  })

  it('sets a keyframe at the playhead once a channel IS animated', () => {
    const store = () => useProjectStore.getState()
    store().setDevicePosition([0, 0, 0])
    // Hand-build the two-key case the animate toggle produces.
    const device = store().project.devices[0]
    useProjectStore.setState({
      project: {
        ...store().project,
        devices: [
          {
            ...device,
            transform: {
              ...device.transform,
              'position.x': { keys: [
                { t: 0, v: 0, ease: [0.4, 0, 0.2, 1] },
                { t: 2, v: 0, ease: [0.4, 0, 0.2, 1] },
              ] },
            },
          },
          store().project.devices[1],
        ],
      },
    })

    useProjectStore.setState({ playhead: 1 })
    store().setDevicePosition([0.75, 0, 0])

    const track = store().project.devices[0].transform['position.x']
    expect(track.keys).toHaveLength(3)
    expect(track.keys.find((k) => k.t === 1)?.v).toBeCloseTo(0.75, 6)
  })

  it('adds, edits, and deletes a complete device keyframe without a preset', () => {
    const store = () => useProjectStore.getState()
    store().addDeviceKeyframe(1)

    const keyed = store().project.devices[0].transform
    expect(Object.values(keyed).every((track) => track.keys.length === 2)).toBe(true)

    useProjectStore.setState({ playhead: 1 })
    store().setDevicePosition([0.75, 0.25, -0.1])
    expect(store().project.devices[0].transform['position.x'].keys).toHaveLength(2)
    expect(resolved(0).position).toEqual([0.75, 0.25, -0.1])

    store().deleteDeviceKeyframe(1)
    expect(Object.values(store().project.devices[0].transform).every((track) => track.keys.length === 1)).toBe(true)
    expect(resolved(0).position).toEqual([0, 0, 0])
  })

  it('adds and deletes an exact camera keyframe', () => {
    const store = () => useProjectStore.getState()
    store().addCameraKeyframe(1.5)
    expect(Object.values(store().project.camera.tracks).every((track) => track.keys.length === 2)).toBe(true)

    store().deleteCameraKeyframe(1.5)
    expect(Object.values(store().project.camera.tracks).every((track) => track.keys.length === 1)).toBe(true)
  })

  it('is undoable', () => {
    useProjectStore.getState().setDevicePosition([0.4, 0, 0])
    resetCoalescing()
    useProjectStore.getState().setDeviceScale(0.5)

    useProjectStore.getState().undo()
    expect(resolved(0).scale).toBeCloseTo(1, 6)
    expect(resolved(0).position[0]).toBeCloseTo(0.4, 6)
  })

  it('survives a template being applied over it', () => {
    // A template rewrites every device's pose. That is the intended
    // relationship — templates and these fields write the same channels — so
    // picking one after nudging must land on the template's pose, not a mix.
    useProjectStore.getState().setDevicePosition([9, 9, 9])
    useProjectStore.getState().applyTemplate('duo-offset')

    expect(resolved(0).position).not.toEqual([9, 9, 9])
  })
})
