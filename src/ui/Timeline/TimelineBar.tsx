import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Plus,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useProjectStore } from '../../store/project'
import { MOTION_PRESETS, type MotionPresetId } from '../../timeline/presets'
import { keyTimes } from '../../timeline/tracks'
import { isAnimated, tracksEnd } from '../../timeline/sample'
import {
  aggregateEasingAt,
  EASE_SMOOTH,
  NAMED_EASINGS,
  normalizeEaseHandle,
  type AggregateEasing,
  type NamedEasing,
} from '../../timeline/easing'
import type { EaseHandle } from '../../store/schema'
import {
  adjacentKeyTime,
  formatTimecode,
  parseTimelineTime,
  snapTimeToFrame,
  timelineTimeAtPointer,
} from './timelineMath'

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
  const moveCameraKeyframe = useProjectStore((s) => s.moveCameraKeyframe)
  const moveDeviceKeyframe = useProjectStore((s) => s.moveDeviceKeyframe)
  const setCameraKeyframeEasing = useProjectStore((s) => s.setCameraKeyframeEasing)
  const setDeviceKeyframeEasing = useProjectStore((s) => s.setDeviceKeyframeEasing)
  const setCameraKeyframeEase = useProjectStore((s) => s.setCameraKeyframeEase)
  const setDeviceKeyframeEase = useProjectStore((s) => s.setDeviceKeyframeEase)
  const [activeTrack, setActiveTrack] = useState<TrackTarget>('device')
  const [selection, setSelection] = useState<KeySelection | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  const duration = project.duration
  const pct = (t: number) => `${(t / duration) * 100}%`

  function scrubTo(target: TrackTarget, clientX: number, laneLeft: number, laneWidth: number) {
    const time = timelineTimeAtPointer(clientX, laneLeft, laneWidth, duration, project.fps)
    setPlaying(false)
    setActiveTrack(target)
    setSelection(null)
    setPlayhead(time)
    timelineRef.current?.focus({ preventScroll: true })
  }

  const cameraKeys = keyTimes(project.camera.tracks)
  const active = useProjectStore((s) => s.activeDevice)
  const deviceTracks = project.devices[active]?.transform ?? {}
  const activeDeviceInstanceId = project.devices[active]?.instanceId
  const deviceKeys = keyTimes(deviceTracks)
  const cameraAnimated = isAnimated(project.camera.tracks)
  const deviceAnimated = isAnimated(deviceTracks)
  const activeKeys = activeTrack === 'camera' ? cameraKeys : deviceKeys
  const previousKey = adjacentKeyTime(activeKeys, playhead, -1)
  const nextKey = adjacentKeyTime(activeKeys, playhead, 1)
  const currentSelection =
    selection?.target === 'device' && selection.deviceInstanceId !== activeDeviceInstanceId
      ? null
      : selection
  const selectedTracks = currentSelection?.target === 'camera' ? project.camera.tracks : deviceTracks
  const selectedEasing = currentSelection
    ? aggregateEasingAt(selectedTracks, currentSelection.time)
    : null

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

  function moveKeyframe(target: TrackTarget, from: number, to: number) {
    const time = snapTimeToFrame(to, project.fps, duration)
    if (Math.abs(from - time) < 1e-6) return
    setPlaying(false)
    if (target === 'camera') moveCameraKeyframe(from, time)
    else moveDeviceKeyframe(from, time)
    setPlayhead(time)
    setActiveTrack(target)
    setSelection({
      target,
      time,
      deviceInstanceId: target === 'device' ? activeDeviceInstanceId : undefined,
    })
    requestAnimationFrame(() => {
      timelineRef.current?.querySelector<HTMLButtonElement>('.keyframe.selected')?.focus()
    })
  }

  function setSelectedEasing(easing: NamedEasing) {
    if (!currentSelection) return
    setPlaying(false)
    if (currentSelection.target === 'camera') {
      setCameraKeyframeEasing(currentSelection.time, easing)
    } else {
      setDeviceKeyframeEasing(currentSelection.time, easing)
    }
  }

  function setSelectedCustomEase(ease: EaseHandle) {
    if (!currentSelection) return
    setPlaying(false)
    if (currentSelection.target === 'camera') {
      setCameraKeyframeEase(currentSelection.time, ease)
    } else {
      setDeviceKeyframeEase(currentSelection.time, ease)
    }
  }

  const deleteSelected = useCallback(() => {
    if (!currentSelection) return
    if (currentSelection.target === 'camera') deleteCameraKeyframe(currentSelection.time)
    else deleteDeviceKeyframe(currentSelection.time)
    setSelection(null)
  }, [currentSelection, deleteCameraKeyframe, deleteDeviceKeyframe])

  const seekTo = useCallback(
    (time: number) => {
      setPlaying(false)
      setSelection(null)
      setPlayhead(snapTimeToFrame(time, project.fps, duration))
    },
    [duration, project.fps, setPlayhead, setPlaying],
  )

  const stepFrames = useCallback(
    (frames: number) => seekTo(playhead + frames / project.fps),
    [playhead, project.fps, seekTo],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!timelineRef.current?.contains(document.activeElement)) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && currentSelection) {
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const direction = event.key === 'ArrowLeft' ? -1 : 1
        stepFrames(direction * (event.shiftKey ? 10 : 1))
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        seekTo(event.key === 'Home' ? 0 : duration)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentSelection, deleteSelected, duration, seekTo, stepFrames])

  useEffect(() => {
    function clearSelectionOutsideTimeline(event: PointerEvent) {
      if (timelineRef.current?.contains(event.target as Node)) return
      setSelection(null)
    }
    window.addEventListener('pointerdown', clearSelectionOutsideTimeline, true)
    return () => window.removeEventListener('pointerdown', clearSelectionOutsideTimeline, true)
  }, [])

  // One tick per second, plus a half-second subdivision for readability.
  const seconds = Math.ceil(duration)

  return (
    <div className="timeline" ref={timelineRef} tabIndex={-1}>
      <div className="timeline-toolbar">
        <button className="play-btn" onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <div className="transport-nav" role="group" aria-label="Timeline navigation">
          <button
            className="transport-btn"
            onClick={() => previousKey !== null && seekTo(previousKey)}
            disabled={previousKey === null}
            title={`Previous ${activeTrack} keyframe`}
            aria-label={`Previous ${activeTrack} keyframe`}
          >
            <SkipBack size={13} />
          </button>
          <button
            className="transport-btn"
            onClick={() => stepFrames(-1)}
            disabled={playhead <= 0}
            title="Previous frame (Left Arrow)"
            aria-label="Previous frame"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="transport-btn"
            onClick={() => stepFrames(1)}
            disabled={playhead >= duration}
            title="Next frame (Right Arrow)"
            aria-label="Next frame"
          >
            <ChevronRight size={14} />
          </button>
          <button
            className="transport-btn"
            onClick={() => nextKey !== null && seekTo(nextKey)}
            disabled={nextKey === null}
            title={`Next ${activeTrack} keyframe`}
            aria-label={`Next ${activeTrack} keyframe`}
          >
            <SkipForward size={13} />
          </button>
        </div>

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

        <div className="keyframe-actions" role="group" aria-label="Keyframe actions">
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
          <TimecodeField
            time={playhead}
            fps={project.fps}
            duration={duration}
            onCommit={seekTo}
          />
          <span className="time-of">of</span>
          <input
            className="time-duration"
            type="number"
            min={Math.max(
              0.5,
              tracksEnd(project.camera.tracks),
              ...project.devices.map((device) => tracksEnd(device.transform)),
            )}
            step={0.5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            title="Duration cannot be shorter than the last keyframe"
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
            duration={duration}
            fps={project.fps}
            pct={pct}
            onScrub={scrubTo}
            onSelect={selectKeyframe}
            onMove={moveKeyframe}
          />
          <TrackRow
            target="device"
            label={project.devices.length > 1 ? `Device ${active + 1}` : 'Device'}
            keys={deviceKeys}
            animated={deviceAnimated}
            active={activeTrack === 'device'}
            selectedTime={currentSelection?.target === 'device' ? currentSelection.time : null}
            duration={duration}
            fps={project.fps}
            pct={pct}
            onScrub={scrubTo}
            onSelect={selectKeyframe}
            onMove={moveKeyframe}
          />
          <div className="playhead-layer">
            <div className="playhead-line" style={{ left: pct(playhead) }}>
              <button
                className="playhead-handle"
                title={`Drag playhead · ${formatTimecode(playhead, project.fps)}`}
                aria-label={`Playhead at ${formatTimecode(playhead, project.fps)}`}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={playhead}
                aria-valuetext={formatTimecode(playhead, project.fps)}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.focus({ preventScroll: true })
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const rect = event.currentTarget.closest('.playhead-layer')?.getBoundingClientRect()
                  if (rect) seekTo(timelineTimeAtPointer(event.clientX, rect.left, rect.width, duration, project.fps))
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  const rect = event.currentTarget.closest('.playhead-layer')?.getBoundingClientRect()
                  if (rect) seekTo(timelineTimeAtPointer(event.clientX, rect.left, rect.width, duration, project.fps))
                }}
                onPointerUp={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  const rect = event.currentTarget.closest('.playhead-layer')?.getBoundingClientRect()
                  if (rect) seekTo(timelineTimeAtPointer(event.clientX, rect.left, rect.width, duration, project.fps))
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
              >
                <span className="playhead-grip" />
              </button>
            </div>
          </div>
        </div>
        {currentSelection && selectedEasing && (
          <KeyframeEasingControl
            key={`${currentSelection.target}:${currentSelection.deviceInstanceId ?? 'camera'}:${currentSelection.time}`}
            targetLabel={
              currentSelection.target === 'camera'
                ? 'Camera'
                : project.devices.length > 1
                  ? `Device ${active + 1}`
                  : 'Device'
            }
            state={selectedEasing}
            onChange={setSelectedEasing}
            onCustomChange={setSelectedCustomEase}
          />
        )}
      </div>
    </div>
  )
}

