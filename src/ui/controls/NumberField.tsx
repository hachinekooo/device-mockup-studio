import { useEffect, useRef, useState } from 'react'

type NumberFieldProps = {
  value: number
  onChange: (v: number) => void
  /** Sub-label under the box — "Pos x", "y", "z". */
  label?: string
  step?: number
  precision?: number
  min?: number
  max?: number
  /** Renders the animate marker when this channel carries keyframes. */
  animated?: boolean
}

/**
 * Numeric input that scrubs on horizontal drag and accepts typing on click.
 *
 * Dragging is the primary interaction — a 3D pose is found by feel, not by
 * typing coordinates — so the drag has to be reliable: pointer capture keeps
 * it alive outside the element, and the value is accumulated from the total
 * delta rather than integrated per-move so a slow drag can't drift.
 */
export function NumberField({
  value,
  onChange,
  label,
  step = 0.01,
  precision = 2,
  min,
  max,
  animated,
}: NumberFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef({ startX: 0, startValue: 0, moved: false })

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function clamp(v: number) {
    if (min !== undefined && v < min) return min
    if (max !== undefined && v > max) return max
    return v
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startValue: value, moved: false }
    setDragging(true)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const dx = e.clientX - drag.current.startX
    if (!drag.current.moved && Math.abs(dx) < 3) return // let a click stay a click
    drag.current.moved = true
    // Shift for fine control, the convention every 3D tool shares.
    const scale = e.shiftKey ? step / 5 : step
    onChange(clamp(drag.current.startValue + dx * scale))
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    if (!drag.current.moved) {
      setDraft(String(Number(value.toFixed(precision))))
      setEditing(true)
    }
  }

  function commit() {
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) onChange(clamp(parsed))
    setEditing(false)
  }

  return (
    <div className="numfield">
      <div
        className={`numfield-box${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="numfield-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="numfield-value">{value.toFixed(precision)}</span>
        )}
        {animated && <span className="numfield-key" title="Animated" />}
      </div>
      {label && <span className="numfield-label">{label}</span>}
    </div>
  )
}
