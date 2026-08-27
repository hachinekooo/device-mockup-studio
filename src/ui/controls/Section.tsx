import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

type SectionProps = {
  icon?: ReactNode
  title: string
  defaultOpen?: boolean
  /** Right-aligned controls in the header (add, duplicate, reset…). */
  actions?: ReactNode
  children: ReactNode
}

export function Section({ icon, title, defaultOpen, actions, children }: SectionProps) {
  const [open, setOpen] = useState(!!defaultOpen)

  return (
    <div className={`section${open ? ' open' : ''}`}>
      <div className="section-header">
        <button className="section-toggle" onClick={() => setOpen((o) => !o)}>
          {icon && <span className="section-icon">{icon}</span>}
          <span className="section-title">{title}</span>
        </button>
        {actions && <div className="section-actions">{actions}</div>}
        <button className="section-chevron" onClick={() => setOpen((o) => !o)} aria-label="Toggle">
          <ChevronDown size={14} className={open ? 'chevron open' : 'chevron'} />
        </button>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

/** Nested disclosure inside a section — Rotato's "Blurs" / "DSLR" rows. */
export function SubSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="subsection">
      <button className="subsection-header" onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={12} className={open ? 'chevron open' : 'chevron right'} />
        <span>{title}</span>
      </button>
      {open && <div className="subsection-body">{children}</div>}
    </div>
  )
}
