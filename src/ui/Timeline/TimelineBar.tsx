import { useRef } from 'react'
import { Play, Pause, Plus } from 'lucide-react'
import { useProjectStore } from '../../store/project'
import { MOTION_PRESETS, type MotionPresetId } from '../../timeline/presets'
import { keyTimes } from '../../timeline/tracks'
import { isAnimated } from '../../timeline/sample'

/**
 * Timeline zone. Phase 2 builds the transport and the ruler; the keyframe
 * diamonds render read-only here because they already have real data behind
 * them — dragging and easing editing is the next milestone.
 */
export function TimelineBar() {
  const project = useProjectStore((s) => s.project)
  const playhead = useProjectStore((s) => s.playhead)
  const playing = useProjectStore((s) => s.playing)
  const motionPreset = useProjectStore((s) => s.motionPreset)
  const setPlayhead = useProjectStore((s) => s.setPlayhead)
  const setPlaying = useProjectStore((s) => s.setPlaying)
  const setDuration = useProjectStore((s) => s.setDuration)
  const setMotionPreset = useProjectStore((s) => s.setMotionPreset)
  const trackRef = useRef<HTMLDivElement>(null)

  const duration = project.duration
  const pct = (t: number) => `${(t / duration) * 100}%`

  function scrubTo(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setPlaying(false)
    setPlayhead(ratio * duration)
  }

  const cameraKeys = keyTimes(project.camera.tracks)
  const active = useProjectStore((s) => s.activeDevice)
  const deviceTracks = project.devices[active]?.transform ?? {}
  const deviceKeys = keyTimes(deviceTracks)
  const cameraAnimated = isAnimated(project.camera.tracks)
  const deviceAnimated = isAnimated(deviceTracks)

  // One tick per second, plus a half-second subdivision for readability.
  const seconds = Math.ceil(duration)

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button className="play-btn" onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <label className="add-animation">
          <Plus size={14} />
          <select
            value={motionPreset}
            onChange={(e) => setMotionPreset(e.target.value as MotionPresetId)}
          >
            {MOTION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'none' ? 'Add animation' : p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="time-readout">
          <span className="time-now">{playhead.toFixed(2)}s</span>
          <span className="time-of">of</span>
          <input
            className="time-duration"
            type="number"
            min={0.5}
            step={0.5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
          <span className="time-of">s</span>
        </div>
      </div>

      <div className="timeline-body">
        <div className="ruler">
          {Array.from({ length: seconds + 1 }, (_, i) => (
            <span key={i} className="tick" style={{ left: pct(Math.min(i, duration)) }}>
              {i}s
            </span>
          ))}
        </div>

        <div className="tracks" ref={trackRef} onPointerDown={(e) => scrubTo(e.clientX)}>
          <TrackRow label="Camera" keys={cameraKeys} animated={cameraAnimated} pct={pct} />
          <TrackRow label="Device" keys={deviceKeys} animated={deviceAnimated} pct={pct} />
          <div className="playhead" style={{ left: pct(playhead) }}>
            <span className="playhead-grip" />
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackRow({
  label,
  keys,
  animated,
  pct,
}: {
  label: string
  keys: number[]
  animated: boolean
  pct: (t: number) => string
}) {
  return (
    <div className="track-row">
      <span className="track-label">{label}</span>
      <div className={animated ? 'track-lane animated' : 'track-lane'}>
        {animated &&
          keys.map((t) => <span key={t} className="keyframe" style={{ left: pct(t) }} />)}
      </div>
    </div>
  )
}
