import { useCallback, useEffect, useState } from 'react'
import { Play, Pause, Plus, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../store/project'
import { MOTION_PRESETS, type MotionPresetId } from '../../timeline/presets'
import { keyTimes } from '../../timeline/tracks'
import { isAnimated } from '../../timeline/sample'
import { snapTimeToFrame, timelineTimeAtPointer } from './timelineMath'

type TrackTarget = 'camera' | 'device'
type KeySelection = { target: TrackTarget; time: number; deviceInstanceId?: string }

/**
 * Compact object-level timeline. Each diamond represents all scalar keys for
 * one Camera or Device at that instant; detailed per-channel rows and easing
 * handles can build on the same track data later.
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
  const addCameraKeyframe = useProjectStore((s) => s.addCameraKeyframe)
  const addDeviceKeyframe = useProjectStore((s) => s.addDeviceKeyframe)
  const deleteCameraKeyframe = useProjectStore((s) => s.deleteCameraKeyframe)
  const deleteDeviceKeyframe = useProjectStore((s) => s.deleteDeviceKeyframe)
  const [activeTrack, setActiveTrack] = useState<TrackTarget>('device')
  const [selection, setSelection] = useState<KeySelection | null>(null)

  const duration = project.duration
  const pct = (t: number) => `${(t / duration) * 100}%`

  function scrubTo(target: TrackTarget, clientX: number, laneLeft: number, laneWidth: number) {
    const time = timelineTimeAtPointer(clientX, laneLeft, laneWidth, duration, project.fps)
    setPlaying(false)
    setActiveTrack(target)
    setSelection(null)
    setPlayhead(time)
  }

  const cameraKeys = keyTimes(project.camera.tracks)
  const active = useProjectStore((s) => s.activeDevice)
  const deviceTracks = project.devices[active]?.transform ?? {}
  const activeDeviceInstanceId = project.devices[active]?.instanceId
  const deviceKeys = keyTimes(deviceTracks)
  const cameraAnimated = isAnimated(project.camera.tracks)
  const deviceAnimated = isAnimated(deviceTracks)
  const currentSelection =
    selection?.target === 'device' && selection.deviceInstanceId !== activeDeviceInstanceId
      ? null
      : selection

  function selectKeyframe(target: TrackTarget, time: number) {
    setPlaying(false)
    setActiveTrack(target)
    setSelection({
      target,
      time,
      deviceInstanceId: target === 'device' ? activeDeviceInstanceId : undefined,
    })
    // A key click is an exact jump, not a frame-rounded approximation.
    setPlayhead(time)
  }

  function addKeyframe() {
    const time = snapTimeToFrame(playhead, project.fps, duration)
    if (activeTrack === 'camera') addCameraKeyframe(time)
    else addDeviceKeyframe(time)
    setPlaying(false)
    setPlayhead(time)
    setSelection({
      target: activeTrack,
      time,
      deviceInstanceId: activeTrack === 'device' ? activeDeviceInstanceId : undefined,
    })
  }

  const deleteSelected = useCallback(() => {
    if (!currentSelection) return
    if (currentSelection.target === 'camera') deleteCameraKeyframe(currentSelection.time)
    else deleteDeviceKeyframe(currentSelection.time)
    setSelection(null)
  }, [currentSelection, deleteCameraKeyframe, deleteDeviceKeyframe])

  useEffect(() => {
    if (!currentSelection) return
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      event.preventDefault()
      deleteSelected()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentSelection, deleteSelected])

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
            onChange={(e) => {
              setSelection(null)
              setMotionPreset(e.target.value as MotionPresetId)
            }}
          >
            {MOTION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'none' ? 'Add animation' : p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="keyframe-actions" aria-label="Keyframe actions">
          <button
            className="timeline-action"
            onClick={addKeyframe}
            title={`Add a ${activeTrack} keyframe at ${playhead.toFixed(2)} seconds`}
          >
            <Plus size={13} />
            Add {activeTrack === 'camera' ? 'Camera' : 'Device'} key
          </button>
          <button
            className="timeline-action icon-only"
            onClick={deleteSelected}
            disabled={!currentSelection}
            title={
              currentSelection
                ? `Delete selected key at ${currentSelection.time.toFixed(2)} seconds`
                : 'Select a keyframe to delete it'
            }
            aria-label="Delete selected keyframe"
          >
            <Trash2 size={13} />
          </button>
        </div>

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

        <div className="tracks">
          <TrackRow
            target="camera"
            label="Camera"
            keys={cameraKeys}
            animated={cameraAnimated}
            active={activeTrack === 'camera'}
            selectedTime={currentSelection?.target === 'camera' ? currentSelection.time : null}
            pct={pct}
            onScrub={scrubTo}
            onSelect={selectKeyframe}
          />
          <TrackRow
            target="device"
            label="Device"
            keys={deviceKeys}
            animated={deviceAnimated}
            active={activeTrack === 'device'}
            selectedTime={currentSelection?.target === 'device' ? currentSelection.time : null}
            pct={pct}
            onScrub={scrubTo}
            onSelect={selectKeyframe}
          />
          <div className="playhead-layer">
            <div className="playhead" style={{ left: pct(playhead) }}>
              <span className="playhead-grip" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackRow({
  target,
  label,
  keys,
  animated,
  active,
  selectedTime,
  pct,
  onScrub,
  onSelect,
}: {
  target: TrackTarget
  label: string
  keys: number[]
  animated: boolean
  active: boolean
  selectedTime: number | null
  pct: (t: number) => string
  onScrub: (target: TrackTarget, clientX: number, laneLeft: number, laneWidth: number) => void
  onSelect: (target: TrackTarget, time: number) => void
}) {
  return (
    <div className={active ? 'track-row active' : 'track-row'}>
      <span className="track-label">{label}</span>
      <div
        className={animated ? 'track-lane animated' : 'track-lane'}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onScrub(target, event.clientX, rect.left, rect.width)
        }}
      >
        {animated &&
          keys.map((time) => {
            const selected = selectedTime !== null && Math.abs(selectedTime - time) < 1e-6
            return (
              <button
                key={time}
                className={selected ? 'keyframe selected' : 'keyframe'}
                style={{ left: pct(time) }}
                title={`${label} keyframe at ${time.toFixed(2)} seconds`}
                aria-label={`${label} keyframe at ${time.toFixed(2)} seconds`}
                aria-pressed={selected}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelect(target, time)
                }}
              />
            )
          })}
      </div>
    </div>
  )
}
