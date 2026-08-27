import { Copy, Plus, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../store/project'
import { getManifest } from '../../devices/manifest'

/** Which device the inspector's controls edit, when a scene holds several. */
export function DeviceList() {
  const devices = useProjectStore((s) => s.project.devices)
  const active = useProjectStore((s) => s.activeDevice)
  const setActiveDevice = useProjectStore((s) => s.setActiveDevice)
  const addDevice = useProjectStore((s) => s.addDevice)
  const duplicateDevice = useProjectStore((s) => s.duplicateDevice)
  const removeDevice = useProjectStore((s) => s.removeDevice)

  // With one device there is nothing to choose between, so the list is noise.
  if (devices.length <= 1) {
    return (
      <button className="device-add" onClick={addDevice}>
        <Plus size={13} /> Add a second device
      </button>
    )
  }

  return (
    <div className="control-group">
      <label>Devices</label>
      <div className="device-rows">
        {devices.map((device, index) => (
          <div
            key={device.instanceId}
            className={index === active ? 'device-row active' : 'device-row'}
            onClick={() => setActiveDevice(index)}
          >
            <span className="device-row-index">{index + 1}</span>
            <span className="device-row-name">{getManifest(device.id).name}</span>
            {device.screen && <span className="device-row-dot" title="Has a screenshot" />}
            <button
              className="device-row-btn"
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation()
                duplicateDevice(index)
              }}
            >
              <Copy size={12} />
            </button>
            <button
              className="device-row-btn"
              title="Remove"
              onClick={(e) => {
                e.stopPropagation()
                removeDevice(index)
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="device-add" onClick={addDevice}>
        <Plus size={13} /> Add device
      </button>
    </div>
  )
}