const EASING_LABELS: Record<NamedEasing, string> = {
  linear: 'Linear',
  'ease-in': 'Ease In',
  'ease-out': 'Ease Out',
  'ease-in-out': 'Ease In Out',
  smooth: 'Smooth',
  overshoot: 'Overshoot',
}

function KeyframeEasingControl({
  targetLabel,
  state,
  onChange,
  onCustomChange,
}: {
  targetLabel: string
  state: AggregateEasing
  onChange: (easing: NamedEasing) => void
  onCustomChange: (ease: EaseHandle) => void
}) {
  const value = state.kind === 'named' ? state.name : state.kind
  const handle = state.kind === 'named' || state.kind === 'custom' ? state.ease : null
  const disabled = state.kind === 'none'
  const [editorOpen, setEditorOpen] = useState(false)

  return (
    <div className="keyframe-context" role="group" aria-label={`${targetLabel} keyframe easing`}>
      <EasingGlyph handle={handle} mixed={state.kind === 'mixed'} />
      <div className="keyframe-context-copy">
        <span>{targetLabel}</span>
        <strong>{disabled ? 'End key' : 'To next key'}</strong>
      </div>
      <select
        className="easing-select"
        value={value}
        disabled={disabled}
        aria-label="Easing to next keyframe"
        title={disabled ? 'The last keyframe has no outgoing animation' : 'Easing from this key to the next'}
        onChange={(event) => {
          setEditorOpen(false)
          onChange(event.target.value as NamedEasing)
        }}
      >
        {state.kind === 'none' && <option value="none">No outgoing segment</option>}
        {state.kind === 'mixed' && <option value="mixed">Mixed curves</option>}
        {state.kind === 'custom' && <option value="custom">Custom curve</option>}
        {(Object.keys(NAMED_EASINGS) as NamedEasing[]).map((name) => (
          <option key={name} value={name}>
            {EASING_LABELS[name]}
          </option>
        ))}
      </select>
      <button
        className="curve-editor-toggle"
        disabled={disabled}
        aria-label="Edit custom easing curve"
        aria-expanded={editorOpen}
        title="Edit custom cubic Bézier curve"
        onClick={() => setEditorOpen((open) => !open)}
      >
        <SlidersHorizontal size={13} />
      </button>
      {editorOpen && (
        <CurveEditor
          initial={handle ?? EASE_SMOOTH}
          onCancel={() => setEditorOpen(false)}
          onApply={(ease) => {
            onCustomChange(ease)
            setEditorOpen(false)
          }}
        />
      )}
    </div>
  )
}

