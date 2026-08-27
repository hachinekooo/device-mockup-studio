import { RotateCcw } from 'lucide-react'
import { NumberField } from '../controls/NumberField'
import { useProjectStore } from '../../store/project'
import { sampleTimeline } from '../../timeline/sample'

/**
 * Position, rotation and scale for the device the Devices list has selected.
 *
 * This is what makes a template a starting point rather than a fixed set of
 * eleven arrangements: pick the closest one, then slide each device until it
 * sits the way you want. Templates already write exactly these channels
 * (`templates.ts` poses are per-device transforms), so editing them here and
 * picking a template are the same operation on the same data — there is no
 * "custom" mode to fall out of.
 *
 * Rotation lived under the Camera heading before, which read as if it turned
 * the camera. It belongs beside the other two.
 */
export function TransformSection() {
  const project = useProjectStore((s) => s.project)
  const playhead = useProjectStore((s) => s.playhead)
  const active = useProjectStore((s) => s.activeDevice)
  const setDevicePosition = useProjectStore((s) => s.setDevicePosition)
  const setDeviceRotation = useProjectStore((s) => s.setDeviceRotation)
  const setDeviceScale = useProjectStore((s) => s.setDeviceScale)

  // Resolved at the playhead, not read off the raw keyframes — so scrubbing
  // moves the numbers exactly as it moves the device, and one evaluation path
  // feeds the canvas and the inspector both.
  const state = sampleTimeline(project, playhead)
  const device = state.devices[active]
  if (!device) return null

  const [px, py, pz] = device.position
  const [rx, ry, rz] = device.rotation

  const animated = (channel: string) =>
    (project.devices[active]?.transform[channel]?.keys.length ?? 0) > 1

  const deg = (rad: number) => (rad * 180) / Math.PI
  const rad = (d: number) => (d * Math.PI) / 180

  function reset() {
    setDevicePosition([0, 0, 0])
    setDeviceRotation([0, 0, 0])
    setDeviceScale(1)
  }

  return (
    <div className="control-group">
      <div className="field-header">
        <label>Transform</label>
        <button className="link-btn" onClick={reset} title="Recentre this device">
          <RotateCcw size={11} /> Reset
        </button>
      </div>

      {/* Drag any field to slide the device; the boxes scrub. Shift for fine
          control, which is where overlapping two devices actually happens. */}
      <div className="field-grid">
        <NumberField
          value={px}
          onChange={(v) => setDevicePosition([v, py, pz])}
          label="Pos x"
          animated={animated('position.x')}
        />
        <NumberField
          value={py}
          onChange={(v) => setDevicePosition([px, v, pz])}
          label="y"
          animated={animated('position.y')}
        />
        <NumberField
          value={pz}
          onChange={(v) => setDevicePosition([px, py, v])}
          label="z"
          animated={animated('position.z')}
        />
      </div>

      {/* Degrees for humans, radians in the document — converted at the edge
          so the timeline model stays in one unit. */}
      <div className="field-grid">
        <NumberField
          value={deg(rx)}
          onChange={(v) => setDeviceRotation([rad(v), ry, rz])}
          label="Rot x"
          step={0.5}
          precision={1}
          animated={animated('rotation.x')}
        />
        <NumberField
          value={deg(ry)}
          onChange={(v) => setDeviceRotation([rx, rad(v), rz])}
          label="y"
          step={0.5}
          precision={1}
          animated={animated('rotation.y')}
        />
        <NumberField
          value={deg(rz)}
          onChange={(v) => setDeviceRotation([rx, ry, rad(v)])}
          label="z"
          step={0.5}
          precision={1}
          animated={animated('rotation.z')}
        />
      </div>

      <div className="field-grid">
        <NumberField
          value={device.scale}
          onChange={setDeviceScale}
          label="Scale"
          step={0.005}
          min={0.05}
          animated={animated('scale')}
        />
      </div>

      <p className="hint">
        Drag a field to slide this device; hold Shift for fine control. Depth is{' '}
        <strong>z</strong> — raise it to bring a device in front of the other.
      </p>
    </div>
  )
}
