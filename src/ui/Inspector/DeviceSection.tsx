import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Smartphone, RectangleHorizontal, Info, ChevronDown, Check } from 'lucide-react'
import { Segmented } from '../controls/Segmented'
import { useProjectStore } from '../../store/project'
import { DEVICE_LIST, getManifest } from '../../devices/manifest'
import { ACCEPTED_SCREEN_TYPES, loadScreenMedia } from '../../media/loadMedia'
import type { DeviceId, DeviceOrientation, ScreenFit } from '../../store/schema'

export function DeviceCard() {
  const deviceId = useProjectStore((s) => s.project.devices[s.activeDevice]?.id)
  const orientation = useProjectStore((s) => s.project.devices[s.activeDevice]?.orientation)
  const setDeviceId = useProjectStore((s) => s.setDeviceId)
  const setOrientation = useProjectStore((s) => s.setOrientation)
  const [picking, setPicking] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const manifest = getManifest(deviceId)

  // Dismiss on outside click and Escape. A picker that can only be closed by
  // re-clicking the thing that opened it is a trap once it overlaps the
  // controls underneath it.
  useEffect(() => {
    if (!picking) return
    function onDown(e: PointerEvent) {
      if (!cardRef.current?.contains(e.target as Node)) setPicking(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPicking(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [picking])

  return (
    <div className="device-card" ref={cardRef}>
      {/* The whole row opens the picker, not just the thumbnail — a 46px
          icon with no chevron reads as decoration, and the other devices
          become undiscoverable. */}
      <button
        className="device-open"
        onClick={() => setPicking((p) => !p)}
        aria-expanded={picking}
        title="Change device"
      >
        <span className="device-thumb">
          <Smartphone size={26} />
        </span>
        <span className="device-name">
          {manifest.name}
          <Info size={12} className="device-info" />
        </span>
        <ChevronDown size={14} className={picking ? 'chevron open' : 'chevron'} />
      </button>

      <Segmented<DeviceOrientation>
        size="sm"
        value={orientation}
        onChange={setOrientation}
        options={[
          { id: 'portrait', label: <Smartphone size={13} />, title: 'Portrait' },
          { id: 'landscape', label: <RectangleHorizontal size={13} />, title: 'Landscape' },
        ]}
      />

      {picking && (
        <div className="device-list">
          {DEVICE_LIST.map((d) => (
            <button
              key={d.id}
              className={d.id === deviceId ? 'device-option active' : 'device-option'}
              onClick={() => {
                setDeviceId(d.id as DeviceId)
                setPicking(false)
              }}
            >
              <Smartphone size={15} />
              <span>{d.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ScreenContent() {
  const screen = useProjectStore((s) => s.project.devices[s.activeDevice]?.screen)
  const screenFit = useProjectStore((s) => s.project.devices[s.activeDevice]?.screenFit)
  const deviceId = useProjectStore((s) => s.project.devices[s.activeDevice]?.id)
  const colorway = useProjectStore((s) => s.project.devices[s.activeDevice]?.colorway)
  const setScreenMedia = useProjectStore((s) => s.setScreenMedia)
  const setScreenFit = useProjectStore((s) => s.setScreenFit)
  const setColorway = useProjectStore((s) => s.setColorway)
  const duration = useProjectStore((s) => s.project.duration)
  const setDuration = useProjectStore((s) => s.setDuration)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const colorways = getManifest(deviceId).colorways

  /*
   * A clip longer than the timeline plays only as far as the timeline goes,
   * and a clip shorter than it holds its last frame — both silently. Offered
   * rather than applied: the timeline length is a composition decision, and
   * dropping a screen recording should not quietly rewrite it.
   */
  const clip = screen?.kind === 'video' ? (screen.duration ?? 0) : 0
  const clipMismatch = clip > 0 && Math.abs(clip - duration) > 0.05

  async function accept(file: File | undefined) {
    // A screen recording is just the other kind of screen media: same ref,
    // same fit, same slot on the device.
    const media = await loadScreenMedia(file)
    if (media) setScreenMedia(media)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    void accept(e.dataTransfer.files[0])
  }

  return (
    <>
      <div className="control-group">
        <label>Screen content</label>
        <div
          className={dragOver ? 'dropzone drag-over' : 'dropzone'}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {screen ? (
            screen.kind === 'video' ? (
              // Muted and inert: this is a thumbnail, and a second element
              // playing its own copy of the clip would fight the one on the
              // device for decode bandwidth.
              <video className="dropzone-preview" src={screen.url} muted playsInline />
            ) : (
              <img className="dropzone-preview" src={screen.url} alt="Screen content" />
            )
          ) : (
            <span>
              Drop or paste your screen here
              <br />
              <span className="hint">PNG, JPEG, MP4 or WebM</span>
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_SCREEN_TYPES}
            hidden
            onChange={(e) => void accept(e.target.files?.[0])}
          />
        </div>
        {screen && (
          <div className="media-meta">
            {screen.width} × {screen.height}
            {screen.kind === 'video' && ` · ${screen.duration?.toFixed(1)}s`}
            <button className="link-btn" onClick={() => setScreenMedia(null)}>
              Remove
            </button>
          </div>
        )}
        {clipMismatch && (
          <button className="ghost-btn" onClick={() => setDuration(clip)}>
            Match timeline to clip ({clip.toFixed(1)}s)
          </button>
        )}
      </div>

      <div className="control-group">
        <label>Fit</label>
        <Segmented<ScreenFit>
          value={screenFit}
          onChange={setScreenFit}
          options={[
            { id: 'contain', label: 'Contain' },
            { id: 'cover', label: 'Cover' },
          ]}
        />
      </div>

      <div className="control-group">
        <label id="device-finish-label">Device finish</label>
        <div className="finish-list" role="radiogroup" aria-labelledby="device-finish-label">
          {colorways.map((c) => (
            <label
              key={c.id}
              title={c.name}
              className={c.id === colorway ? 'finish-option active' : 'finish-option'}
            >
              <input
                className="finish-radio"
                type="radio"
                name="device-finish"
                value={c.id}
                checked={c.id === colorway}
                onChange={() => setColorway(c.id)}
              />
              <span
                className="finish-swatch"
                style={{ background: c.swatch }}
                aria-hidden="true"
              />
              <span className="finish-name">{c.name}</span>
              <Check className="finish-check" size={14} aria-hidden="true" />
            </label>
          ))}
        </div>
      </div>
    </>
  )
}
