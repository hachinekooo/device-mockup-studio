import { useProjectStore } from '../../store/project'
import { TEMPLATES, type Template } from '../../timeline/templates'

/**
 * Thumbnail drawn from the template's own pose data rather than a bitmap.
 *
 * A flat projection of the arrangement is enough to tell these apart at
 * 60px, and deriving it from the same numbers the scene uses means a
 * thumbnail can never drift out of sync with the pose it advertises — which
 * is exactly what a folder of hand-made preview PNGs would eventually do.
 */
function PosePreview({ template }: { template: Template }) {
  const W = 62
  const H = 46
  const PHONE_W = 9
  const PHONE_H = 19

  // Devices further from the camera draw first so nearer ones overlap them.
  const ordered = template.poses
    .map((pose, index) => ({ pose, index }))
    .sort((a, b) => a.pose.position[2] - b.pose.position[2])

  return (
    <svg className="tpl-preview" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {ordered.map(({ pose, index }) => {
        const [x, y, z] = pose.position
        // Crude perspective: nearer devices read slightly larger.
        const depth = 1 + z * 0.09
        const scale = pose.scale * depth
        const cx = W / 2 + x * 13
        const cy = H / 2 - y * 13
        const leanDeg = (-pose.rotation[2] * 180) / Math.PI
        // A y-rotation foreshortens the width, which is what makes an angled
        // pose distinguishable from a flat one at this size.
        const squash = Math.max(0.25, Math.abs(Math.cos(pose.rotation[1])))
        const tipped = Math.abs(pose.rotation[0]) > 1

        return (
          <rect
            key={index}
            x={cx - (PHONE_W * scale * squash) / 2}
            y={cy - (PHONE_H * scale * (tipped ? 0.42 : 1)) / 2}
            width={PHONE_W * scale * squash}
            height={PHONE_H * scale * (tipped ? 0.42 : 1)}
            rx={2}
            transform={`rotate(${leanDeg} ${cx} ${cy})`}
          />
        )
      })}
    </svg>
  )
}

export function TemplatePicker() {
  const applyTemplate = useProjectStore((s) => s.applyTemplate)
  const deviceCount = useProjectStore((s) => s.project.devices.length)

  return (
    <div className="tpl-grid">
      {TEMPLATES.map((template) => (
        <button
          key={template.id}
          className="tpl-card"
          onClick={() => applyTemplate(template.id)}
          title={template.description}
        >
          <PosePreview template={template} />
          <span className="tpl-name">{template.name}</span>
          <span className="tpl-count">
            {template.poses.length} {template.poses.length === 1 ? 'device' : 'devices'}
            {template.poses.length > deviceCount && ' · adds'}
          </span>
        </button>
      ))}
    </div>
  )
}