function EasingGlyph({ handle, mixed = false }: { handle: EaseHandle | null; mixed?: boolean }) {
  if (!handle || mixed) {
    return (
      <svg className="easing-glyph" viewBox="0 0 28 18" aria-hidden="true">
        <path d={mixed ? 'M3 13 C8 13 8 5 13 5 M15 13 C20 13 20 5 25 5' : 'M3 9 H25'} />
      </svg>
    )
  }
  const [x1, y1, x2, y2] = handle
  const path = `M3 15 C${3 + x1 * 22} ${15 - y1 * 12},${3 + x2 * 22} ${15 - y2 * 12},25 3`
  return (
    <svg className="easing-glyph" viewBox="0 0 28 18" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

const CURVE_GRAPH = { left: 12, right: 188, top: 8, bottom: 92 } as const

function curvePoint(x: number, y: number) {
  const width = CURVE_GRAPH.right - CURVE_GRAPH.left
  const height = CURVE_GRAPH.bottom - CURVE_GRAPH.top
  return {
    x: CURVE_GRAPH.left + x * width,
    y: CURVE_GRAPH.bottom - ((y + 2) / 4) * height,
  }
}

function CurveEditor({
  initial,
  onCancel,
  onApply,
}: {
  initial: EaseHandle
  onCancel: () => void
  onApply: (ease: EaseHandle) => void
}) {
  const [draft, setDraft] = useState(() => normalizeEaseHandle(initial))
  const start = curvePoint(0, 0)
  const end = curvePoint(1, 1)
  const first = curvePoint(draft[0], draft[1])
  const second = curvePoint(draft[2], draft[3])

  function updateHandle(index: 0 | 1, event: ReactPointerEvent<SVGCircleElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * 200
    const py = ((event.clientY - rect.top) / rect.height) * 100
    const x = (px - CURVE_GRAPH.left) / (CURVE_GRAPH.right - CURVE_GRAPH.left)
    const y = ((CURVE_GRAPH.bottom - py) / (CURVE_GRAPH.bottom - CURVE_GRAPH.top)) * 4 - 2
    setDraft((current) => {
      const next = [...current] as EaseHandle
      const offset = index * 2
      next[offset] = x
      next[offset + 1] = y
      return normalizeEaseHandle(next)
    })
  }

  function updatePart(index: number, value: number) {
    if (!Number.isFinite(value)) return
    setDraft((current) => {
      const next = [...current] as EaseHandle
      next[index] = value
      return normalizeEaseHandle(next)
    })
  }

  const path = `M${start.x} ${start.y} C${first.x} ${first.y},${second.x} ${second.y},${end.x} ${end.y}`

  return (
    <div className="curve-editor" role="dialog" aria-label="Custom cubic Bézier easing">
      <div className="curve-editor-header">
        <div>
          <strong>Custom curve</strong>
          <span>Drag handles or enter control points</span>
        </div>
        <button aria-label="Close curve editor" onClick={onCancel}>
          <X size={13} />
        </button>
      </div>

      <svg className="curve-graph" viewBox="0 0 200 100" aria-label="Easing curve preview">
        <line className="curve-axis" x1={start.x} y1={start.y} x2={end.x} y2={start.y} />
        <line className="curve-axis" x1={start.x} y1={start.y} x2={start.x} y2={end.y} />
        <line className="curve-control" x1={start.x} y1={start.y} x2={first.x} y2={first.y} />
        <line className="curve-control" x1={end.x} y1={end.y} x2={second.x} y2={second.y} />
        <path className="curve-path" d={path} />
        {[first, second].map((point, index) => (
          <circle
            key={index}
            className="curve-handle"
            cx={point.x}
            cy={point.y}
            r={5}
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => updateHandle(index as 0 | 1, event)}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
          />
        ))}
      </svg>

      <div className="curve-values">
        {draft.map((value, index) => (
          <label key={index}>
            <span>{index % 2 === 0 ? `x${index / 2 + 1}` : `y${(index + 1) / 2}`}</span>
            <input
              type="number"
              min={index % 2 === 0 ? 0 : -2}
              max={index % 2 === 0 ? 1 : 2}
              step={0.01}
              value={Number(value.toFixed(2))}
              onChange={(event) => updatePart(index, Number(event.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="curve-editor-actions">
        <button onClick={() => setDraft([...EASE_SMOOTH] as EaseHandle)}>Reset</button>
        <button className="primary" onClick={() => onApply(draft)}>Apply curve</button>
      </div>
    </div>
  )
}

function TimecodeField({
  time,
  fps,
  duration,
  onCommit,
}: {
  time: number
  fps: number
  duration: number
  onCommit: (time: number) => void
}) {
  const formatted = formatTimecode(time, fps)
  const [draft, setDraft] = useState(formatted)
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const cancelBlur = useRef(false)

  function commit() {
    const parsed = parseTimelineTime(draft, fps, duration)
    if (parsed === null) {
      setDraft(formatted)
      setEditing(false)
      setInvalid(true)
      return
    }
    setInvalid(false)
    setEditing(false)
    onCommit(parsed)
  }

  function cancel() {
    setDraft(formatted)
    setInvalid(false)
    setEditing(false)
  }

  return (
    <input
      className={invalid ? 'time-now invalid' : 'time-now'}
      value={editing ? draft : formatted}
      aria-label="Current time in minutes, seconds, and frames"
      aria-invalid={invalid}
      title="Current time · MM:SS:FF (you can also enter seconds)"
      spellCheck={false}
      onFocus={(event) => {
        setEditing(true)
        setDraft(formatted)
        setInvalid(false)
        event.currentTarget.select()
      }}
      onChange={(event) => {
        setDraft(event.target.value)
        setInvalid(false)
      }}
      onBlur={() => {
        if (cancelBlur.current) {
          cancelBlur.current = false
          return
        }
        commit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelBlur.current = true
          cancel()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function TrackRow({
  target,
  label,
  keys,
  animated,
  active,
  selectedTime,
  duration,
  fps,
  pct,
  onScrub,
  onSelect,
  onMove,
}: {
  target: TrackTarget
  label: string
  keys: number[]
  animated: boolean
  active: boolean
  selectedTime: number | null
  duration: number
  fps: number
  pct: (t: number) => string
  onScrub: (target: TrackTarget, clientX: number, laneLeft: number, laneWidth: number) => void
  onSelect: (target: TrackTarget, time: number) => void
  onMove: (target: TrackTarget, from: number, to: number) => void
}) {
  const drag = useRef<{
    pointerId: number
    sourceTime: number
    originX: number
    laneLeft: number
    laneWidth: number
    active: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const [dragPreview, setDragPreview] = useState<{ sourceTime: number; time: number } | null>(null)

  function finishDrag() {
    drag.current = null
    setDragPreview(null)
  }

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
            const previewTime = dragPreview?.sourceTime === time ? dragPreview.time : time
            return (
              <button
                key={time}
                className={
                  dragPreview?.sourceTime === time
                    ? 'keyframe selected dragging'
                    : selected
                      ? 'keyframe selected'
                      : 'keyframe'
                }
                style={{ left: pct(previewTime) }}
                title={`${label} keyframe at ${time.toFixed(2)} seconds · drag to retime`}
                aria-label={`${label} keyframe at ${time.toFixed(2)} seconds`}
                aria-pressed={selected}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  onSelect(target, time)
                  event.currentTarget.setPointerCapture(event.pointerId)
                  drag.current = {
                    pointerId: event.pointerId,
                    sourceTime: time,
                    originX: event.clientX,
                    laneLeft: rect.left,
                    laneWidth: rect.width,
                    active: false,
                  }
                }}
                onPointerMove={(event) => {
                  const state = drag.current
                  if (!state || state.pointerId !== event.pointerId) return
                  if (!state.active && Math.abs(event.clientX - state.originX) < 3) return
                  state.active = true
                  const preview = timelineTimeAtPointer(
                    event.clientX,
                    state.laneLeft,
                    state.laneWidth,
                    duration,
                    fps,
                  )
                  setDragPreview({ sourceTime: state.sourceTime, time: preview })
                }}
                onPointerUp={(event) => {
                  const state = drag.current
                  if (!state || state.pointerId !== event.pointerId) return
                  if (state.active) {
                    const destination = timelineTimeAtPointer(
                      event.clientX,
                      state.laneLeft,
                      state.laneWidth,
                      duration,
                      fps,
                    )
                    suppressClick.current = true
                    window.setTimeout(() => {
                      suppressClick.current = false
                    }, 0)
                    onMove(target, state.sourceTime, destination)
                  }
                  finishDrag()
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
                onPointerCancel={(event) => {
                  const state = drag.current
                  if (!state || state.pointerId !== event.pointerId) return
                  suppressClick.current = false
                  finishDrag()
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false
                    return
                  }
                  onSelect(target, time)
                }}
                onKeyDown={(event) => {
                  const state = drag.current
                  if (event.key !== 'Escape' || !state) return
                  event.preventDefault()
                  suppressClick.current = false
                  finishDrag()
                  if (event.currentTarget.hasPointerCapture(state.pointerId)) {
                    event.currentTarget.releasePointerCapture(state.pointerId)
                  }
                  onSelect(target, state.sourceTime)
                }}
              />
            )
          })}
      </div>
    </div>
  )
}
