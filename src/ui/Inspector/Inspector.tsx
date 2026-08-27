import { useProjectStore } from '../../store/project'
import type { BackgroundConfig } from '../../store/schema'

const HDRI_OPTIONS = ['studio', 'city', 'sunset', 'warehouse'] as const

export function BackgroundControls() {
  const background = useProjectStore((s) => s.project.background)
  const setBackground = useProjectStore((s) => s.setBackground)

  function setBackgroundType(type: BackgroundConfig['type']) {
    switch (type) {
      case 'transparent':
        setBackground({ type: 'transparent' })
        break
      case 'solid':
        setBackground({ type: 'solid', color: '#1c1c1f' })
        break
      case 'gradient':
        setBackground({ type: 'gradient', from: '#3a3f52', to: '#0e0f14', angle: 135 })
        break
    }
  }

  return (
    <div className="control-group">
      <div className="preset-grid preset-grid-3">
        {(['transparent', 'solid', 'gradient'] as const).map((t) => (
          <button
            key={t}
            className={background.type === t ? 'preset-btn active' : 'preset-btn'}
            onClick={() => setBackgroundType(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {background.type === 'solid' && (
        <input
          type="color"
          value={background.color}
          onChange={(e) => setBackground({ type: 'solid', color: e.target.value })}
        />
      )}
      {background.type === 'gradient' && (
        <div className="row">
          <input
            type="color"
            value={background.from}
            onChange={(e) => setBackground({ ...background, from: e.target.value })}
          />
          <input
            type="color"
            value={background.to}
            onChange={(e) => setBackground({ ...background, to: e.target.value })}
          />
          <input
            type="range"
            min={0}
            max={360}
            value={background.angle}
            onChange={(e) => setBackground({ ...background, angle: Number(e.target.value) })}
          />
        </div>
      )}
    </div>
  )
}

export function EnvironmentControls() {
  const environment = useProjectStore((s) => s.project.environment)
  const setEnvironment = useProjectStore((s) => s.setEnvironment)

  return (
    <>
      <div className="control-group">
        <label>HDRI</label>
        <select
          value={environment.hdri}
          onChange={(e) => setEnvironment({ hdri: e.target.value as typeof environment.hdri })}
        >
          {HDRI_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label>Rotation</label>
        <input
          type="range"
          min={0}
          max={Math.PI * 2}
          step={0.01}
          value={environment.rotation}
          onChange={(e) => setEnvironment({ rotation: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <label>Intensity</label>
        <input
          type="range"
          min={0}
          max={3}
          step={0.05}
          value={environment.intensity}
          onChange={(e) => setEnvironment({ intensity: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <label>Shadow opacity</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={environment.shadowOpacity}
          onChange={(e) => setEnvironment({ shadowOpacity: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <label>Shadow blur</label>
        <input
          type="range"
          min={0}
          max={24}
          step={0.5}
          value={environment.shadowBlur}
          onChange={(e) => setEnvironment({ shadowBlur: Number(e.target.value) })}
        />
      </div>
    </>
  )
}
