import { RotateCcw } from 'lucide-react'
import { NumberField } from '../controls/NumberField'
import { SubSection } from '../controls/Section'
import { SliderRow } from '../controls/SliderRow'
import { useProjectStore } from '../../store/project'
import { sampleTimeline } from '../../timeline/sample'
import { CAMERA_PRESETS, DEFAULT_CAMERA_PRESET, type CameraAnglePreset } from '../../store/schema'

// The eight arrows around Rotato's rotation dial. Each nudges the camera
// around the device rather than setting an absolute pose, so repeated
// presses keep orbiting — which is what the arrow shape implies.
const DIAL: { key: CameraAnglePreset; glyph: string; label: string }[] = [
  { key: 'three-quarter-left', glyph: '↖', label: '3/4 Left' },
  { key: 'top-down', glyph: '↑', label: 'Top Down' },
  { key: 'three-quarter-right', glyph: '↗', label: '3/4 Right' },
  { key: 'side', glyph: '→', label: 'Side' },
  { key: 'low-angle', glyph: '↓', label: 'Low Angle' },
  { key: 'front', glyph: '←', label: 'Front' },
]

export function CameraSection() {
  const project = useProjectStore((s) => s.project)
  const playhead = useProjectStore((s) => s.playhead)
  const setCameraPosition = useProjectStore((s) => s.setCameraPosition)
  const setCameraFov = useProjectStore((s) => s.setCameraFov)
  const setCameraPreset = useProjectStore((s) => s.setCameraPreset)

  // Fields show the *resolved* value at the playhead, not the raw keyframe —
  // so scrubbing the timeline moves the numbers, exactly as it moves the
  // device. One evaluation path for the canvas and the inspector both.
  const state = sampleTimeline(project, playhead)
  const [px, py, pz] = state.camera.position

  const animatedPos = (axis: string) =>
    (project.camera.tracks[`position.${axis}`]?.keys.length ?? 0) > 1

  return (
    <>
      <div className="field-header">
        <span />
        <button className="link-btn" onClick={() => setCameraPreset(DEFAULT_CAMERA_PRESET)}>
          <RotateCcw size={11} /> Reset
        </button>
      </div>

      <div className="field-grid">
        <NumberField value={px} onChange={(v) => setCameraPosition([v, py, pz])} label="Pos x" animated={animatedPos('x')} />
        <NumberField value={py} onChange={(v) => setCameraPosition([px, v, pz])} label="y" animated={animatedPos('y')} />
        <NumberField value={pz} onChange={(v) => setCameraPosition([px, py, v])} label="z" animated={animatedPos('z')} />
      </div>


      <div className="dial-row">
        <span className="dial-caption">Rotation</span>
        <div className="dial">
          {DIAL.map((d) => (
            <button
              key={d.key}
              title={d.label}
              className={project.camera.preset === d.key ? 'dial-btn active' : 'dial-btn'}
              onClick={() => setCameraPreset(d.key)}
            >
              {d.glyph}
            </button>
          ))}
        </div>
      </div>

      <SubSection title="Lens">
        <SliderRow
          label="Field of view"
          value={state.camera.fov}
          min={12}
          max={80}
          step={1}
          onChange={setCameraFov}
          format={(v) => `${v.toFixed(0)}°`}
        />
        <p className="hint">
          Narrow reads as a product shot; wide exaggerates depth. Around 30° matches how
          phones are usually photographed.
        </p>
      </SubSection>

      <SubSection title="Angle presets">
        <div className="preset-grid">
          {(Object.keys(CAMERA_PRESETS) as CameraAnglePreset[]).map((key) => (
            <button
              key={key}
              className={key === project.camera.preset ? 'preset-btn active' : 'preset-btn'}
              onClick={() => setCameraPreset(key)}
            >
              {CAMERA_PRESETS[key].label}
            </button>
          ))}
        </div>
      </SubSection>
    </>
  )
}
