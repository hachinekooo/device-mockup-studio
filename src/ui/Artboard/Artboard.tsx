import { useLayoutEffect, useRef, useState } from 'react'
import { Hand, Search } from 'lucide-react'
import { Stage } from '../../scene/Stage'
import { backdropCss } from '../../scene/Backdrop'
import { useProjectStore } from '../../store/project'
import { aspectLabelFor } from '../../store/schema'

/**
 * Letterbox the artboard to the output aspect inside whatever space the pane
 * gives us, sizing it in explicit pixels.
 *
 * The pixels matter. CSS `aspect-ratio` plus container query units expresses
 * this in one line, but it resolves over two layout passes — the box is 0x0
 * on the first — and R3F only measures its container once, on mount. It
 * therefore latched onto that zero and never created a renderer at all.
 *
 * So the first measurement is taken synchronously in a layout effect, where
 * the geometry is already committed and readable. ResizeObserver handles
 * only later changes. Seeding from the observer instead would reintroduce
 * the same bug in a subtler form: RO callbacks are delivered during the
 * rendering step, which a browser skips entirely while the tab is hidden —
 * so the canvas would never appear for anyone who opened the page in a
 * background tab and came back to it.
 */
function useLetterbox(ratio: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = (width: number, height: number) =>
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))

    const rect = el.getBoundingClientRect()
    measure(rect.width, rect.height)

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      measure(width, height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const width = Math.max(0, Math.min(box.width, box.height * ratio))
  return { ref, width, height: width / ratio }
}

export function Artboard() {
  const background = useProjectStore((s) => s.project.background)
  const output = useProjectStore((s) => s.project.output)
  const { ref, width, height } = useLetterbox(output.width / output.height)

  return (
    <div className="artboard-zone">
      <div className="artboard-bar">
        <span className="artboard-label">
          Screen <strong>{aspectLabelFor(output)}</strong>
        </span>
        <span className="artboard-dims">
          {output.width} × {output.height}
        </span>
      </div>

      <div className="artboard-wrap" ref={ref}>
        <div className="artboard" style={{ width, height, ...backdropCss(background) }}>
          {/* Mounting the Canvas before the box has size is what caused R3F
              to measure zero, so hold it back for the one frame it takes. */}
          {width > 0 && <Stage />}
        </div>
      </div>

      <div className="canvas-tools">
        <button className="tool-btn active" title="Pan — drag the canvas to orbit">
          <Hand size={15} />
        </button>
        <button className="tool-btn" title="Zoom — scroll to dolly">
          <Search size={15} />
        </button>
      </div>
    </div>
  )
}
